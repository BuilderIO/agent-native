#import "PrivateVaultBootstrapReplay.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultAuthorityStoreInternal.h"
#import "PrivateVaultCustodyRepositoryRecoveryInternal.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultGenesisAccountAdmission.h"
#import "PrivateVaultGenesisBuilder.h"
#import "PrivateVaultRecoveryBuilder.h"
#import "PrivateVaultRecoveryBuilderInternal.h"
#import "PrivateVaultRecoveryPreparationStoreInternal.h"
#import "PrivateVaultRecoveryCoordinator.h"
#import "PrivateVaultGenesisPreparationArtifactStore.h"
#import "PrivateVaultHostedAppendRetryStore.h"
#import "PrivateVaultHostedAppendTransport.h"
#import "PrivateVaultGenesisHostedAppend.h"
#import "PrivateVaultControlLogInternal.h"

#include <assert.h>
#include <stdio.h>

static NSMutableDictionary<NSString *, NSData *> *gRecoveryKeychain;
static NSString *RecoveryKeychainKey(NSDictionary *query) {
  return [NSString
      stringWithFormat:@"%@|%@", query[(__bridge id)kSecAttrService],
                       query[(__bridge id)kSecAttrAccount]];
}
static OSStatus RecoveryKeychainCopy(CFDictionaryRef raw, CFTypeRef *result) {
  NSData *value =
      gRecoveryKeychain[RecoveryKeychainKey((__bridge NSDictionary *)raw)];
  if (value == nil)
    return errSecItemNotFound;
  if (result != NULL)
    *result = CFBridgingRetain([value copy]);
  return errSecSuccess;
}
static OSStatus RecoveryKeychainAdd(CFDictionaryRef raw, CFTypeRef *result) {
  (void)result;
  NSDictionary *attributes = (__bridge NSDictionary *)raw;
  NSString *key = RecoveryKeychainKey(attributes);
  if (gRecoveryKeychain[key] != nil)
    return errSecDuplicateItem;
  NSData *value = attributes[(__bridge id)kSecValueData];
  gRecoveryKeychain[key] =
      [NSData dataWithBytes:value.bytes length:value.length];
  return errSecSuccess;
}
static OSStatus RecoveryKeychainUpdate(CFDictionaryRef rawQuery,
                                       CFDictionaryRef rawAttributes) {
  NSString *key =
      RecoveryKeychainKey((__bridge NSDictionary *)rawQuery);
  if (gRecoveryKeychain[key] == nil)
    return errSecItemNotFound;
  NSDictionary *attributes = (__bridge NSDictionary *)rawAttributes;
  NSData *value = attributes[(__bridge id)kSecValueData];
  gRecoveryKeychain[key] =
      [NSData dataWithBytes:value.bytes length:value.length];
  return errSecSuccess;
}
static OSStatus RecoveryKeychainDelete(CFDictionaryRef raw) {
  NSString *key = RecoveryKeychainKey((__bridge NSDictionary *)raw);
  if (gRecoveryKeychain[key] == nil)
    return errSecItemNotFound;
  [gRecoveryKeychain removeObjectForKey:key];
  return errSecSuccess;
}
static AncPrivateVaultKeychain *RecoveryKeychain(void) {
  AncPrivateVaultSecItemFunctions functions = {
      .copyMatching = RecoveryKeychainCopy,
      .add = RecoveryKeychainAdd,
      .update = RecoveryKeychainUpdate,
      .deleteItem = RecoveryKeychainDelete,
  };
  return [[AncPrivateVaultKeychain alloc] initWithFunctions:functions
                                          contextFactory:^LAContext * {
                                            return [[LAContext alloc] init];
                                          }];
}
static AncPrivateVaultCustodyRepository *RecoveryRepository(
    AncPrivateVaultKeychain *keychain) {
  return [[AncPrivateVaultCustodyRepository alloc] initWithKeychain:keychain];
}

static NSData *Pattern(uint8_t byte, NSUInteger length) {
  NSMutableData *data = [NSMutableData dataWithLength:length];
  memset(data.mutableBytes, byte, length);
  return data;
}

static AncPrivateVaultGuardedMemory *Guarded(NSData *value) {
  AncPrivateVaultGuardedMemoryStatus status;
  AncPrivateVaultGuardedMemory *memory =
      [AncPrivateVaultGuardedMemory memoryWithLength:value.length
                                              status:&status];
  assert(memory != nil);
  assert([memory borrow:^BOOL(uint8_t *bytes, size_t length) {
           memcpy(bytes, value.bytes, length);
           return YES;
         }] == AncPrivateVaultGuardedMemoryStatusOK);
  return memory;
}

