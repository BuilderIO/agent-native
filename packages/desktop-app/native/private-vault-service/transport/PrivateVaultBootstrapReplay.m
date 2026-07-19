#import "PrivateVaultBootstrapReplay.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultGenesisAccountAdmission.h"
#import "PrivateVaultGenesisAuthorization.h"
#import "PrivateVaultGenesisBootstrap.h"
#import "PrivateVaultRecoveryAuthorization.h"
#import "PrivateVaultRecoveryWrap.h"
#import "PrivateVaultRecoveryWrapInternal.h"

#include <math.h>

static const NSUInteger kRecoveryEvidenceMaximum = 2 * 1024 * 1024;

static void SetStatus(AncPrivateVaultBootstrapReplayStatus *status,
                      AncPrivateVaultBootstrapReplayStatus value) {
  if (status != NULL)
    *status = value;
}

static NSData *LowerHexData(NSString *hex, NSUInteger length) {
  if (![hex isKindOfClass:NSString.class] || hex.length != length * 2)
    return nil;
  NSMutableData *data = [NSMutableData dataWithLength:length];
  uint8_t *output = data.mutableBytes;
  for (NSUInteger index = 0; index < length; index += 1) {
    unichar high = [hex characterAtIndex:index * 2];
    unichar low = [hex characterAtIndex:index * 2 + 1];
    int left = high >= '0' && high <= '9' ? high - '0'
               : high >= 'a' && high <= 'f' ? high - 'a' + 10
                                             : -1;
    int right = low >= '0' && low <= '9' ? low - '0'
                : low >= 'a' && low <= 'f' ? low - 'a' + 10
                                           : -1;
    if (left < 0 || right < 0)
      return nil;
    output[index] = (uint8_t)((left << 4) | right);
  }
  return data;
}

