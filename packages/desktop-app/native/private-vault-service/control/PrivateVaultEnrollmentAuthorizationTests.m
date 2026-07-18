#import <Foundation/Foundation.h>

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultAuthorityStoreInternal.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultEnrollmentAuthorization.h"
#import "PrivateVaultEnrollmentAuthorizationInternal.h"
#import "PrivateVaultEnrollmentCoordinator.h"
#import "PrivateVaultEnrollmentOffer.h"
#import "PrivateVaultEnrollmentSasReceipt.h"

#import <objc/runtime.h>

#include <assert.h>

static NSMutableDictionary<NSString *, NSData *> *gEnrollmentStore;

static NSString *EnrollmentKey(NSDictionary *query) {
  return
      [NSString stringWithFormat:@"%@|%@", query[(__bridge id)kSecAttrService],
                                 query[(__bridge id)kSecAttrAccount]];
}
static OSStatus EnrollmentCopy(CFDictionaryRef raw, CFTypeRef *result) {
  NSData *value = gEnrollmentStore[EnrollmentKey((__bridge NSDictionary *)raw)];
  if (value == nil)
    return errSecItemNotFound;
  if (result != NULL)
    *result = CFBridgingRetain([value copy]);
  return errSecSuccess;
}
static OSStatus EnrollmentAdd(CFDictionaryRef raw, CFTypeRef *result) {
  (void)result;
  NSDictionary *attributes = (__bridge NSDictionary *)raw;
  NSString *key = EnrollmentKey(attributes);
  if (gEnrollmentStore[key] != nil)
    return errSecDuplicateItem;
  NSData *value = attributes[(__bridge id)kSecValueData];
  gEnrollmentStore[key] = [NSData dataWithBytes:value.bytes
                                         length:value.length];
  return errSecSuccess;
}
static OSStatus EnrollmentUpdate(CFDictionaryRef rawQuery,
                                 CFDictionaryRef rawAttributes) {
  NSString *key = EnrollmentKey((__bridge NSDictionary *)rawQuery);
  if (gEnrollmentStore[key] == nil)
    return errSecItemNotFound;
  NSData *value =
      ((__bridge NSDictionary *)rawAttributes)[(__bridge id)kSecValueData];
  gEnrollmentStore[key] = [NSData dataWithBytes:value.bytes
                                         length:value.length];
  return errSecSuccess;
}
static OSStatus EnrollmentDelete(CFDictionaryRef raw) {
  NSString *key = EnrollmentKey((__bridge NSDictionary *)raw);
  if (gEnrollmentStore[key] == nil)
    return errSecItemNotFound;
  [gEnrollmentStore removeObjectForKey:key];
  return errSecSuccess;
}
static AncPrivateVaultKeychain *EnrollmentKeychain(void) {
  AncPrivateVaultSecItemFunctions functions = {.copyMatching = EnrollmentCopy,
                                               .add = EnrollmentAdd,
                                               .update = EnrollmentUpdate,
                                               .deleteItem = EnrollmentDelete};
  return [[AncPrivateVaultKeychain alloc]
      initWithFunctions:functions
         contextFactory:^LAContext * {
           return [[LAContext alloc] init];
         }
          storageDomain:@"enrollment-activation-test"];
}

@interface AncPrivateVaultControlLogMember (EnrollmentAuthorizationTests)
@property(nonatomic, readwrite) NSString *endpointId;
@property(nonatomic, readwrite) NSString *role;
@property(nonatomic, readwrite) BOOL unattended;
@property(nonatomic, readwrite) NSData *signingPublicKey;
@property(nonatomic, readwrite) NSData *keyAgreementPublicKey;
@property(nonatomic, readwrite) NSString *enrollmentRef;
@end
@interface AncPrivateVaultControlLogState (EnrollmentAuthorizationTests)
@property(nonatomic, readwrite) NSString *vaultId;
@property(nonatomic, readwrite) uint64_t sequence;
@property(nonatomic, readwrite) NSData *headHash;
@property(nonatomic, readwrite) NSData *membershipHash;
@property(nonatomic, readwrite) NSString *signedAt;
@property(nonatomic, readwrite)
    NSArray<AncPrivateVaultControlLogMember *> *activeMembers;
@property(nonatomic, readwrite) NSArray<NSString *> *removedEndpointIds;
@property(nonatomic, readwrite) uint64_t epoch;
@property(nonatomic, readwrite) uint64_t recoveryGeneration;
@property(nonatomic, readwrite) NSString *recoveryId;
@property(nonatomic, readwrite) NSData *recoverySigningPublicKey;
@property(nonatomic, readwrite) NSData *recoveryKeyAgreementPublicKey;
@property(nonatomic, readwrite) NSData *recoveryWrapHash;
@property(nonatomic, readwrite) NSString *freshnessMode;
@end

static NSData *Repeated(uint8_t byte, NSUInteger length) {
  NSMutableData *data = [NSMutableData dataWithLength:length];
  memset(data.mutableBytes, byte, length);
  return data;
}

static NSString *Hex(NSData *data) {
  const uint8_t *bytes = data.bytes;
  NSMutableString *value = [NSMutableString stringWithCapacity:data.length * 2];
  for (NSUInteger index = 0; index < data.length; index += 1)
    [value appendFormat:@"%02x", bytes[index]];
  return value;
}