static NSString *Hex(NSData *data) {
  static const char digits[] = "0123456789abcdef";
  NSMutableData *encoded = [NSMutableData dataWithLength:data.length * 2];
  const uint8_t *input = data.bytes;
  uint8_t *output = encoded.mutableBytes;
  for (NSUInteger index = 0; index < data.length; index += 1) {
    output[index * 2] = digits[input[index] >> 4];
    output[index * 2 + 1] = digits[input[index] & 15];
  }
  return [[NSString alloc] initWithData:encoded
                               encoding:NSASCIIStringEncoding];
}

static NSData *Hash(NSString *domain, NSData *payload) {
  NSData *domainBytes = [domain dataUsingEncoding:NSASCIIStringEncoding];
  NSMutableData *terminated = [domainBytes mutableCopy];
  uint8_t zero = 0;
  [terminated appendBytes:&zero length:1];
  uint8_t digest[32] = {0};
  assert(anc_pv_blake2b_256_two_part(
             digest, terminated.bytes, terminated.length, payload.bytes,
             payload.length) == ANC_PV_CRYPTO_OK);
  NSData *result = [NSData dataWithBytes:digest length:sizeof digest];
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

static NSData *SignedEntry(NSData *authorization) {
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(
      authorization, 256 * 1024, &status);
  AncPrivateVaultCanonicalValue *entry = root.mapValue[@375];
  assert(entry.type == AncPrivateVaultCanonicalTypeBytes &&
         entry.bytesValue.length > 0);
  return entry.bytesValue;
}

static AncPrivateVaultBootstrapFrame *Frame(NSData *entry, NSData *wrap,
                                             NSData *candidate,
                                             NSData *headHash,
                                             NSData *wrapHash,
                                             NSData *finalWrap,
                                             NSString *vaultId) {
  NSDictionary *control = @{
    @"version" : @1,
    @"suite" : @"anc/v1",
    @"type" : @"vault-bootstrap-response",
    @"vaultId" : vaultId,
    @"afterSequence" : @-1,
    @"throughSequence" : @0,
    @"head" : @{ @"sequence" : @0, @"hash" : Hex(headHash) },
    @"complete" : @YES,
    @"entryByteLengths" : @[ @(entry.length) ],
    @"entryRecoveryWrapByteLengths" : @[ @(wrap.length) ],
    @"entryEvidenceKinds" : @[ @"genesis" ],
    @"entryEvidenceByteLengths" : @[ @(candidate.length) ],
    @"recoveryWrapHash" : Hex(wrapHash),
    @"recoveryWrapByteLength" : @(finalWrap.length),
  };
  NSError *error = nil;
  NSData *json = [NSJSONSerialization dataWithJSONObject:control
                                                 options:0
                                                   error:&error];
  assert(error == nil && json.length > 0 && json.length <= 8 * 1024);
  uint32_t length = (uint32_t)json.length;
  uint8_t prefix[4] = {(uint8_t)(length >> 24), (uint8_t)(length >> 16),
                       (uint8_t)(length >> 8), (uint8_t)length};
  NSMutableData *encoded = [NSMutableData dataWithBytes:prefix length:4];
  [encoded appendData:json];
  [encoded appendData:entry];
  [encoded appendData:wrap];
  [encoded appendData:candidate];
  [encoded appendData:finalWrap];
  AncPrivateVaultBootstrapFrameStatus status;
  AncPrivateVaultBootstrapFrame *frame =
      AncPrivateVaultBootstrapFrameDecode(encoded, &status);
  assert(frame != nil && status == AncPrivateVaultBootstrapFrameStatusOK);
  return frame;
}

@interface GenesisFixture : NSObject
@property(nonatomic) AncPrivateVaultGuardedMemory *entropy;
@property(nonatomic) AncPrivateVaultGuardedMemory *signingSeed;
@property(nonatomic) AncPrivateVaultGuardedMemory *agreementSeed;
@property(nonatomic) AncPrivateVaultGuardedMemory *eek;
@property(nonatomic) NSData *expectedEEK;
@property(nonatomic) AncPrivateVaultBootstrapFrame *frame;
@end
@implementation GenesisFixture
@end

@interface RecoveryTestTransport : AncPrivateVaultHostedAppendTransport
@property(nonatomic) BOOL hold;
@property(nonatomic) dispatch_semaphore_t called;
@end
@implementation RecoveryTestTransport
- (instancetype)init {
  self = [super init];
  if (self != nil)
    _called = dispatch_semaphore_create(0);
  return self;
}
- (void)appendBody:(NSData *)body
       proofHeader:(NSString *)proofHeader
        completion:(AncPrivateVaultHostedAppendCompletion)completion {
  assert(body.length > 0 && proofHeader.length > 0);
  dispatch_semaphore_signal(self.called);
  if (self.hold)
    return;
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *root =
      AncPrivateVaultCanonicalDecode(body, 4 * 1024 * 1024, &status);
  NSData *entry = root.mapValue[@4].bytesValue;
  NSData *wrap = root.mapValue[@5].bytesValue;
  NSData *head = AncPrivateVaultControlLogSignedEntryDomainHash(entry);
  NSData *wrapHash = Hash(@"anc/v1/recovery-wrap", wrap);
  NSString *entryID = AncPrivateVaultControlLogSignedEntryEnvelopeId(entry);
  NSData *receipt = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:@{
        @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
        @2 : [AncPrivateVaultCanonicalValue integer:1],
        @3 : [AncPrivateVaultCanonicalValue
                 text:@"control-log-recovery-append-receipt"],
        @4 : [AncPrivateVaultCanonicalValue
                 text:@"21212121212121212121212121212121"],
        @5 : [AncPrivateVaultCanonicalValue text:entryID],
        @6 : [AncPrivateVaultCanonicalValue integer:1],
        @7 : [AncPrivateVaultCanonicalValue bytes:head],
        @8 : [AncPrivateVaultCanonicalValue bytes:wrapHash],
        @9 : [AncPrivateVaultCanonicalValue integer:(int64_t)wrap.length],
      }],
      &status);
  assert(receipt != nil &&
         AncPrivateVaultRecoveryHostedAppendReceiptDecode(receipt) != nil);
  completion(AncPrivateVaultHostedAppendTransportStatusOK, receipt);
}
@end