static NSString *LowerHex(NSData *data) {
  if (![data isKindOfClass:NSData.class])
    return nil;
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

static uint64_t EntryTimeMilliseconds(NSData *signedEntry) {
  AncPrivateVaultCanonicalStatus canonical;
  AncPrivateVaultCanonicalValue *root =
      AncPrivateVaultCanonicalDecode(signedEntry, 64 * 1024, &canonical);
  AncPrivateVaultCanonicalValue *created = root.mapValue[@4];
  if (root.type != AncPrivateVaultCanonicalTypeMap ||
      created.type != AncPrivateVaultCanonicalTypeText)
    return 0;
  NSISO8601DateFormatter *formatter = [NSISO8601DateFormatter new];
  formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime |
                            NSISO8601DateFormatWithFractionalSeconds;
  NSDate *date = [formatter dateFromString:created.textValue];
  if (date == nil || date.timeIntervalSince1970 <= 0 ||
      date.timeIntervalSince1970 > (double)UINT64_MAX / 1000.0)
    return 0;
  return (uint64_t)llround(date.timeIntervalSince1970 * 1000.0);
}

static BOOL DecodeRecoveryEvidence(NSData *encoded, NSData **snapshot,
                                   NSData **authorization) {
  *snapshot = nil;
  *authorization = nil;
  if (encoded.length == 0 || encoded.length > kRecoveryEvidenceMaximum)
    return NO;
  AncPrivateVaultCanonicalStatus canonical;
  AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(
      encoded, kRecoveryEvidenceMaximum, &canonical);
  NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map =
      root.mapValue;
  if (root.type != AncPrivateVaultCanonicalTypeMap || map.count != 5 ||
      map[@1].type != AncPrivateVaultCanonicalTypeText ||
      ![map[@1].textValue isEqualToString:@"anc/v1"] ||
      map[@2].type != AncPrivateVaultCanonicalTypeInteger ||
      map[@2].integerValue != 1 ||
      map[@3].type != AncPrivateVaultCanonicalTypeText ||
      ![map[@3].textValue isEqualToString:@"recovery-control-evidence"] ||
      map[@4].type != AncPrivateVaultCanonicalTypeBytes ||
      map[@4].bytesValue.length == 0 || map[@4].bytesValue.length > 64 * 1024 ||
      map[@5].type != AncPrivateVaultCanonicalTypeBytes ||
      map[@5].bytesValue.length == 0 ||
      map[@5].bytesValue.length > 1024 * 1024)
    return NO;
  *snapshot = [map[@4].bytesValue copy];
  *authorization = [map[@5].bytesValue copy];
  return YES;
}

static AncPrivateVaultControlLogMember *MemberForWrap(
    AncPrivateVaultControlLogState *state, AncPrivateVaultRecoveryWrap *wrap) {
  NSString *issuerId = LowerHex(wrap.issuerEndpointId);
  for (AncPrivateVaultControlLogMember *member in state.activeMembers)
    if ([member.endpointId isEqualToString:issuerId])
      return member;
  return nil;
}

static void CloseAuthority(AncPrivateVaultRecoveryAuthority *authority) {
  if (authority == nil)
    return;
  [authority.signingPrivateKey close];
  [authority.keyAgreementPrivateKey close];
}

@interface AncPrivateVaultBootstrapReplay ()
@property(nonatomic) AncPrivateVaultGuardedMemory *recoveryEntropy;
@property(nonatomic, readwrite, nullable) AncPrivateVaultControlLogState *state;
@property(nonatomic, readwrite, nullable) NSData *currentRecoveryWrap;
@property(nonatomic, readwrite, nullable) AncPrivateVaultGuardedMemory *verifiedEEK;
@property(nonatomic, readwrite, nullable)
    AncPrivateVaultRecoveryAuthority *currentRecoveryAuthority;
@property(nonatomic, readwrite, nullable)
    AncPrivateVaultRecoveryAuthority *replacementRecoveryAuthority;
@property(nonatomic) AncPrivateVaultControlLog *controlLog;
@property(nonatomic) NSString *vaultId;
@property(nonatomic) uint64_t pinnedHeadSequence;
@property(nonatomic) NSString *pinnedHeadHash;
@property(nonatomic) int64_t cursor;
@property(nonatomic) uint64_t trustedNowMilliseconds;
@property(nonatomic) BOOL publicEvidenceOnly;
@property(nonatomic, readwrite, getter=isComplete) BOOL complete;
@property(nonatomic, readwrite) AncPrivateVaultBootstrapReplayStatus status;
@end

@implementation AncPrivateVaultBootstrapReplay

- (instancetype)
    initWithOwnedRecoveryEntropy:(AncPrivateVaultGuardedMemory *)recoveryEntropy
          trustedNowMilliseconds:(uint64_t)trustedNowMilliseconds
                          status:(AncPrivateVaultBootstrapReplayStatus *)status {
  SetStatus(status, AncPrivateVaultBootstrapReplayStatusInvalidArgument);
  self = [super init];
  if (self == nil)
    return nil;
  if (recoveryEntropy == nil || recoveryEntropy.length != 32 ||
      recoveryEntropy.isClosed || trustedNowMilliseconds == 0)
    return nil;
  _recoveryEntropy = recoveryEntropy;
  _controlLog = [AncPrivateVaultControlLog new];
  _cursor = -1;
  _trustedNowMilliseconds = trustedNowMilliseconds;
  _status = AncPrivateVaultBootstrapReplayStatusOK;
  SetStatus(status, _status);
  return self;
}

- (instancetype)
    initForPublicEnrollmentWithTrustedNowMilliseconds:
        (uint64_t)trustedNowMilliseconds
                                             status:
                                                 (AncPrivateVaultBootstrapReplayStatus *)status {
  SetStatus(status, AncPrivateVaultBootstrapReplayStatusInvalidArgument);
  self = [super init];
  if (self == nil || trustedNowMilliseconds == 0)
    return nil;
  _controlLog = [AncPrivateVaultControlLog new];
  _cursor = -1;
  _trustedNowMilliseconds = trustedNowMilliseconds;
  _publicEvidenceOnly = YES;
  _status = AncPrivateVaultBootstrapReplayStatusOK;
  SetStatus(status, _status);
  return self;
}

- (void)invalidate {
  [self.recoveryEntropy close];
  self.recoveryEntropy = nil;
  [self.verifiedEEK close];
  self.verifiedEEK = nil;
  CloseAuthority(self.currentRecoveryAuthority);
  self.currentRecoveryAuthority = nil;
  CloseAuthority(self.replacementRecoveryAuthority);
  self.replacementRecoveryAuthority = nil;
  self.currentRecoveryWrap = nil;
  self.state = nil;
  self.complete = NO;
}

- (void)dealloc {
  [self invalidate];
}

- (BOOL)fail:(AncPrivateVaultBootstrapReplayStatus)value
       output:(AncPrivateVaultBootstrapReplayStatus *)output {
  self.status = value;
  [self invalidate];
  SetStatus(output, value);
  return NO;
}

- (BOOL)acceptWrap:(NSData *)encodedWrap
            inState:(AncPrivateVaultControlLogState *)issuerState
          authority:(AncPrivateVaultRecoveryAuthority *)authority
       initializeEEK:(BOOL)initializeEEK {
  NSData *vault = LowerHexData(issuerState.vaultId, 16);
  AncPrivateVaultRecoveryWrapStatus wrapStatus;
  AncPrivateVaultRecoveryWrap *wrap = AncPrivateVaultRecoveryWrapDecode(
      encodedWrap, vault, &wrapStatus);
  AncPrivateVaultControlLogMember *issuer = MemberForWrap(issuerState, wrap);
  if (vault == nil || wrap == nil || issuer == nil || authority == nil)
    return NO;
  uint8_t opened[32] = {0};
  uint8_t *openedBytes = opened;
  __block BOOL copied = NO;
  AncPrivateVaultGuardedMemoryStatus borrowStatus =
      [authority.keyAgreementPrivateKey
          borrow:^BOOL(uint8_t *privateKey, size_t length) {
            if (length != 32)
              return NO;
            AncPrivateVaultRecoveryWrapStatus status =
                AncPrivateVaultRecoveryWrapUnseal(
                    encodedWrap, vault, issuer.signingPublicKey,
                    issuer.keyAgreementPublicKey, privateKey,
                    ^BOOL(const uint8_t *eek) {
                      memcpy(openedBytes, eek, 32);
                      copied = YES;
                      return YES;
                    });
            return status == AncPrivateVaultRecoveryWrapStatusOK && copied;
          }];
  BOOL accepted = borrowStatus == AncPrivateVaultGuardedMemoryStatusOK && copied;
  if (accepted && initializeEEK) {
    AncPrivateVaultGuardedMemoryStatus memoryStatus;
    AncPrivateVaultGuardedMemory *memory =
        [AncPrivateVaultGuardedMemory memoryWithLength:32 status:&memoryStatus];
    accepted = memory != nil &&
               [memory borrow:^BOOL(uint8_t *bytes, size_t length) {
                 memcpy(bytes, openedBytes, length);
                 return YES;
               }] == AncPrivateVaultGuardedMemoryStatusOK;
    if (accepted)
      self.verifiedEEK = memory;
    else
      [memory close];
  } else if (accepted) {
    accepted = self.verifiedEEK != nil &&
               [self.verifiedEEK borrow:^BOOL(uint8_t *bytes, size_t length) {
                 return length == 32 &&
                        anc_pv_memcmp(bytes, openedBytes, 32) ==
                            ANC_PV_CRYPTO_OK;
               }] == AncPrivateVaultGuardedMemoryStatusOK;
  }
  anc_pv_zeroize(opened, sizeof opened);
  return accepted;
}

- (AncPrivateVaultRecoveryAuthority *)deriveAuthority:(uint64_t)generation
                                               vault:(NSData *)vault {
  AncPrivateVaultRecoveryAuthorityStatus status;
  return AncPrivateVaultDeriveRecoveryAuthority(
      self.recoveryEntropy, vault, generation, &status);
}

- (BOOL)acceptPublicWrap:(NSData *)encodedWrap
                 inState:(AncPrivateVaultControlLogState *)state {
  NSData *vault = LowerHexData(state.vaultId, 16);
  AncPrivateVaultRecoveryWrapStatus wrapStatus;
  AncPrivateVaultRecoveryWrap *decoded =
      AncPrivateVaultRecoveryWrapDecode(encodedWrap, vault, &wrapStatus);
  AncPrivateVaultControlLogMember *issuer = MemberForWrap(state, decoded);
  AncPrivateVaultRecoveryWrap *verified =
      issuer == nil
          ? nil
          : AncPrivateVaultRecoveryWrapVerify(
                encodedWrap, vault, issuer.signingPublicKey, &wrapStatus);
  NSData *hash = verified == nil
                     ? nil
                     : AncPrivateVaultRecoveryWrapHash(encodedWrap, vault,
                                                        &wrapStatus);
  return verified != nil && hash != nil &&
         [hash isEqualToData:state.recoveryWrapHash] &&
         verified.recoveryGeneration == state.recoveryGeneration &&
         [LowerHex(verified.recoveryId) isEqualToString:state.recoveryId] &&
         [verified.recoveryKeyAgreementPublicKey
             isEqualToData:state.recoveryKeyAgreementPublicKey] &&
         verified.epoch == state.epoch &&
         verified.activationControlSequence <= state.sequence;
}

- (BOOL)consumeGenesisEntry:(NSData *)entry
                       wrap:(NSData *)wrap
                   evidence:(NSData *)evidence {
  if (self.state != nil || self.cursor != -1 || wrap == nil || evidence == nil)
    return NO;
  NSData *bootstrap = nil;
  NSData *confirmation = nil;
  NSData *authorization = nil;
  AncPrivateVaultGenesisAdmissionStatus admissionStatus;
  if (!AncPrivateVaultGenesisAdmissionCandidateDecode(
          evidence, &bootstrap, &confirmation, &authorization,
          &admissionStatus))
    return NO;
  NSData *vault = LowerHexData(self.vaultId, 16);
  AncPrivateVaultGenesisBootstrapStatus bootstrapStatus;
  AncPrivateVaultGenesisBootstrapResult *bootstrapResult =
      AncPrivateVaultGenesisBootstrapVerify(
          bootstrap, confirmation, vault, &bootstrapStatus);
  AncPrivateVaultRecoveryAuthority *authority = self.publicEvidenceOnly
      ? nil
      : [self deriveAuthority:1 vault:vault];
  if (bootstrapResult == nil ||
      bootstrapResult.transcript.recoveryGeneration != 1 ||
      (!self.publicEvidenceOnly &&
       (authority == nil ||
        ![bootstrapResult.transcript.recoveryId
            isEqualToData:authority.recoveryId] ||
        ![bootstrapResult.transcript.recoverySigningPublicKey
            isEqualToData:authority.signingPublicKey] ||
        ![bootstrapResult.transcript.recoveryKeyAgreementPublicKey
            isEqualToData:authority.keyAgreementPublicKey]))) {
    CloseAuthority(authority);
    return NO;
  }
  AncPrivateVaultGenesisAuthorizationStatus authorizationStatus;
  AncPrivateVaultGenesisAuthorizationVerifier *verifier =
      [[AncPrivateVaultGenesisAuthorizationVerifier alloc]
           initWithAuthorization:authorization
            recoveryConfirmation:confirmation
              bootstrapTranscript:bootstrap
                   bootstrapResult:bootstrapResult
                           status:&authorizationStatus];
  AncPrivateVaultControlLogReplayResult *replayed = nil;
  AncPrivateVaultControlLogStatus replayStatus = verifier == nil
      ? AncPrivateVaultControlLogStatusGenesisAuthorizationRequired
      : [self.controlLog replaySignedEntry:entry
                             currentState:nil
                                 verifier:verifier
                                   result:&replayed];
  AncPrivateVaultRecoveryWrapStatus wrapStatus;
  NSData *wrapHash = replayed == nil
                         ? nil
                         : AncPrivateVaultRecoveryWrapHash(
                               wrap, vault, &wrapStatus);
  if (replayStatus != AncPrivateVaultControlLogStatusOK || replayed == nil ||
      ![replayed.state.recoveryId
          isEqualToString:LowerHex(bootstrapResult.transcript.recoveryId)] ||
      ![replayed.state.recoverySigningPublicKey
          isEqualToData:bootstrapResult.transcript.recoverySigningPublicKey] ||
      ![replayed.state.recoveryKeyAgreementPublicKey
          isEqualToData:
              bootstrapResult.transcript.recoveryKeyAgreementPublicKey] ||
      ![wrapHash isEqualToData:replayed.state.recoveryWrapHash] ||
      !(self.publicEvidenceOnly
            ? [self acceptPublicWrap:wrap inState:replayed.state]
            : [self acceptWrap:wrap
                       inState:replayed.state
                     authority:authority
                  initializeEEK:YES])) {
    CloseAuthority(authority);
    return NO;
  }
  self.state = replayed.state;
  if (!self.publicEvidenceOnly)
    self.currentRecoveryAuthority = authority;
  self.currentRecoveryWrap = [wrap copy];
  return YES;
}

- (BOOL)consumeRecoveryEntry:(NSData *)entry
                        wrap:(NSData *)wrap
                    evidence:(NSData *)evidence {
  if (self.state == nil || self.currentRecoveryWrap == nil || wrap == nil ||
      evidence == nil)
    return NO;
  NSData *snapshot = nil;
  NSData *authorization = nil;
  if (!DecodeRecoveryEvidence(evidence, &snapshot, &authorization))
    return NO;
  NSData *vault = LowerHexData(self.state.vaultId, 16);
  AncPrivateVaultRecoveryAuthority *replacement = self.publicEvidenceOnly
      ? nil
      : [self deriveAuthority:self.state.recoveryGeneration + 1 vault:vault];
  uint64_t edgeTime = EntryTimeMilliseconds(entry);
  AncPrivateVaultRecoveryAuthorizationStatus authorizationStatus;
  id<AncPrivateVaultControlLogAuthorizationVerifier> verifier = nil;
  if (edgeTime != 0 && self.publicEvidenceOnly) {
    verifier = [[AncPrivateVaultRecoveryPublicEvidenceVerifier alloc]
         initWithAuthorization:authorization
               currentSnapshot:snapshot
           currentRecoveryWrap:self.currentRecoveryWrap
       trustedNowMilliseconds:self.trustedNowMilliseconds
                         status:&authorizationStatus];
  } else if (edgeTime != 0 && replacement != nil) {
    verifier = [[AncPrivateVaultRecoveryAuthorizationVerifier alloc]
         initWithAuthorization:authorization
               currentSnapshot:snapshot
           currentRecoveryWrap:self.currentRecoveryWrap
             consumedAuthority:self.currentRecoveryAuthority
          replacementAuthority:replacement
       trustedNowMilliseconds:self.trustedNowMilliseconds
                         status:&authorizationStatus];
  }
  AncPrivateVaultControlLogReplayResult *replayed = nil;
  AncPrivateVaultControlLogStatus replayStatus = verifier == nil
      ? AncPrivateVaultControlLogStatusRecoveryAuthorizationRequired
      : [self.controlLog replaySignedEntry:entry
                             currentState:self.state
                                 verifier:verifier
                                   result:&replayed];
  AncPrivateVaultRecoveryWrapStatus wrapStatus;
  NSData *wrapHash = replayed == nil
                         ? nil
                         : AncPrivateVaultRecoveryWrapHash(wrap, vault,
                                                          &wrapStatus);
  AncPrivateVaultRecoveryAuthorizationResult *authorizationResult =
      self.publicEvidenceOnly
          ? [(AncPrivateVaultRecoveryPublicEvidenceVerifier *)verifier result]
          : [(AncPrivateVaultRecoveryAuthorizationVerifier *)verifier result];
  if (replayStatus != AncPrivateVaultControlLogStatusOK || replayed == nil ||
      authorizationResult == nil ||
      ![wrapHash isEqualToData:authorizationResult.replacementWrapHash] ||
      ![wrapHash isEqualToData:replayed.state.recoveryWrapHash]) {
    CloseAuthority(replacement);
    return NO;
  }
  if (!self.publicEvidenceOnly) {
    CloseAuthority(self.currentRecoveryAuthority);
    self.currentRecoveryAuthority = replacement;
  }
  self.currentRecoveryWrap = [wrap copy];
  self.state = replayed.state;
  return YES;
}

- (BOOL)consumeOrdinaryEntry:(NSData *)entry wrap:(NSData *)wrap {
  if (self.state == nil)
    return NO;
  AncPrivateVaultControlLogState *prior = self.state;
  AncPrivateVaultRecoveryWrapRotationVerifier *verifier =
      wrap == nil
          ? nil
          : [[AncPrivateVaultRecoveryWrapRotationVerifier alloc]
                initWithEncodedWrap:wrap
             trustedNowMilliseconds:self.trustedNowMilliseconds];
  AncPrivateVaultControlLogReplayResult *replayed = nil;
  AncPrivateVaultControlLogStatus status =
      [self.controlLog replaySignedEntry:entry
                           currentState:prior
                               verifier:verifier
                                 result:&replayed];
  if (status != AncPrivateVaultControlLogStatusOK || replayed == nil)
    return NO;
  if (wrap != nil &&
      (!verifier.isVerified ||
       (!self.publicEvidenceOnly &&
        ![self acceptWrap:wrap
                   inState:prior
                 authority:self.currentRecoveryAuthority
              initializeEEK:NO])))
    return NO;
  self.state = replayed.state;
  if (wrap != nil)
    self.currentRecoveryWrap = [wrap copy];
  return YES;
}

- (BOOL)consumeFrame:(AncPrivateVaultBootstrapFrame *)frame
               status:(AncPrivateVaultBootstrapReplayStatus *)status {
  SetStatus(status, AncPrivateVaultBootstrapReplayStatusInvalidArgument);
  if (self.complete) {
    self.status = AncPrivateVaultBootstrapReplayStatusComplete;
    SetStatus(status, self.status);
    return NO;
  }
  if (frame == nil ||
      (!self.publicEvidenceOnly &&
       (self.recoveryEntropy == nil || self.recoveryEntropy.isClosed)) ||
      frame.entries.count == 0 ||
      frame.entries.count != frame.entryRecoveryWraps.count ||
      frame.entries.count != frame.entryEvidenceKinds.count ||
      frame.entries.count != frame.entryEvidence.count)
    return [self fail:AncPrivateVaultBootstrapReplayStatusInvalidArgument
                 output:status];
  if (self.vaultId == nil) {
    if (frame.afterSequence != -1 || LowerHexData(frame.vaultId, 16) == nil) {
      return [self fail:AncPrivateVaultBootstrapReplayStatusPagePin
                   output:status];
    }
    self.vaultId = [frame.vaultId copy];
    self.pinnedHeadSequence = frame.headSequence;
    self.pinnedHeadHash = [frame.headHash copy];
  } else if (![frame.vaultId isEqualToString:self.vaultId] ||
             frame.headSequence != self.pinnedHeadSequence ||
             ![frame.headHash isEqualToString:self.pinnedHeadHash]) {
    return [self fail:AncPrivateVaultBootstrapReplayStatusPagePin
                 output:status];
  }
  if (frame.afterSequence != self.cursor ||
      frame.throughSequence !=
          frame.afterSequence + (int64_t)frame.entries.count) {
    return [self fail:AncPrivateVaultBootstrapReplayStatusPagePin
                 output:status];
  }

  for (NSUInteger index = 0; index < frame.entries.count; index += 1) {
    NSData *entry = frame.entries[index];
    id wrapValue = frame.entryRecoveryWraps[index];
    id kind = frame.entryEvidenceKinds[index];
    id evidenceValue = frame.entryEvidence[index];
    NSData *wrap = [wrapValue isKindOfClass:NSData.class] ? wrapValue : nil;
    NSData *evidence =
        [evidenceValue isKindOfClass:NSData.class] ? evidenceValue : nil;
    BOOL accepted = NO;
    if (self.cursor == -1) {
      accepted = [kind isEqual:@"genesis"] && evidence != nil && wrap != nil &&
                 [self consumeGenesisEntry:entry wrap:wrap evidence:evidence];
    } else if ([kind isEqual:@"recovery"]) {
      accepted = evidence != nil && wrap != nil &&
                 [self consumeRecoveryEntry:entry wrap:wrap evidence:evidence];
    } else if (kind == NSNull.null && evidence == nil) {
      accepted = [self consumeOrdinaryEntry:entry wrap:wrap];
    }
    if (!accepted)
      return [self fail:kind == NSNull.null
                            ? AncPrivateVaultBootstrapReplayStatusControlLog
                            : AncPrivateVaultBootstrapReplayStatusEvidence
                   output:status];
    self.cursor += 1;
    if (self.state.sequence != (uint64_t)self.cursor)
      return [self fail:AncPrivateVaultBootstrapReplayStatusControlLog
                   output:status];
  }
  if (self.cursor != frame.throughSequence)
    return [self fail:AncPrivateVaultBootstrapReplayStatusPagePin
                 output:status];

  if (frame.complete) {
    NSData *vault = LowerHexData(self.vaultId, 16);
    AncPrivateVaultRecoveryWrapStatus wrapStatus;
    NSData *finalHash = AncPrivateVaultRecoveryWrapHash(
        frame.recoveryWrap, vault, &wrapStatus);
    if (self.state.sequence != frame.headSequence ||
        ![LowerHex(self.state.headHash) isEqualToString:frame.headHash] ||
        frame.recoveryWrap == nil || frame.recoveryWrapHash == nil ||
        ![frame.recoveryWrap isEqualToData:self.currentRecoveryWrap] ||
        ![LowerHex(finalHash) isEqualToString:frame.recoveryWrapHash] ||
        ![finalHash isEqualToData:self.state.recoveryWrapHash]) {
      return [self fail:AncPrivateVaultBootstrapReplayStatusFinalWrap
                   output:status];
    }
    if (!self.publicEvidenceOnly) {
      AncPrivateVaultRecoveryAuthority *replacement =
          self.state.recoveryGeneration == UINT64_MAX
              ? nil
              : [self deriveAuthority:self.state.recoveryGeneration + 1
                                 vault:vault];
      if (replacement == nil ||
          [self.recoveryEntropy close] !=
              AncPrivateVaultGuardedMemoryStatusOK) {
        CloseAuthority(replacement);
        return [self fail:AncPrivateVaultBootstrapReplayStatusAuthority
                     output:status];
      }
      self.recoveryEntropy = nil;
      self.replacementRecoveryAuthority = replacement;
    }
    self.complete = YES;
  }
  self.status = AncPrivateVaultBootstrapReplayStatusOK;
  SetStatus(status, self.status);
  return YES;
}

@end

NSString *AncPrivateVaultBootstrapReplayCategory(
    AncPrivateVaultBootstrapReplayStatus status) {
  static NSArray<NSString *> *categories;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    categories = @[
      @"", @"input.invalid", @"page.pin", @"evidence.invalid",
      @"control.replay", @"authority.invalid", @"wrap.invalid",
      @"wrap.eek_continuity", @"wrap.final", @"state.complete"
    ];
  });
  return status >= 0 && (NSUInteger)status < categories.count
             ? categories[status]
             : @"unknown";
}