static NSData *
Encode(NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map) {
  AncPrivateVaultCanonicalStatus status;
  NSData *encoded = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:map], &status);
  assert(status == AncPrivateVaultCanonicalStatusOK && encoded != nil);
  return encoded;
}

static NSData *Hash(const char *domain, NSData *payload) {
  uint8_t digest[32] = {0};
  assert(anc_pv_blake2b_256_two_part(digest, (const uint8_t *)domain,
                                     strlen(domain) + 1, payload.bytes,
                                     payload.length) == ANC_PV_CRYPTO_OK);
  NSData *result = [NSData dataWithBytes:digest length:sizeof digest];
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

static NSData *
Sign(NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *unsignedMap,
     NSNumber *signatureKey, const char *domain,
     const uint8_t signingPrivateKey[64]) {
  NSData *unsignedBytes = Encode(unsignedMap);
  NSMutableData *message = [NSMutableData dataWithBytes:domain
                                                 length:strlen(domain) + 1];
  [message appendData:unsignedBytes];
  uint8_t signature[64] = {0};
  assert(anc_pv_ed25519_sign(signature, message.bytes, message.length,
                             signingPrivateKey) == ANC_PV_CRYPTO_OK);
  NSMutableDictionary *signedMap = [unsignedMap mutableCopy];
  signedMap[signatureKey] = [AncPrivateVaultCanonicalValue
      bytes:[NSData dataWithBytes:signature length:sizeof signature]];
  anc_pv_zeroize(message.mutableBytes, message.length);
  anc_pv_zeroize(signature, sizeof signature);
  return Encode(signedMap);
}

static AncPrivateVaultCanonicalValue *
Member(NSData *endpointId, NSString *role, BOOL unattended, NSData *signingKey,
       NSData *agreementKey, NSData *enrollmentRef) {
  return [AncPrivateVaultCanonicalValue array:@[
    [AncPrivateVaultCanonicalValue text:Hex(endpointId)],
    [AncPrivateVaultCanonicalValue text:role],
    [AncPrivateVaultCanonicalValue boolean:unattended],
    [AncPrivateVaultCanonicalValue bytes:signingKey],
    [AncPrivateVaultCanonicalValue bytes:agreementKey],
    [AncPrivateVaultCanonicalValue text:Hex(enrollmentRef)],
  ]];
}

static AncPrivateVaultControlLogState *State(NSData *authorizerSigning,
                                             NSData *authorizerAgreement) {
  AncPrivateVaultControlLogMember *member =
      [[AncPrivateVaultControlLogMember alloc] init];
  member.endpointId = Hex(Repeated(0x02, 16));
  member.role = @"endpoint";
  member.unattended = NO;
  member.signingPublicKey = authorizerSigning;
  member.keyAgreementPublicKey = authorizerAgreement;
  member.enrollmentRef = Hex(Repeated(0x10, 16));
  AncPrivateVaultControlLogState *state =
      [[AncPrivateVaultControlLogState alloc] init];
  state.vaultId = Hex(Repeated(0x01, 16));
  state.sequence = 9;
  state.headHash = Repeated(0x71, 32);
  state.membershipHash = Repeated(0x72, 32);
  state.signedAt = @"2024-07-16T04:25:00.000Z";
  state.activeMembers = @[ member ];
  state.removedEndpointIds = @[];
  state.epoch = 7;
  state.recoveryGeneration = 1;
  state.recoveryId = Hex(Repeated(0x73, 16));
  state.recoverySigningPublicKey = Repeated(0x74, 32);
  state.recoveryKeyAgreementPublicKey = Repeated(0x75, 32);
  state.recoveryWrapHash = Repeated(0x76, 32);
  state.freshnessMode = @"endpoint_witnessed";
  return state;
}

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    NSData *vault = Repeated(0x01, 16);
    NSData *candidateId = Repeated(0x03, 16);
    NSData *authorizerId = Repeated(0x02, 16);
    NSData *ceremonyId = Repeated(0x0c, 16);
    NSData *authorizationId = Repeated(0x40, 16);
    uint8_t candidateSigningSeed[32], candidateBoxSeed[32];
    uint8_t authorizerSigningSeed[32], authorizerBoxSeed[32];
    memset(candidateSigningSeed, 0x12, sizeof candidateSigningSeed);
    memset(candidateBoxSeed, 0x33, sizeof candidateBoxSeed);
    memset(authorizerSigningSeed, 0x11, sizeof authorizerSigningSeed);
    memset(authorizerBoxSeed, 0x22, sizeof authorizerBoxSeed);
    uint8_t authorizerSigningPublic[32] = {0};
    uint8_t authorizerSigningPrivate[64] = {0};
    uint8_t authorizerBoxPublic[32] = {0};
    uint8_t authorizerBoxPrivate[32] = {0};
    uint8_t candidateBoxPublic[32] = {0};
    uint8_t candidateBoxPrivate[32] = {0};
    assert(anc_pv_ed25519_seed_keypair(
               authorizerSigningPublic, authorizerSigningPrivate,
               authorizerSigningSeed) == ANC_PV_CRYPTO_OK);
    assert(anc_pv_box_seed_keypair(authorizerBoxPublic, authorizerBoxPrivate,
                                   authorizerBoxSeed) == ANC_PV_CRYPTO_OK);
    assert(anc_pv_box_seed_keypair(candidateBoxPublic, candidateBoxPrivate,
                                   candidateBoxSeed) == ANC_PV_CRYPTO_OK);
    NSData *authorizerSigning = [NSData dataWithBytes:authorizerSigningPublic
                                               length:32];
    NSData *authorizerAgreement = [NSData dataWithBytes:authorizerBoxPublic
                                                 length:32];

    AncPrivateVaultEnrollmentOfferStatus offerStatus;
    AncPrivateVaultEnrollmentOfferResult *offer =
        AncPrivateVaultEnrollmentOfferBuild(
            vault, candidateId, ceremonyId, Repeated(0x0e, 16),
            Repeated(0xa5, 32), @"broker", YES, 1721111111, 1721111711,
            candidateSigningSeed, candidateBoxSeed, &offerStatus);
    assert(offerStatus == AncPrivateVaultEnrollmentOfferStatusOK &&
           offer != nil);

    NSDictionary *sasMap = @{
      @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
      @2 : [AncPrivateVaultCanonicalValue bytes:vault],
      @3 : [AncPrivateVaultCanonicalValue text:@"enrollment-sas"],
      @320 : [AncPrivateVaultCanonicalValue bytes:ceremonyId],
      @321 : [AncPrivateVaultCanonicalValue bytes:offer.offerHash],
      @322 : [AncPrivateVaultCanonicalValue bytes:candidateId],
      @323 : [AncPrivateVaultCanonicalValue bytes:offer.signingPublicKey],
      @324 : [AncPrivateVaultCanonicalValue bytes:offer.keyAgreementPublicKey],
      @325 : [AncPrivateVaultCanonicalValue bytes:offer.candidateKeyProof],
      @326 : [AncPrivateVaultCanonicalValue bytes:authorizerId],
      @327 : [AncPrivateVaultCanonicalValue bytes:authorizerSigning],
      @328 : [AncPrivateVaultCanonicalValue bytes:authorizerAgreement],
      @329 : [AncPrivateVaultCanonicalValue integer:9],
      @330 : [AncPrivateVaultCanonicalValue bytes:Repeated(0x71, 32)],
      @331 : [AncPrivateVaultCanonicalValue bytes:Repeated(0x72, 32)],
      @332 : [AncPrivateVaultCanonicalValue text:@"broker"],
      @333 : [AncPrivateVaultCanonicalValue bytes:Repeated(0xa7, 32)],
      @334 : [AncPrivateVaultCanonicalValue bytes:Repeated(0x0f, 16)],
      @335 : [AncPrivateVaultCanonicalValue integer:1721111120],
      @336 : [AncPrivateVaultCanonicalValue integer:1721111720],
    };
    NSData *sasHash = Hash("anc/v1/enrollment-sas", Encode(sasMap));
    NSDictionary *challengeUnsigned = @{
      @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
      @2 : [AncPrivateVaultCanonicalValue bytes:vault],
      @3 : [AncPrivateVaultCanonicalValue text:@"enrollment-challenge"],
      @4 : [AncPrivateVaultCanonicalValue integer:1721111120],
      @5 : [AncPrivateVaultCanonicalValue bytes:Repeated(0x0f, 16)],
      @170 : [AncPrivateVaultCanonicalValue bytes:offer.offerHash],
      @171 : [AncPrivateVaultCanonicalValue bytes:offer.candidateKeyProof],
      @172 : [AncPrivateVaultCanonicalValue bytes:authorizerId],
      @173 : [AncPrivateVaultCanonicalValue bytes:authorizerSigning],
      @174 : [AncPrivateVaultCanonicalValue bytes:authorizerAgreement],
      @175 : [AncPrivateVaultCanonicalValue integer:9],
      @176 : [AncPrivateVaultCanonicalValue bytes:Repeated(0x71, 32)],
      @177 : [AncPrivateVaultCanonicalValue bytes:Repeated(0x72, 32)],
      @178 : [AncPrivateVaultCanonicalValue text:@"broker"],
      @179 : [AncPrivateVaultCanonicalValue bytes:sasHash],
      @180 : [AncPrivateVaultCanonicalValue bytes:Repeated(0xa7, 32)],
      @181 : [AncPrivateVaultCanonicalValue integer:1721111720],
    };
    NSData *challenge =
        Sign(challengeUnsigned, @182, "anc/v1/enrollment-challenge",
             authorizerSigningPrivate);
    NSData *challengeHash = Hash("anc/v1/enrollment-challenge", challenge);

    NSDictionary *endpointUnsigned = @{
      @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
      @2 : [AncPrivateVaultCanonicalValue bytes:vault],
      @3 : [AncPrivateVaultCanonicalValue text:@"endpoint"],
      @4 : [AncPrivateVaultCanonicalValue integer:1721111150],
      @5 : [AncPrivateVaultCanonicalValue bytes:Repeated(0x20, 16)],
      @10 : [AncPrivateVaultCanonicalValue bytes:candidateId],
      @11 : [AncPrivateVaultCanonicalValue text:@"desktop-broker"],
      @12 : [AncPrivateVaultCanonicalValue boolean:YES],
      @13 : [AncPrivateVaultCanonicalValue bytes:offer.signingPublicKey],
      @14 : [AncPrivateVaultCanonicalValue bytes:offer.keyAgreementPublicKey],
      @15 : [AncPrivateVaultCanonicalValue bytes:authorizerId],
      @16 : [AncPrivateVaultCanonicalValue bytes:sasHash],
    };
    NSData *endpointEnvelope = Sign(endpointUnsigned, @17, "anc/v1/endpoint",
                                    authorizerSigningPrivate);

    uint8_t eekPlaintext[48] = {0};
    memcpy(eekPlaintext, "anc/v1/eek-wrap", 16);
    memset(eekPlaintext + 16, 0x44, 32);
    uint8_t eekCiphertext[64] = {0};
    size_t eekCiphertextLength = 0;
    NSData *wrapNonce = Repeated(0x91, 24);
    assert(anc_pv_box_wrap(
               eekCiphertext, sizeof eekCiphertext, &eekCiphertextLength,
               eekPlaintext, sizeof eekPlaintext, wrapNonce.bytes,
               candidateBoxPublic, authorizerBoxPrivate) == ANC_PV_CRYPTO_OK &&
           eekCiphertextLength == sizeof eekCiphertext);
    NSDictionary *wrapUnsigned = @{
      @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
      @2 : [AncPrivateVaultCanonicalValue bytes:vault],
      @3 : [AncPrivateVaultCanonicalValue text:@"eek-wrap"],
      @4 : [AncPrivateVaultCanonicalValue integer:1721111150],
      @5 : [AncPrivateVaultCanonicalValue bytes:Repeated(0x21, 16)],
      @30 : [AncPrivateVaultCanonicalValue integer:7],
      @31 : [AncPrivateVaultCanonicalValue bytes:candidateId],
      @32 : [AncPrivateVaultCanonicalValue bytes:authorizerId],
      @33 : [AncPrivateVaultCanonicalValue bytes:wrapNonce],
      @34 : [AncPrivateVaultCanonicalValue
          bytes:[NSData dataWithBytes:eekCiphertext length:64]],
    };
    NSData *eekWrap =
        Sign(wrapUnsigned, @35, "anc/v1/eek-wrap", authorizerSigningPrivate);
    anc_pv_zeroize(eekPlaintext, sizeof eekPlaintext);
    anc_pv_zeroize(eekCiphertext, sizeof eekCiphertext);

    AncPrivateVaultCanonicalValue *authorizerMember =
        Member(authorizerId, @"endpoint", NO, authorizerSigning,
               authorizerAgreement, Repeated(0x10, 16));
    AncPrivateVaultCanonicalValue *candidateMember =
        Member(candidateId, @"broker", YES, offer.signingPublicKey,
               offer.keyAgreementPublicKey, authorizationId);
    NSDictionary *commitMap = @{
      @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
      @2 : [AncPrivateVaultCanonicalValue text:Hex(vault)],
      @3 : [AncPrivateVaultCanonicalValue text:@"membership_commit"],
      @140 : [AncPrivateVaultCanonicalValue text:Hex(ceremonyId)],
      @141 : [AncPrivateVaultCanonicalValue text:@"add_broker"],
      @142 : [AncPrivateVaultCanonicalValue integer:7],
      @143 : [AncPrivateVaultCanonicalValue bytes:Repeated(0x72, 32)],
      @144 : [AncPrivateVaultCanonicalValue
          array:@[ authorizerMember, candidateMember ]],
      @145 : [AncPrivateVaultCanonicalValue array:@[]],
      @146 : [AncPrivateVaultCanonicalValue boolean:NO],
      @147 : [AncPrivateVaultCanonicalValue boolean:NO],
      @148 : [AncPrivateVaultCanonicalValue nullValue],
      @149 : [AncPrivateVaultCanonicalValue nullValue],
      @155 : [AncPrivateVaultCanonicalValue integer:1],
      @156 : [AncPrivateVaultCanonicalValue text:Hex(Repeated(0x73, 16))],
      @157 : [AncPrivateVaultCanonicalValue bytes:Repeated(0x74, 32)],
      @158 : [AncPrivateVaultCanonicalValue bytes:Repeated(0x75, 32)],
      @159 : [AncPrivateVaultCanonicalValue bytes:Repeated(0x76, 32)],
    };
    NSData *commitBytes = Encode(commitMap);
    NSDictionary *entryUnsigned = @{
      @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
      @2 : [AncPrivateVaultCanonicalValue text:Hex(vault)],
      @3 : [AncPrivateVaultCanonicalValue text:@"log-entry"],
      @4 : [AncPrivateVaultCanonicalValue text:@"2024-07-16T04:26:00.000Z"],
      @5 : [AncPrivateVaultCanonicalValue text:Hex(Repeated(0x30, 16))],
      @110 : [AncPrivateVaultCanonicalValue integer:10],
      @111 : [AncPrivateVaultCanonicalValue bytes:Repeated(0x71, 32)],
      @112 : [AncPrivateVaultCanonicalValue bytes:commitBytes],
      @113 : [AncPrivateVaultCanonicalValue text:Hex(authorizerId)],
    };
    NSData *signedCommit =
        Sign(entryUnsigned, @114, "anc/v1/log-entry", authorizerSigningPrivate);
    NSDictionary *authorizationUnsigned = @{
      @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
      @2 : [AncPrivateVaultCanonicalValue bytes:vault],
      @3 : [AncPrivateVaultCanonicalValue text:@"enrollment-authorization"],
      @4 : [AncPrivateVaultCanonicalValue integer:1721111150],
      @5 : [AncPrivateVaultCanonicalValue bytes:authorizationId],
      @300 : [AncPrivateVaultCanonicalValue bytes:offer.offerHash],
      @301 : [AncPrivateVaultCanonicalValue bytes:challengeHash],
      @302 : [AncPrivateVaultCanonicalValue bytes:authorizerId],
      @303 : [AncPrivateVaultCanonicalValue text:@"broker"],
      @304 : [AncPrivateVaultCanonicalValue integer:9],
      @305 : [AncPrivateVaultCanonicalValue bytes:Repeated(0x71, 32)],
      @306 : [AncPrivateVaultCanonicalValue bytes:Repeated(0x72, 32)],
      @307 : [AncPrivateVaultCanonicalValue bytes:endpointEnvelope],
      @308 : [AncPrivateVaultCanonicalValue bytes:eekWrap],
      @309 : [AncPrivateVaultCanonicalValue bytes:signedCommit],
      @310 : [AncPrivateVaultCanonicalValue integer:1721111750],
    };
    NSData *authorization =
        Sign(authorizationUnsigned, @311, "anc/v1/enrollment-authorization",
             authorizerSigningPrivate);
    AncPrivateVaultEnrollmentAuthorizationStatus status;
    AncPrivateVaultEnrollmentAuthorizationResult *verified =
        AncPrivateVaultEnrollmentAuthorizationVerify(
            offer.encodedOffer, challenge, authorization,
            State(authorizerSigning, authorizerAgreement), 1721111100,
            1721111161, [[AncPrivateVaultControlLog alloc] init], &status);
    assert(status == AncPrivateVaultEnrollmentAuthorizationStatusOK &&
           verified != nil && verified.replay.state.sequence == 10 &&
           verified.replay.state.activeMembers.count == 2 &&
           [verified.authorizationDigest
               isEqualToData:Hash("anc/v1/enrollment-authorization",
                                  authorization)]);
    NSData *copiedVault = nil, *copiedDigest = nil, *copiedEnvelope = nil,
           *copiedCeremony = nil, *copiedCandidate = nil, *copiedSigning = nil,
           *copiedAgreement = nil, *copiedOfferHash = nil,
           *copiedChallengeHash = nil, *copiedSasHash = nil,
           *copiedMembership = nil, *copiedCommit = nil;
    NSString *copiedRole = nil;
    BOOL copiedUnattended = NO;
    uint64_t copiedCreatedAt = 0, copiedExpiresAt = 0;
    AncPrivateVaultControlLogReplayResult *copiedReplay = nil;
    assert(AncPrivateVaultEnrollmentAuthorizationCopyEvidence(
               verified, &copiedVault, &copiedDigest, &copiedEnvelope,
               &copiedCeremony, &copiedCandidate, &copiedRole,
               &copiedUnattended, &copiedSigning, &copiedAgreement,
               &copiedOfferHash, &copiedChallengeHash, &copiedSasHash,
               &copiedCreatedAt, &copiedExpiresAt, &copiedMembership,
               &copiedCommit, &copiedReplay) &&
           [copiedVault isEqualToData:vault] &&
           [copiedDigest isEqualToData:verified.authorizationDigest] &&
           [copiedRole isEqualToString:@"broker"] && copiedUnattended &&
           copiedReplay == verified.replay);
    BOOL mutationRejected = NO;
    @try {
      [verified setValue:Repeated(0x99, 32) forKey:@"authorizationDigest"];
    } @catch (__unused NSException *exception) {
      mutationRejected = YES;
    }
    assert(mutationRejected);
    AncPrivateVaultEnrollmentAuthorizationResult *forged = class_createInstance(
        AncPrivateVaultEnrollmentAuthorizationResult.class, 0);
    assert(!AncPrivateVaultEnrollmentAuthorizationCopyEvidence(
        forged, &copiedVault, &copiedDigest, &copiedEnvelope, &copiedCeremony,
        &copiedCandidate, &copiedRole, &copiedUnattended, &copiedSigning,
        &copiedAgreement, &copiedOfferHash, &copiedChallengeHash,
        &copiedSasHash, &copiedCreatedAt, &copiedExpiresAt, &copiedMembership,
        &copiedCommit, &copiedReplay));
    AncPrivateVaultEnrollmentSasReceiptStatus sasReceiptStatus;
    AncPrivateVaultEnrollmentSasReceipt *confirmedReceipt =
        AncPrivateVaultEnrollmentSasReceiptBuild(
            verified.challenge, Repeated(0x5b, 16), 1721111162,
            AncPrivateVaultEnrollmentSasDecisionConfirmed, candidateSigningSeed,
            &sasReceiptStatus);
    AncPrivateVaultVerifiedReplayResult *activation =
        AncPrivateVaultVerifiedEnrollmentBootstrapResultCreate(
            verified, confirmedReceipt, UINT64_C(1721111162000));
    assert(sasReceiptStatus == AncPrivateVaultEnrollmentSasReceiptStatusOK &&
           activation != nil && activation.expectedCheckpoint == nil &&
           activation.nextSnapshot.targetCustodyGeneration == 3 &&
           activation.nextSnapshot.previousCustodyGeneration == 2 &&
           activation.nextSnapshot.sequence == verified.replay.state.sequence);
    AncPrivateVaultEnrollmentSasReceipt *mismatchReceipt =
        AncPrivateVaultEnrollmentSasReceiptBuild(
            verified.challenge, Repeated(0x5c, 16), 1721111163,
            AncPrivateVaultEnrollmentSasDecisionMismatch, candidateSigningSeed,
            &sasReceiptStatus);
    assert(mismatchReceipt != nil &&
           AncPrivateVaultVerifiedEnrollmentBootstrapResultCreate(
               verified, mismatchReceipt, UINT64_C(1721111163000)) == nil);

    gEnrollmentStore = [NSMutableDictionary dictionary];
    AncPrivateVaultKeychain *enrollmentKeychain = EnrollmentKeychain();
    AncPrivateVaultCustodyRepository *brokerRepository =
        [[AncPrivateVaultCustodyRepository alloc]
            initWithKeychain:enrollmentKeychain
                    recordId:AncPrivateVaultBrokerCustodyRecordId];
    AncPrivateVaultEnrollmentOfferArtifactStore *offerStore =
        [[AncPrivateVaultEnrollmentOfferArtifactStore alloc]
            initWithKeychain:enrollmentKeychain
                    recordId:AncPrivateVaultBrokerCustodyRecordId];
    AncPrivateVaultEnrollmentSasReceiptStore *receiptStore =
        [[AncPrivateVaultEnrollmentSasReceiptStore alloc]
            initWithKeychain:enrollmentKeychain
                    recordId:AncPrivateVaultBrokerCustodyRecordId];
    assert([offerStore storeVaultId:vault
                       encodedOffer:offer.encodedOffer
                          offerHash:offer.offerHash
                  candidateKeyProof:offer.candidateKeyProof] ==
           AncPrivateVaultEnrollmentOfferArtifactStatusOK);
    AncPrivateVaultCustodySnapshot pending = {0};
    pending.record_version = ANC_PV_CUSTODY_VERSION;
    pending.lifecycle = ANC_PV_CUSTODY_LIFECYCLE_PENDING;
    pending.role = ANC_PV_CUSTODY_ROLE_BROKER;
    pending.pending_kind = ANC_PV_CUSTODY_PENDING_ADD_BROKER;
    pending.enrollment_phase = ANC_PV_CUSTODY_ENROLLMENT_OFFER_PENDING;
    pending.custody_generation = 1;
    NSData *vaultText = [Hex(vault) dataUsingEncoding:NSUTF8StringEncoding];
    NSData *candidateText =
        [Hex(candidateId) dataUsingEncoding:NSUTF8StringEncoding];
    NSData *ceremonyText =
        [Hex(ceremonyId) dataUsingEncoding:NSUTF8StringEncoding];
    memcpy(pending.vault_id, vaultText.bytes, vaultText.length);
    pending.vault_id_length = vaultText.length;
    memcpy(pending.endpoint_id, candidateText.bytes, candidateText.length);
    pending.endpoint_id_length = candidateText.length;
    memcpy(pending.ceremony_id, ceremonyText.bytes, ceremonyText.length);
    pending.ceremony_id_length = ceremonyText.length;
    memcpy(pending.signing_public_key, offer.signingPublicKey.bytes, 32);
    memcpy(pending.box_public_key, offer.keyAgreementPublicKey.bytes, 32);
    memcpy(pending.pending_transcript_digest, offer.offerHash.bytes, 32);
    uint8_t localStateKey[32], activeZeroKey[32] = {0},
        pendingZeroKey[32] = {0};
    memset(localStateKey, 0x66, sizeof localStateKey);
    AncPrivateVaultCustodySecretInputs pendingSecrets = {
        .signing_seed = candidateSigningSeed,
        .box_seed = candidateBoxSeed,
        .local_state_key = localStateKey,
        .active_epoch_key = activeZeroKey,
        .pending_epoch_key = pendingZeroKey};
    AncPrivateVaultCustodyRepositoryStatus storedPending =
        [brokerRepository storeSnapshot:&pending
                                secrets:&pendingSecrets
                                vaultId:Hex(vault)];
    if (storedPending != AncPrivateVaultCustodyRepositoryStatusOK)
      fprintf(stderr, "pending custody store status: %ld\n",
              (long)storedPending);
    assert(storedPending == AncPrivateVaultCustodyRepositoryStatusOK);
    NSString *authorityRoot = [NSTemporaryDirectory()
        stringByAppendingPathComponent:
            [NSString stringWithFormat:@"enrollment-activation-%@",
                                       NSUUID.UUID.UUIDString]];
    assert([NSFileManager.defaultManager
              createDirectoryAtPath:authorityRoot
        withIntermediateDirectories:YES
                         attributes:@{
                           NSFilePosixPermissions : @0700
                         }
                              error:nil]);
    AncPrivateVaultAuthorityStore *authorityStore =
        [[AncPrivateVaultAuthorityStore alloc]
            initWithStateRootURL:[NSURL fileURLWithPath:authorityRoot
                                            isDirectory:YES]
               custodyRepository:brokerRepository];
    AncPrivateVaultEnrollmentCoordinator *coordinator =
        [[AncPrivateVaultEnrollmentCoordinator alloc]
            initWithBrokerCustodyRepository:brokerRepository
                              artifactStore:offerStore
                             sasReceiptStore:receiptStore
                              authorityStore:authorityStore];
    AncPrivateVaultAuthorityCheckpoint *prematureCheckpoint = nil;
    assert([coordinator activateAuthorization:verified
                                  verifiedAtMs:UINT64_C(1721111162000)
                                    checkpoint:&prematureCheckpoint] ==
               AncPrivateVaultEnrollmentCoordinatorStatusConflict &&
           prematureCheckpoint == nil);
    AncPrivateVaultEnrollmentSasReceipt *durableReceipt = nil;
    assert(
        [coordinator
            recordSasDecisionForChallenge:verified.challenge
                                receiptId:Repeated(0x5d, 16)
                                decidedAt:1721111162
                                 decision:
                                     AncPrivateVaultEnrollmentSasDecisionConfirmed
                                  receipt:&durableReceipt] ==
            AncPrivateVaultEnrollmentCoordinatorStatusOK &&
        durableReceipt != nil);
    AncPrivateVaultAuthorityCheckpoint *coordinatorCheckpoint = nil;
    assert([coordinator activateAuthorization:verified
                                 verifiedAtMs:UINT64_C(1721111162000)
                                   checkpoint:&coordinatorCheckpoint] ==
               AncPrivateVaultEnrollmentCoordinatorStatusOK &&
           coordinatorCheckpoint.custodyGeneration == 3 &&
           coordinatorCheckpoint.snapshot.sequence ==
               verified.replay.state.sequence);
    AncPrivateVaultAuthorityCheckpoint *retryCheckpoint = nil;
    assert([coordinator activateAuthorization:verified
                                 verifiedAtMs:UINT64_C(1721111163000)
                                   checkpoint:&retryCheckpoint] ==
               AncPrivateVaultEnrollmentCoordinatorStatusOK &&
           [retryCheckpoint.frameDigest
               isEqualToData:coordinatorCheckpoint.frameDigest]);
    AncPrivateVaultCustodySnapshot activeBroker;
    AncPrivateVaultCustodyHandle *activeHandle = nil;
    assert([brokerRepository readVaultId:Hex(vault)
                                snapshot:&activeBroker
                                  handle:&activeHandle] ==
               AncPrivateVaultCustodyRepositoryStatusOK &&
           activeBroker.custody_generation == 3 &&
           activeBroker.lifecycle == ANC_PV_CUSTODY_LIFECYCLE_ACTIVE);
    __block BOOL activeEpochMatches = NO;
    assert([activeHandle
               borrow:^BOOL(const AncPrivateVaultCustodySecretInputs *secrets) {
                 activeEpochMatches = anc_pv_memcmp(secrets->active_epoch_key,
                                                    Repeated(0x44, 32).bytes,
                                                    32) == ANC_PV_CRYPTO_OK;
                 return activeEpochMatches;
               }] == AncPrivateVaultCustodyRepositoryStatusOK &&
           [activeHandle close] == AncPrivateVaultCustodyRepositoryStatusOK &&
           activeEpochMatches);
    assert([NSFileManager.defaultManager removeItemAtPath:authorityRoot
                                                    error:nil]);
    anc_pv_zeroize(localStateKey, sizeof localStateKey);
    Ivar exposedWrap = class_getInstanceVariable(
        AncPrivateVaultEnrollmentAuthorizationResult.class, "_eekWrapEnvelope");
    assert(exposedWrap != NULL);
    object_setIvar(verified, exposedWrap, Repeated(0x9d, 96));
    __block BOOL opened = NO;
    assert([verified
               openEEKWithRecipientBoxSeed:candidateBoxSeed
                                  consumer:^BOOL(const uint8_t *epochKey) {
                                    opened =
                                        anc_pv_memcmp(epochKey,
                                                      Repeated(0x44, 32).bytes,
                                                      32) == ANC_PV_CRYPTO_OK;
                                    return opened;
                                  }] == AncPrivateVaultEekWrapStatusOK &&
           opened);
    NSMutableData *badAuthorization = [authorization mutableCopy];
    ((uint8_t *)badAuthorization.mutableBytes)[badAuthorization.length - 1] ^=
        1;
    assert(AncPrivateVaultEnrollmentAuthorizationVerify(
               offer.encodedOffer, challenge, badAuthorization,
               State(authorizerSigning, authorizerAgreement), 1721111100,
               1721111161, [[AncPrivateVaultControlLog alloc] init],
               &status) == nil &&
           status ==
               AncPrivateVaultEnrollmentAuthorizationStatusInvalidSignature);

    NSMutableDictionary *wrongChallengeHash =
        [authorizationUnsigned mutableCopy];
    wrongChallengeHash[@301] =
        [AncPrivateVaultCanonicalValue bytes:Repeated(0x99, 32)];
    NSData *wrongChallengeAuthorization =
        Sign(wrongChallengeHash, @311, "anc/v1/enrollment-authorization",
             authorizerSigningPrivate);
    assert(AncPrivateVaultEnrollmentAuthorizationVerify(
               offer.encodedOffer, challenge, wrongChallengeAuthorization,
               State(authorizerSigning, authorizerAgreement), 1721111100,
               1721111161, [[AncPrivateVaultControlLog alloc] init],
               &status) == nil &&
           status ==
               AncPrivateVaultEnrollmentAuthorizationStatusBindingMismatch);

    NSMutableDictionary *wrongEndpointUnsigned = [endpointUnsigned mutableCopy];
    wrongEndpointUnsigned[@16] =
        [AncPrivateVaultCanonicalValue bytes:Repeated(0x98, 32)];
    NSData *wrongEndpoint = Sign(wrongEndpointUnsigned, @17, "anc/v1/endpoint",
                                 authorizerSigningPrivate);
    NSMutableDictionary *wrongEndpointAuthorizationMap =
        [authorizationUnsigned mutableCopy];
    wrongEndpointAuthorizationMap[@307] =
        [AncPrivateVaultCanonicalValue bytes:wrongEndpoint];
    NSData *wrongEndpointAuthorization =
        Sign(wrongEndpointAuthorizationMap, @311,
             "anc/v1/enrollment-authorization", authorizerSigningPrivate);
    assert(AncPrivateVaultEnrollmentAuthorizationVerify(
               offer.encodedOffer, challenge, wrongEndpointAuthorization,
               State(authorizerSigning, authorizerAgreement), 1721111100,
               1721111161, [[AncPrivateVaultControlLog alloc] init],
               &status) == nil &&
           status ==
               AncPrivateVaultEnrollmentAuthorizationStatusBindingMismatch);

    NSMutableDictionary *wrongWrapUnsigned = [wrapUnsigned mutableCopy];
    wrongWrapUnsigned[@31] =
        [AncPrivateVaultCanonicalValue bytes:Repeated(0x97, 16)];
    NSData *wrongWrap = Sign(wrongWrapUnsigned, @35, "anc/v1/eek-wrap",
                             authorizerSigningPrivate);
    NSMutableDictionary *wrongWrapAuthorizationMap =
        [authorizationUnsigned mutableCopy];
    wrongWrapAuthorizationMap[@308] =
        [AncPrivateVaultCanonicalValue bytes:wrongWrap];
    NSData *wrongWrapAuthorization =
        Sign(wrongWrapAuthorizationMap, @311, "anc/v1/enrollment-authorization",
             authorizerSigningPrivate);
    assert(AncPrivateVaultEnrollmentAuthorizationVerify(
               offer.encodedOffer, challenge, wrongWrapAuthorization,
               State(authorizerSigning, authorizerAgreement), 1721111100,
               1721111161, [[AncPrivateVaultControlLog alloc] init],
               &status) == nil &&
           status ==
               AncPrivateVaultEnrollmentAuthorizationStatusBindingMismatch);

    AncPrivateVaultCanonicalValue *wrongCandidateMember =
        Member(candidateId, @"broker", YES, offer.signingPublicKey,
               offer.keyAgreementPublicKey, Repeated(0x96, 16));
    NSMutableDictionary *wrongCommitMap = [commitMap mutableCopy];
    wrongCommitMap[@144] = [AncPrivateVaultCanonicalValue
        array:@[ authorizerMember, wrongCandidateMember ]];
    NSMutableDictionary *wrongEntryUnsigned = [entryUnsigned mutableCopy];
    wrongEntryUnsigned[@112] =
        [AncPrivateVaultCanonicalValue bytes:Encode(wrongCommitMap)];
    NSData *wrongCommit = Sign(wrongEntryUnsigned, @114, "anc/v1/log-entry",
                               authorizerSigningPrivate);
    NSMutableDictionary *wrongCommitAuthorizationMap =
        [authorizationUnsigned mutableCopy];
    wrongCommitAuthorizationMap[@309] =
        [AncPrivateVaultCanonicalValue bytes:wrongCommit];
    NSData *wrongCommitAuthorization =
        Sign(wrongCommitAuthorizationMap, @311,
             "anc/v1/enrollment-authorization", authorizerSigningPrivate);
    assert(AncPrivateVaultEnrollmentAuthorizationVerify(
               offer.encodedOffer, challenge, wrongCommitAuthorization,
               State(authorizerSigning, authorizerAgreement), 1721111100,
               1721111161, [[AncPrivateVaultControlLog alloc] init],
               &status) == nil &&
           status ==
               AncPrivateVaultEnrollmentAuthorizationStatusInvalidTransition);

    assert(AncPrivateVaultEnrollmentAuthorizationVerify(
               offer.encodedOffer, challenge, authorization,
               State(authorizerSigning, authorizerAgreement), 1721111100,
               1721111751, [[AncPrivateVaultControlLog alloc] init],
               &status) == nil &&
           status == AncPrivateVaultEnrollmentAuthorizationStatusExpired);
    uint8_t wrongCandidateBoxSeed[32];
    memset(wrongCandidateBoxSeed, 0x34, sizeof wrongCandidateBoxSeed);
    assert([verified openEEKWithRecipientBoxSeed:wrongCandidateBoxSeed
                                        consumer:^BOOL(
                                            __unused const uint8_t *epochKey) {
                                          return YES;
                                        }] ==
           AncPrivateVaultEekWrapStatusBindingMismatch);
    anc_pv_zeroize(wrongCandidateBoxSeed, sizeof wrongCandidateBoxSeed);

    anc_pv_zeroize(candidateSigningSeed, sizeof candidateSigningSeed);
    anc_pv_zeroize(candidateBoxSeed, sizeof candidateBoxSeed);
    anc_pv_zeroize(authorizerSigningSeed, sizeof authorizerSigningSeed);
    anc_pv_zeroize(authorizerBoxSeed, sizeof authorizerBoxSeed);
    anc_pv_zeroize(authorizerSigningPrivate, sizeof authorizerSigningPrivate);
    anc_pv_zeroize(authorizerBoxPrivate, sizeof authorizerBoxPrivate);
    anc_pv_zeroize(candidateBoxPrivate, sizeof candidateBoxPrivate);
    puts("private-vault enrollment authorization passed");
  }
  return 0;
}