static GenesisFixture *BuildFixture(BOOL corruptFinalWrap) {
  NSData *entropyBytes = Pattern(0x11, 32);
  NSData *signingBytes = Pattern(0x12, 32);
  NSData *agreementBytes = Pattern(0x13, 32);
  NSData *eekBytes = Pattern(0x14, 32);
  AncPrivateVaultGuardedMemory *entropy = Guarded(entropyBytes);
  AncPrivateVaultGuardedMemory *signing = Guarded(signingBytes);
  AncPrivateVaultGuardedMemory *agreement = Guarded(agreementBytes);
  AncPrivateVaultGuardedMemory *eek = Guarded(eekBytes);
  NSData *vaultId = Pattern(0x21, 16);
  AncPrivateVaultGenesisBuilderStatus builderStatus;
  AncPrivateVaultPreparedGenesisArtifacts *artifacts =
      AncPrivateVaultBuildGenesisArtifacts(
          entropy, signing, agreement, eek, vaultId, Pattern(0x22, 16),
          Pattern(0x23, 16), Pattern(0x24, 16), Pattern(0x25, 16),
          Pattern(0x26, 16), Pattern(0x27, 16), Pattern(0x28, 24),
          1721200000, 1721200010, 1721200020, 1721200030, 1721200040,
          &builderStatus);
  assert(artifacts != nil &&
         builderStatus == AncPrivateVaultGenesisBuilderStatusOK);
  AncPrivateVaultGenesisAdmissionStatus admissionStatus;
  NSData *candidate = AncPrivateVaultGenesisAdmissionCandidateEncode(
      artifacts.bootstrapTranscript, artifacts.recoveryConfirmation,
      artifacts.authorization, &admissionStatus);
  assert(candidate != nil &&
         admissionStatus == AncPrivateVaultGenesisAdmissionStatusOK);
  NSData *entry = SignedEntry(artifacts.authorization);
  NSData *headHash = Hash(@"anc/v1/log-entry", entry);
  NSData *wrapHash = Hash(@"anc/v1/recovery-wrap", artifacts.recoveryWrap);
  NSData *finalWrap = artifacts.recoveryWrap;
  if (corruptFinalWrap) {
    NSMutableData *corrupt = [finalWrap mutableCopy];
    ((uint8_t *)corrupt.mutableBytes)[corrupt.length - 1] ^= 1;
    finalWrap = corrupt;
  }
  AncPrivateVaultBootstrapFrame *frame =
      Frame(entry, artifacts.recoveryWrap, candidate, headHash, wrapHash,
            finalWrap, Hex(vaultId));
  GenesisFixture *fixture = [GenesisFixture new];
  fixture.entropy = entropy;
  fixture.signingSeed = signing;
  fixture.agreementSeed = agreement;
  fixture.eek = eek;
  fixture.expectedEEK = eekBytes;
  fixture.frame = frame;
  return fixture;
}

static void CloseInputs(GenesisFixture *fixture) {
  assert([fixture.signingSeed close] ==
         AncPrivateVaultGuardedMemoryStatusOK);
  assert([fixture.agreementSeed close] ==
         AncPrivateVaultGuardedMemoryStatusOK);
  assert([fixture.eek close] == AncPrivateVaultGuardedMemoryStatusOK);
}

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    GenesisFixture *fixture = BuildFixture(NO);
    CloseInputs(fixture);
    AncPrivateVaultBootstrapReplayStatus status;
    AncPrivateVaultBootstrapReplay *replay =
        [[AncPrivateVaultBootstrapReplay alloc]
            initWithOwnedRecoveryEntropy:fixture.entropy
                  trustedNowMilliseconds:UINT64_C(1721200060000)
                                  status:&status];
    assert(replay != nil && status == AncPrivateVaultBootstrapReplayStatusOK);
    assert([replay consumeFrame:fixture.frame status:&status]);
    assert(replay.isComplete && replay.state.sequence == 0 &&
           replay.currentRecoveryAuthority.recoveryGeneration == 1 &&
           replay.replacementRecoveryAuthority.recoveryGeneration == 2 &&
           fixture.entropy.isClosed);
    __block BOOL eekMatches = NO;
    assert([replay.verifiedEEK borrow:^BOOL(uint8_t *bytes, size_t length) {
             eekMatches = length == fixture.expectedEEK.length &&
                          memcmp(bytes, fixture.expectedEEK.bytes, length) == 0;
             return eekMatches;
           }] == AncPrivateVaultGuardedMemoryStatusOK);
    assert(eekMatches);
    AncPrivateVaultGuardedMemory *candidateSigning =
        Guarded(Pattern(0x31, 32));
    AncPrivateVaultGuardedMemory *candidateAgreement =
        Guarded(Pattern(0x32, 32));
    AncPrivateVaultRecoveryBuilderStatus builderStatus;
    AncPrivateVaultPreparedRecoveryArtifacts *prepared =
        AncPrivateVaultBuildRecoveryArtifacts(
            replay, candidateSigning, candidateAgreement, Pattern(0x33, 16),
            Pattern(0x34, 16), Pattern(0x35, 16), Pattern(0x36, 16),
            Pattern(0x37, 16), Pattern(0x38, 16), Pattern(0x39, 16),
            Pattern(0x3a, 24), Pattern(0x3b, 32),
            UINT64_C(1721200060000), &builderStatus);
    assert(prepared != nil &&
           builderStatus == AncPrivateVaultRecoveryBuilderStatusOK &&
           prepared.signedEntry.length > 0 &&
           prepared.recoveryWrap.length > 0 &&
           prepared.currentSnapshot.length > 0 &&
           prepared.currentStateSnapshot.length > 0 &&
           prepared.recoveryAuthorization.length > 0 &&
           prepared.entryHash.length == 32 &&
           prepared.authorizationHash.length == 32 &&
           prepared.snapshotHash.length == 32 &&
           [prepared.entryId isEqualToString:Hex(Pattern(0x39, 16))] &&
           prepared.nextState.sequence == 1 && prepared.nextState.epoch == 2 &&
           prepared.nextState.recoveryGeneration == 2 &&
           prepared.nextState.activeMembers.count == 1 &&
           [prepared.nextState.activeMembers[0].endpointId
               isEqualToString:Hex(Pattern(0x34, 16))]);
    AncPrivateVaultVerifiedReplayResult *recoveryCapability =
        AncPrivateVaultVerifiedRecoveryBootstrapResultCreate(
            prepared, UINT64_C(1721200060000));
    assert(recoveryCapability != nil &&
           recoveryCapability.expectedCheckpoint == nil &&
           recoveryCapability.nextSnapshot.targetCustodyGeneration == 2 &&
           recoveryCapability.nextSnapshot.previousCustodyGeneration == 1 &&
           recoveryCapability.nextSnapshot.previousSequence.unsignedLongLongValue ==
               0 &&
           [recoveryCapability.nextSnapshot.previousHead
               isEqualToData:replay.state.headHash] &&
           recoveryCapability.nextSnapshot.sequence == 1 &&
           recoveryCapability.nextSnapshot.epoch == 2 &&
           recoveryCapability.nextSnapshot.recoveryGeneration == 2);
    gRecoveryKeychain = [NSMutableDictionary dictionary];
    AncPrivateVaultKeychain *recoveryKeychain = RecoveryKeychain();
    AncPrivateVaultCustodyRepository *repository =
        RecoveryRepository(recoveryKeychain);
    AncPrivateVaultRecoveryPreparationStore *preparationStore =
        [[AncPrivateVaultRecoveryPreparationStore alloc]
            initWithKeychain:recoveryKeychain];
    NSMutableData *localStateKey = [Pattern(0x3c, 32) mutableCopy];
    NSMutableData *zeroEpochKey = [NSMutableData dataWithLength:32];
    NSData *artifactCommitment =
        AncPrivateVaultRecoveryPreparationArtifactsCommitment(
            prepared.signedEntry, prepared.recoveryWrap,
            prepared.currentSnapshot, prepared.currentStateSnapshot,
            prepared.recoveryAuthorization);
    NSData *preparedWrapHash =
        Hash(@"anc/v1/recovery-wrap", prepared.recoveryWrap);
    AncPrivateVaultRecoveryPreparationSnapshot preparation = {0};
    memcpy(preparation.vault_id, Pattern(0x21, 16).bytes, 16);
    memcpy(preparation.lookup_id, Pattern(0x3d, 16).bytes, 16);
    memcpy(preparation.ceremony_id, Pattern(0x33, 16).bytes, 16);
    memcpy(preparation.candidate_endpoint_id, Pattern(0x34, 16).bytes, 16);
    memcpy(preparation.artifact_digest, Pattern(0x3e, 32).bytes, 32);
    preparation.verified_at_ms = UINT64_C(1721200060000);
    preparation.next_epoch = prepared.nextState.epoch;
    preparation.replacement_recovery_generation =
        prepared.nextState.recoveryGeneration;
    preparation.expected_next_sequence = prepared.nextState.sequence;
    memcpy(preparation.expected_previous_head, replay.state.headHash.bytes, 32);
    memcpy(preparation.recovery_authorization_hash,
           prepared.authorizationHash.bytes, 32);
    memcpy(preparation.entry_id, Pattern(0x39, 16).bytes, 16);
    memcpy(preparation.entry_hash, prepared.entryHash.bytes, 32);
    memcpy(preparation.recovery_wrap_hash, preparedWrapHash.bytes, 32);
    memcpy(preparation.candidate_signing_public_key,
           prepared.candidateSigningPublicKey.bytes, 32);
    memcpy(preparation.candidate_key_agreement_public_key,
           prepared.candidateKeyAgreementPublicKey.bytes, 32);
    preparation.recovery_wrap_byte_length = prepared.recoveryWrap.length;
    memcpy(preparation.artifact_commitment, artifactCommitment.bytes, 32);
    __block AncPrivateVaultCustodyRepositoryStatus installStatus =
        AncPrivateVaultCustodyRepositoryStatusFailed;
    __block AncPrivateVaultRecoveryPreparationStoreStatus preparationStatus =
        AncPrivateVaultRecoveryPreparationStoreStatusFailed;
    AncPrivateVaultGuardedMemoryStatus signingBorrow =
        [candidateSigning borrow:^BOOL(uint8_t *signingBytes,
                                        size_t signingLength) {
      return [candidateAgreement borrow:^BOOL(uint8_t *agreementBytes,
                                               size_t agreementLength) {
        return [replay.verifiedEEK borrow:^BOOL(uint8_t *eekBytes,
                                                size_t eekLength) {
          if (signingLength != 32 || agreementLength != 32 ||
              eekLength != 32)
            return NO;
          AncPrivateVaultCustodySecretInputs secrets = {
              .signing_seed = signingBytes,
              .box_seed = agreementBytes,
              .local_state_key = localStateKey.mutableBytes,
              .active_epoch_key = zeroEpochKey.mutableBytes,
              .pending_epoch_key = eekBytes,
          };
          AncPrivateVaultRecoveryPreparationSecretInputs preparationSecrets = {
              .endpoint_signing_seed = signingBytes,
              .endpoint_box_seed = agreementBytes,
              .local_state_key = localStateKey.mutableBytes,
              .eek = eekBytes,
          };
          preparationStatus =
              [preparationStore createSnapshot:&preparation
                                        secrets:&preparationSecrets];
          if (preparationStatus !=
              AncPrivateVaultRecoveryPreparationStoreStatusOK)
            return NO;
          installStatus = [repository
              installPendingRecoveryVaultId:replay.state.vaultId
                                  endpointId:Hex(Pattern(0x34, 16))
                                  ceremonyId:Hex(Pattern(0x33, 16))
                             signingPublicKey:
                                 prepared.candidateSigningPublicKey
                                  boxPublicKey:
                                      prepared.candidateKeyAgreementPublicKey
                                    nextEpoch:prepared.nextState.epoch
                    replacementRecoveryGeneration:
                        prepared.nextState.recoveryGeneration
                            expectedNextSequence:prepared.nextState.sequence
                             expectedPreviousHead:replay.state.headHash
                       recoveryAuthorizationHash:
                           prepared.authorizationHash
                                     secrets:&secrets
                                  checkpoint:nil];
          return installStatus == AncPrivateVaultCustodyRepositoryStatusOK;
        }] == AncPrivateVaultGuardedMemoryStatusOK;
      }] == AncPrivateVaultGuardedMemoryStatusOK;
    }];
    assert(signingBorrow == AncPrivateVaultGuardedMemoryStatusOK);
    assert(installStatus == AncPrivateVaultCustodyRepositoryStatusOK);
    assert(preparationStatus ==
           AncPrivateVaultRecoveryPreparationStoreStatusOK);
    AncPrivateVaultRecoveryPreparationEvidence *persistedEvidence = nil;
    assert([preparationStore readEvidenceVaultId:replay.state.vaultId
                                       evidence:&persistedEvidence
                                         handle:nil] ==
           AncPrivateVaultRecoveryPreparationStoreStatusOK);
    AncPrivateVaultPreparedRecoveryArtifacts *restored =
        AncPrivateVaultRestorePreparedRecoveryArtifacts(
            persistedEvidence, prepared.signedEntry, prepared.recoveryWrap,
            prepared.currentSnapshot, prepared.currentStateSnapshot,
            prepared.recoveryAuthorization);
    assert(restored != nil &&
           [restored.entryHash isEqualToData:prepared.entryHash] &&
           restored.nextState.sequence == prepared.nextState.sequence);
    NSMutableData *substitutedEntry = [prepared.signedEntry mutableCopy];
    ((uint8_t *)substitutedEntry.mutableBytes)[substitutedEntry.length - 1] ^=
        1;
    assert(AncPrivateVaultRestorePreparedRecoveryArtifacts(
               persistedEvidence, substitutedEntry, prepared.recoveryWrap,
               prepared.currentSnapshot, prepared.currentStateSnapshot,
               prepared.recoveryAuthorization) == nil);
    recoveryCapability =
        AncPrivateVaultVerifiedRecoveryBootstrapResultCreate(
            restored, UINT64_C(1721200060000));
    assert(recoveryCapability != nil);
    NSString *authorityRoot = [NSTemporaryDirectory()
        stringByAppendingPathComponent:[NSString
            stringWithFormat:@"recovery-authority-%@",
                             NSUUID.UUID.UUIDString]];
    assert([NSFileManager.defaultManager
               createDirectoryAtPath:authorityRoot
         withIntermediateDirectories:YES
                          attributes:@{NSFilePosixPermissions : @0700}
                               error:nil]);
    AncPrivateVaultAuthorityStore *authorityStore =
        [[AncPrivateVaultAuthorityStore alloc]
            initWithStateRootURL:
                [NSURL fileURLWithPath:authorityRoot isDirectory:YES]
               custodyRepository:repository];
    AncPrivateVaultAuthorityCheckpoint *committed = nil;
    assert([authorityStore
               commitVerifiedReplayResult:recoveryCapability
                                    vaultId:replay.state.vaultId
                               verifiedAtMs:UINT64_C(1721200060000)
                                 checkpoint:&committed
                                      error:nil] ==
           AncPrivateVaultAuthorityStoreStatusOK);
    assert(committed.custodyGeneration == 2 &&
           committed.snapshot.sequence == prepared.nextState.sequence &&
           [committed.snapshot.headHash isEqualToData:prepared.entryHash]);
    AncPrivateVaultCustodySnapshot promoted;
    AncPrivateVaultCustodyHandle *promotedHandle = nil;
    assert([repository readVaultId:replay.state.vaultId snapshot:&promoted
                              handle:&promotedHandle] ==
           AncPrivateVaultCustodyRepositoryStatusOK);
    assert(promoted.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_ACTIVE &&
           promoted.authority_anchor_present && promoted.active_epoch == 2 &&
           promoted.pending_epoch == 0 && promoted.custody_generation == 2);
    __block BOOL promotedEEKMatches = NO;
    assert([promotedHandle
               borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
                 promotedEEKMatches =
                     memcmp(secrets->active_epoch_key,
                            fixture.expectedEEK.bytes, 32) == 0 &&
                     memcmp(secrets->pending_epoch_key,
                            zeroEpochKey.bytes, 32) == 0;
                 return promotedEEKMatches;
               }] == AncPrivateVaultCustodyRepositoryStatusOK);
    assert(promotedEEKMatches &&
           [promotedHandle close] ==
               AncPrivateVaultCustodyRepositoryStatusOK);
    AncPrivateVaultVerifiedReplayResult *retryCapability =
        AncPrivateVaultVerifiedRecoveryBootstrapResultCreate(
            prepared, UINT64_C(1721200060000));
    assert(retryCapability != nil &&
           [authorityStore
               commitVerifiedReplayResult:retryCapability
                                    vaultId:replay.state.vaultId
                               verifiedAtMs:UINT64_C(1721200060000)
                                 checkpoint:nil
                                      error:nil] ==
               AncPrivateVaultAuthorityStoreStatusOK);
    assert([NSFileManager.defaultManager removeItemAtPath:authorityRoot
                                                    error:nil]);
    anc_pv_zeroize(localStateKey.mutableBytes, localStateKey.length);
    anc_pv_zeroize(zeroEpochKey.mutableBytes, zeroEpochKey.length);
    assert(!candidateSigning.isClosed && !candidateAgreement.isClosed);
    assert([candidateSigning close] == AncPrivateVaultGuardedMemoryStatusOK);
    assert([candidateAgreement close] == AncPrivateVaultGuardedMemoryStatusOK);
    [replay invalidate];

    GenesisFixture *restartFixture = BuildFixture(NO);
    CloseInputs(restartFixture);
    AncPrivateVaultBootstrapReplay *restartReplay =
        [[AncPrivateVaultBootstrapReplay alloc]
            initWithOwnedRecoveryEntropy:restartFixture.entropy
                  trustedNowMilliseconds:UINT64_C(1721200060000)
                                  status:&status];
    assert(restartReplay != nil &&
           [restartReplay consumeFrame:restartFixture.frame status:&status] &&
           restartReplay.isComplete);
    gRecoveryKeychain = [NSMutableDictionary dictionary];
    AncPrivateVaultKeychain *restartKeychain = RecoveryKeychain();
    NSString *recoveryRoot = [NSTemporaryDirectory()
        stringByAppendingPathComponent:[NSString
            stringWithFormat:@"recovery-coordinator-%@",
                             NSUUID.UUID.UUIDString]];
    assert([NSFileManager.defaultManager
               createDirectoryAtPath:recoveryRoot
         withIntermediateDirectories:YES
                          attributes:@{NSFilePosixPermissions : @0700}
                               error:nil]);
    NSURL *recoveryRootURL =
        [NSURL fileURLWithPath:recoveryRoot isDirectory:YES];
    AncPrivateVaultRecoveryPreparationStore *restartPreparation =
        [[AncPrivateVaultRecoveryPreparationStore alloc]
            initWithKeychain:restartKeychain];
    AncPrivateVaultGenesisPreparationArtifactStore *restartArtifacts =
        [[AncPrivateVaultGenesisPreparationArtifactStore alloc]
            initWithStateRootURL:recoveryRootURL];
    AncPrivateVaultHostedAppendRetryStore *restartRetry =
        [[AncPrivateVaultHostedAppendRetryStore alloc]
            initWithStateRootURL:recoveryRootURL];
    AncPrivateVaultCustodyRepository *restartRepository =
        RecoveryRepository(restartKeychain);
    AncPrivateVaultAuthorityStore *restartAuthority =
        [[AncPrivateVaultAuthorityStore alloc]
            initWithStateRootURL:recoveryRootURL
               custodyRepository:restartRepository];
    RecoveryTestTransport *heldTransport = [RecoveryTestTransport new];
    heldTransport.hold = YES;
    AncPrivateVaultRecoveryCoordinator *firstCoordinator =
        [[AncPrivateVaultRecoveryCoordinator alloc]
            initWithPreparationStore:restartPreparation
                        artifactStore:restartArtifacts
                           retryStore:restartRetry
                    custodyRepository:restartRepository
                        authorityStore:restartAuthority
                             transport:heldTransport];
    [firstCoordinator beginWithReplay:restartReplay
                           completion:^(
                               AncPrivateVaultRecoveryCoordinatorStatus ignored,
                               NSString *ignoredVaultID) {
                             (void)ignored;
                             (void)ignoredVaultID;
                             assert(false);
                           }];
    assert(dispatch_semaphore_wait(
               heldTransport.called,
               dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) == 0);

    AncPrivateVaultKeychain *resumedKeychain = RecoveryKeychain();
    AncPrivateVaultRecoveryPreparationStore *resumedPreparation =
        [[AncPrivateVaultRecoveryPreparationStore alloc]
            initWithKeychain:resumedKeychain];
    AncPrivateVaultGenesisPreparationArtifactStore *resumedArtifacts =
        [[AncPrivateVaultGenesisPreparationArtifactStore alloc]
            initWithStateRootURL:recoveryRootURL];
    AncPrivateVaultHostedAppendRetryStore *resumedRetry =
        [[AncPrivateVaultHostedAppendRetryStore alloc]
            initWithStateRootURL:recoveryRootURL];
    AncPrivateVaultCustodyRepository *resumedRepository =
        RecoveryRepository(resumedKeychain);
    AncPrivateVaultAuthorityStore *resumedAuthority =
        [[AncPrivateVaultAuthorityStore alloc]
            initWithStateRootURL:recoveryRootURL
               custodyRepository:resumedRepository];
    RecoveryTestTransport *successTransport = [RecoveryTestTransport new];
    AncPrivateVaultRecoveryCoordinator *resumedCoordinator =
        [[AncPrivateVaultRecoveryCoordinator alloc]
            initWithPreparationStore:resumedPreparation
                        artifactStore:resumedArtifacts
                           retryStore:resumedRetry
                    custodyRepository:resumedRepository
                        authorityStore:resumedAuthority
                             transport:successTransport];
    dispatch_semaphore_t recoveryComplete = dispatch_semaphore_create(0);
    __block AncPrivateVaultRecoveryCoordinatorStatus completedStatus =
        AncPrivateVaultRecoveryCoordinatorStatusInvalid;
    [resumedCoordinator
        resumeVaultId:@"21212121212121212121212121212121"
           completion:^(AncPrivateVaultRecoveryCoordinatorStatus result,
                        NSString *completedVaultID) {
             assert([completedVaultID
                 isEqualToString:@"21212121212121212121212121212121"]);
             completedStatus = result;
             dispatch_semaphore_signal(recoveryComplete);
           }];
    assert(dispatch_semaphore_wait(
               recoveryComplete,
               dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) == 0);
    assert(completedStatus == AncPrivateVaultRecoveryCoordinatorStatusOK);
    AncPrivateVaultAuthorityCheckpoint *recoveredCheckpoint = nil;
    assert([resumedAuthority
               loadVaultId:@"21212121212121212121212121212121"
                checkpoint:&recoveredCheckpoint
                     error:nil] == AncPrivateVaultAuthorityStoreStatusOK);
    assert(recoveredCheckpoint.custodyGeneration == 2 &&
           recoveredCheckpoint.snapshot.sequence == 1);
    NSArray<NSData *> *remainingRetries = nil;
    assert([resumedRetry listVaultIds:&remainingRetries] ==
               AncPrivateVaultHostedAppendRetryStoreStatusOK &&
           remainingRetries.count == 0);
    assert([resumedPreparation
               readEvidenceVaultId:@"21212121212121212121212121212121"
                           evidence:&persistedEvidence
                             handle:nil] ==
           AncPrivateVaultRecoveryPreparationStoreStatusNotFound);
    assert([NSFileManager.defaultManager removeItemAtPath:recoveryRoot
                                                    error:nil]);

    GenesisFixture *corrupt = BuildFixture(YES);
    CloseInputs(corrupt);
    replay = [[AncPrivateVaultBootstrapReplay alloc]
        initWithOwnedRecoveryEntropy:corrupt.entropy
              trustedNowMilliseconds:UINT64_C(1721200060000)
                              status:&status];
    assert(replay != nil);
    assert(![replay consumeFrame:corrupt.frame status:&status]);
    assert(status == AncPrivateVaultBootstrapReplayStatusFinalWrap &&
           corrupt.entropy.isClosed && replay.verifiedEEK == nil &&
           replay.currentRecoveryAuthority == nil &&
           replay.replacementRecoveryAuthority == nil);
    candidateSigning = Guarded(Pattern(0x41, 32));
    candidateAgreement = Guarded(Pattern(0x42, 32));
    assert(AncPrivateVaultBuildRecoveryArtifacts(
               replay, candidateSigning, candidateAgreement,
               Pattern(0x43, 16), Pattern(0x44, 16), Pattern(0x45, 16),
               Pattern(0x46, 16), Pattern(0x47, 16), Pattern(0x48, 16),
               Pattern(0x49, 16), Pattern(0x4a, 24), Pattern(0x4b, 32),
               UINT64_C(1721200060000), &builderStatus) == nil &&
           builderStatus == AncPrivateVaultRecoveryBuilderStatusInvalidArgument);
    assert([candidateSigning close] == AncPrivateVaultGuardedMemoryStatusOK);
    assert([candidateAgreement close] == AncPrivateVaultGuardedMemoryStatusOK);
  }
  puts("private-vault bootstrap replay tests passed");
  return 0;
}
