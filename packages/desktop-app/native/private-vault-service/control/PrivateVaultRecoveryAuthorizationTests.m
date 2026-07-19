#import "PrivateVaultRecoveryAuthorization.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"

#include <assert.h>
#include <stdio.h>

static NSData *Pattern(uint8_t byte, NSUInteger length) {
  NSMutableData *data = [NSMutableData dataWithLength:length];
  memset(data.mutableBytes, byte, length);
  return data;
}

static AncPrivateVaultCanonicalValue *I(uint64_t value) {
  return [AncPrivateVaultCanonicalValue integer:(int64_t)value];
}
static AncPrivateVaultCanonicalValue *T(NSString *value) {
  return [AncPrivateVaultCanonicalValue text:value];
}
static AncPrivateVaultCanonicalValue *B(NSData *value) {
  return [AncPrivateVaultCanonicalValue bytes:value];
}
static AncPrivateVaultCanonicalValue *A(NSArray *value) {
  return [AncPrivateVaultCanonicalValue array:value];
}

static NSData *Encode(NSDictionary *map) {
  AncPrivateVaultCanonicalStatus status;
  NSData *result = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:map], &status);
  assert(result != nil && status == AncPrivateVaultCanonicalStatusOK);
  return result;
}

static NSData *DomainHash(const char *domain, NSData *payload) {
  uint8_t digest[32] = {0};
  assert(anc_pv_blake2b_256_two_part(
             digest, (const uint8_t *)domain, strlen(domain) + 1,
             payload.bytes, payload.length) == ANC_PV_CRYPTO_OK);
  NSData *result = [NSData dataWithBytes:digest length:sizeof digest];
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

static NSData *Sign(NSData *payload, const char *domain,
                    const uint8_t privateKey[64]) {
  NSMutableData *message =
      [NSMutableData dataWithBytes:domain length:strlen(domain) + 1];
  [message appendData:payload];
  uint8_t signature[64] = {0};
  assert(anc_pv_ed25519_sign(signature, message.bytes, message.length,
                             privateKey) == ANC_PV_CRYPTO_OK);
  NSData *result = [NSData dataWithBytes:signature length:sizeof signature];
  anc_pv_zeroize(signature, sizeof signature);
  return result;
}

static NSData *SignWithAuthority(NSData *payload, const char *domain,
                                 AncPrivateVaultRecoveryAuthority *authority) {
  __block NSData *signature = nil;
  assert([authority.signingPrivateKey
             borrow:^BOOL(uint8_t *privateKey, size_t length) {
               if (length != 64)
                 return NO;
               signature = Sign(payload, domain, privateKey);
               return signature != nil;
             }] == AncPrivateVaultGuardedMemoryStatusOK);
  return signature;
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

static AncPrivateVaultRecoveryAuthority *Authority(NSData *entropy,
                                                     NSData *vaultId,
                                                     uint64_t generation) {
  AncPrivateVaultGuardedMemoryStatus memoryStatus;
  AncPrivateVaultGuardedMemory *guarded =
      [AncPrivateVaultGuardedMemory memoryWithLength:32 status:&memoryStatus];
  assert(guarded != nil);
  assert([guarded borrow:^BOOL(uint8_t *bytes, size_t length) {
           memcpy(bytes, entropy.bytes, length);
           return YES;
         }] == AncPrivateVaultGuardedMemoryStatusOK);
  AncPrivateVaultRecoveryAuthorityStatus status;
  AncPrivateVaultRecoveryAuthority *authority =
      AncPrivateVaultDeriveRecoveryAuthority(guarded, vaultId, generation,
                                             &status);
  assert([guarded close] == AncPrivateVaultGuardedMemoryStatusOK);
  assert(authority != nil &&
         status == AncPrivateVaultRecoveryAuthorityStatusOK);
  return authority;
}

typedef struct TestKeypair {
  uint8_t signingPublic[32];
  uint8_t signingPrivate[64];
  uint8_t agreementPublic[32];
  uint8_t agreementPrivate[32];
} TestKeypair;

static TestKeypair Keypair(uint8_t byte) {
  uint8_t signingSeed[32] = {0};
  uint8_t agreementSeed[32] = {0};
  memset(signingSeed, byte, sizeof signingSeed);
  memset(agreementSeed, byte + 1, sizeof agreementSeed);
  TestKeypair keys = {0};
  assert(anc_pv_ed25519_seed_keypair(keys.signingPublic, keys.signingPrivate,
                                     signingSeed) == ANC_PV_CRYPTO_OK);
  assert(anc_pv_box_seed_keypair(keys.agreementPublic, keys.agreementPrivate,
                                 agreementSeed) == ANC_PV_CRYPTO_OK);
  anc_pv_zeroize(signingSeed, sizeof signingSeed);
  anc_pv_zeroize(agreementSeed, sizeof agreementSeed);
  return keys;
}

static NSData *RecoveryWrap(NSData *vaultId, NSData *ceremonyId,
                            uint64_t createdAt, NSData *envelopeId,
                            AncPrivateVaultRecoveryAuthority *authority,
                            uint64_t epoch, NSData *issuerId,
                            uint64_t activationSequence, NSData *headHash,
                            NSData *membershipHash, NSData *eek,
                            TestKeypair *issuer) {
  NSData *nonce = Pattern((uint8_t)createdAt, 24);
  uint8_t plaintext[48] = {0};
  memcpy(plaintext, "anc/v1/eek-wrap", 16);
  memcpy(plaintext + 16, eek.bytes, 32);
  uint8_t ciphertext[64] = {0};
  size_t written = 0;
  assert(anc_pv_box_wrap(ciphertext, sizeof ciphertext, &written, plaintext,
                         sizeof plaintext, nonce.bytes,
                         authority.keyAgreementPublicKey.bytes,
                         issuer->agreementPrivate) == ANC_PV_CRYPTO_OK);
  assert(written == sizeof ciphertext);
  anc_pv_zeroize(plaintext, sizeof plaintext);
  NSMutableDictionary *map = [@{
    @1 : T(@"anc/v1"), @2 : B(vaultId), @3 : T(@"recovery-wrap"),
    @4 : I(createdAt), @5 : B(envelopeId), @400 : B(ceremonyId),
    @401 : I(authority.recoveryGeneration), @402 : B(authority.recoveryId),
    @403 : B(authority.keyAgreementPublicKey), @404 : I(epoch),
    @405 : B(issuerId), @406 : I(activationSequence), @407 : B(headHash),
    @408 : B(membershipHash), @409 : B(nonce),
    @410 : B([NSData dataWithBytes:ciphertext length:sizeof ciphertext]),
  } mutableCopy];
  anc_pv_zeroize(ciphertext, sizeof ciphertext);
  NSData *unsignedBytes = Encode(map);
  map[@411] = B(Sign(unsignedBytes, "anc/v1/recovery-wrap",
                      issuer->signingPrivate));
  return Encode(map);
}

@interface RecoveryFixture : NSObject
@property(nonatomic) NSData *authorization;
@property(nonatomic) NSData *snapshot;
@property(nonatomic) NSData *currentWrap;
@property(nonatomic) AncPrivateVaultRecoveryAuthority *consumedAuthority;
@property(nonatomic) AncPrivateVaultRecoveryAuthority *replacementAuthority;
@property(nonatomic) AncPrivateVaultControlLogState *state;
@property(nonatomic) AncPrivateVaultControlLogMembershipCommit *commit;
@property(nonatomic) AncPrivateVaultControlLogSignedEntry *entry;
@property(nonatomic) NSData *signedEntryBytes;
@property(nonatomic) NSData *innerBytes;
@end
@implementation RecoveryFixture
@end

static AncPrivateVaultControlLogMember *Member(NSData *endpointId,
                                                NSString *role,
                                                BOOL unattended,
                                                TestKeypair *keys,
                                                NSString *enrollmentRef) {
  AncPrivateVaultControlLogMember *member =
      [AncPrivateVaultControlLogMember new];
  [member setValue:Hex(endpointId) forKey:@"endpointId"];
  [member setValue:role forKey:@"role"];
  [member setValue:@(unattended) forKey:@"unattended"];
  [member setValue:[NSData dataWithBytes:keys->signingPublic length:32]
            forKey:@"signingPublicKey"];
  [member setValue:[NSData dataWithBytes:keys->agreementPublic length:32]
            forKey:@"keyAgreementPublicKey"];
  [member setValue:enrollmentRef forKey:@"enrollmentRef"];
  return member;
}

static AncPrivateVaultCanonicalValue *MemberValue(
    AncPrivateVaultControlLogMember *member) {
  return A(@[
    T(member.endpointId), T(member.role),
    [AncPrivateVaultCanonicalValue boolean:member.unattended],
    B(member.signingPublicKey), B(member.keyAgreementPublicKey),
    T(member.enrollmentRef)
  ]);
}

static RecoveryFixture *BuildFixture(uint8_t replacementEEKByte) {
  NSData *vaultId = Pattern(0x10, 16);
  NSData *ceremonyId = Pattern(0x11, 16);
  NSData *authorizationId = Pattern(0x12, 16);
  NSData *issuerId = Pattern(0x21, 16);
  NSData *brokerId = Pattern(0x22, 16);
  NSData *candidateId = Pattern(0x31, 16);
  NSData *headHash = Pattern(0x41, 32);
  NSData *membershipHash = Pattern(0x42, 32);
  NSData *eek = Pattern(0x43, 32);
  NSData *entropy = Pattern(0x44, 32);
  TestKeypair issuerKeys = Keypair(0x51);
  TestKeypair brokerKeys = Keypair(0x52);
  TestKeypair candidateKeys = Keypair(0x53);
  AncPrivateVaultRecoveryAuthority *consumed = Authority(entropy, vaultId, 1);
  AncPrivateVaultRecoveryAuthority *replacement = Authority(entropy, vaultId, 2);

  NSData *currentWrap = RecoveryWrap(
      vaultId, Pattern(0x60, 16), 1721200000, Pattern(0x61, 16), consumed, 2,
      issuerId, 4, headHash, membershipHash, eek, &issuerKeys);
  NSData *currentWrapHash =
      DomainHash("anc/v1/recovery-wrap", currentWrap);

  NSData *snapshot = Encode(@{
    @1 : T(@"anc/v1"), @2 : B(vaultId), @3 : T(@"recovery-snapshot"),
    @220 : I(4), @221 : B(headHash), @222 : B(membershipHash),
    @223 : A(@[ B(issuerId), B(brokerId) ]),
  });
  NSData *snapshotHash = DomainHash("anc/v1/recovery", snapshot);

  NSData *candidateTranscript = Encode(@{
    @1 : T(@"anc/v1"), @2 : B(vaultId), @440 : B(ceremonyId),
    @445 : B(snapshotHash), @442 : B(consumed.recoveryId),
    @10 : B(candidateId),
    @13 : B([NSData dataWithBytes:candidateKeys.signingPublic length:32]),
    @14 : B([NSData dataWithBytes:candidateKeys.agreementPublic length:32]),
    @450 : I(3),
  });
  NSData *candidateTranscriptHash =
      DomainHash("anc/v1/recovery-authorization", candidateTranscript);
  NSMutableDictionary *candidateMap = [@{
    @1 : T(@"anc/v1"), @2 : B(vaultId), @3 : T(@"endpoint"),
    @4 : I(1721200020), @5 : B(Pattern(0x32, 16)), @10 : B(candidateId),
    @11 : T(@"endpoint"), @12 : [AncPrivateVaultCanonicalValue boolean:NO],
    @13 : B([NSData dataWithBytes:candidateKeys.signingPublic length:32]),
    @14 : B([NSData dataWithBytes:candidateKeys.agreementPublic length:32]),
    @15 : B(consumed.recoveryId), @16 : B(candidateTranscriptHash),
  } mutableCopy];
  NSData *candidateUnsigned = Encode(candidateMap);
  candidateMap[@17] = B(SignWithAuthority(candidateUnsigned,
                                           "anc/v1/endpoint", consumed));
  NSData *candidate = Encode(candidateMap);

  NSData *replacementWrap = RecoveryWrap(
      vaultId, ceremonyId, 1721200030, Pattern(0x62, 16), replacement, 3,
      candidateId, 5, headHash, membershipHash,
      Pattern(replacementEEKByte, 32), &candidateKeys);
  NSData *replacementWrapHash =
      DomainHash("anc/v1/recovery-wrap", replacementWrap);
  NSMutableDictionary *confirmationMap = [@{
    @1 : T(@"anc/v1"), @2 : B(vaultId),
    @3 : T(@"recovery-replacement-confirmation"), @4 : I(1721200040),
    @5 : B(Pattern(0x63, 16)), @420 : B(ceremonyId), @421 : I(1),
    @422 : B(consumed.recoveryId), @423 : I(2),
    @424 : B(replacement.recoveryId),
    @425 : B(replacement.signingPublicKey),
    @426 : B(replacement.keyAgreementPublicKey),
    @427 : B(replacementWrapHash), @428 : B(candidateId), @429 : I(3),
    @430 : B(Pattern(0x64, 32)),
  } mutableCopy];
  NSData *confirmationUnsigned = Encode(confirmationMap);
  confirmationMap[@431] = B(SignWithAuthority(
      confirmationUnsigned, "anc/v1/recovery-replacement-confirmation",
      replacement));
  NSData *confirmation = Encode(confirmationMap);

  NSMutableDictionary *authorizationMap = [@{
    @1 : T(@"anc/v1"), @2 : B(vaultId),
    @3 : T(@"recovery-authorization"), @4 : I(1721200050),
    @5 : B(authorizationId), @440 : B(ceremonyId), @441 : I(1),
    @442 : B(consumed.recoveryId), @443 : B(consumed.signingPublicKey),
    @444 : B(consumed.keyAgreementPublicKey), @445 : B(snapshotHash),
    @446 : B(currentWrapHash), @447 : B(candidate),
    @448 : B(confirmation), @449 : B(replacementWrap), @450 : I(3),
    @451 : I(1721200650),
  } mutableCopy];
  NSData *authorizationUnsigned = Encode(authorizationMap);
  authorizationMap[@452] = B(SignWithAuthority(
      authorizationUnsigned, "anc/v1/recovery-authorization", consumed));
  NSData *authorization = Encode(authorizationMap);
  NSData *authorizationHash =
      DomainHash("anc/v1/recovery-authorization", authorization);

  AncPrivateVaultControlLogMember *issuer =
      Member(issuerId, @"endpoint", NO, &issuerKeys, @"enrollment:issuer");
  AncPrivateVaultControlLogMember *broker =
      Member(brokerId, @"broker", YES, &brokerKeys, @"enrollment:broker");
  AncPrivateVaultControlLogState *state =
      [AncPrivateVaultControlLogState new];
  [state setValue:Hex(vaultId) forKey:@"vaultId"];
  [state setValue:@4 forKey:@"sequence"];
  [state setValue:headHash forKey:@"headHash"];
  [state setValue:membershipHash forKey:@"membershipHash"];
  [state setValue:@"2024-07-17T07:06:40.000Z" forKey:@"signedAt"];
  [state setValue:@[ issuer, broker ] forKey:@"activeMembers"];
  [state setValue:@[] forKey:@"removedEndpointIds"];
  [state setValue:@2 forKey:@"epoch"];
  [state setValue:@1 forKey:@"recoveryGeneration"];
  [state setValue:Hex(consumed.recoveryId) forKey:@"recoveryId"];
  [state setValue:consumed.signingPublicKey forKey:@"recoverySigningPublicKey"];
  [state setValue:consumed.keyAgreementPublicKey
            forKey:@"recoveryKeyAgreementPublicKey"];
  [state setValue:currentWrapHash forKey:@"recoveryWrapHash"];
  [state setValue:@"endpoint_witnessed" forKey:@"freshnessMode"];

  AncPrivateVaultControlLogMember *candidateMember = Member(
      candidateId, @"endpoint", NO, &candidateKeys, Hex(authorizationId));
  NSArray *removed = @[
    Hex(issuerId), Hex(brokerId)
  ];
  AncPrivateVaultControlLogMembershipCommit *commit =
      [AncPrivateVaultControlLogMembershipCommit new];
  [commit setValue:Hex(vaultId) forKey:@"vaultId"];
  [commit setValue:Hex(ceremonyId) forKey:@"ceremonyId"];
  [commit setValue:@"recovery" forKey:@"ceremonyKind"];
  [commit setValue:@3 forKey:@"epoch"];
  [commit setValue:membershipHash forKey:@"previousMembershipHash"];
  [commit setValue:@[ candidateMember ] forKey:@"activeMembers"];
  [commit setValue:removed forKey:@"removedEndpointIds"];
  [commit setValue:@YES forKey:@"rotationCompleted"];
  [commit setValue:@YES forKey:@"outstandingJobsResolved"];
  [commit setValue:snapshotHash forKey:@"recoverySnapshotHash"];
  [commit setValue:authorizationHash forKey:@"recoveryAuthorizationHash"];
  [commit setValue:@2 forKey:@"recoveryGeneration"];
  [commit setValue:Hex(replacement.recoveryId) forKey:@"recoveryId"];
  [commit setValue:replacement.signingPublicKey
            forKey:@"recoverySigningPublicKey"];
  [commit setValue:replacement.keyAgreementPublicKey
            forKey:@"recoveryKeyAgreementPublicKey"];
  [commit setValue:replacementWrapHash forKey:@"recoveryWrapHash"];

  NSDictionary *innerMap = @{
    @1 : T(@"anc/v1"), @2 : T(Hex(vaultId)), @3 : T(@"membership_commit"),
    @140 : T(Hex(ceremonyId)), @141 : T(@"recovery"), @142 : I(3),
    @143 : B(membershipHash), @144 : A(@[ MemberValue(candidateMember) ]),
    @145 : A(@[ T(removed[0]), T(removed[1]) ]),
    @146 : [AncPrivateVaultCanonicalValue boolean:YES],
    @147 : [AncPrivateVaultCanonicalValue boolean:YES], @148 : B(snapshotHash),
    @149 : B(authorizationHash), @155 : I(2),
    @156 : T(Hex(replacement.recoveryId)),
    @157 : B(replacement.signingPublicKey),
    @158 : B(replacement.keyAgreementPublicKey), @159 : B(replacementWrapHash),
  };
  NSData *innerBytes = Encode(innerMap);
  NSMutableDictionary *entryMap = [@{
    @1 : T(@"anc/v1"), @2 : T(Hex(vaultId)), @3 : T(@"log-entry"),
    @4 : T(@"2024-07-17T07:08:00.000Z"), @5 : T(Hex(Pattern(0x71, 16))),
    @110 : I(5), @111 : B(headHash), @112 : B(innerBytes),
    @113 : T(Hex(candidateId)),
  } mutableCopy];
  NSData *entryUnsigned = Encode(entryMap);
  NSData *entrySignature = Sign(entryUnsigned, "anc/v1/log-entry",
                                 candidateKeys.signingPrivate);
  entryMap[@114] = B(entrySignature);
  NSData *signedEntry = Encode(entryMap);
  AncPrivateVaultControlLogSignedEntry *entry =
      [AncPrivateVaultControlLogSignedEntry new];
  [entry setValue:Hex(vaultId) forKey:@"vaultId"];
  [entry setValue:@"2024-07-17T07:08:00.000Z" forKey:@"createdAt"];
  [entry setValue:Hex(Pattern(0x71, 16)) forKey:@"envelopeId"];
  [entry setValue:@5 forKey:@"sequence"];
  [entry setValue:headHash forKey:@"previousHash"];
  [entry setValue:innerBytes forKey:@"innerEnvelopeBytes"];
  [entry setValue:Hex(candidateId) forKey:@"signerEndpointId"];
  [entry setValue:entrySignature forKey:@"signature"];

  RecoveryFixture *fixture = [RecoveryFixture new];
  fixture.authorization = authorization;
  fixture.snapshot = snapshot;
  fixture.currentWrap = currentWrap;
  fixture.consumedAuthority = consumed;
  fixture.replacementAuthority = replacement;
  fixture.state = state;
  fixture.commit = commit;
  fixture.entry = entry;
  fixture.signedEntryBytes = signedEntry;
  fixture.innerBytes = innerBytes;
  anc_pv_zeroize(&issuerKeys, sizeof issuerKeys);
  anc_pv_zeroize(&brokerKeys, sizeof brokerKeys);
  anc_pv_zeroize(&candidateKeys, sizeof candidateKeys);
  return fixture;
}

static void CloseFixture(RecoveryFixture *fixture) {
  assert([fixture.consumedAuthority.signingPrivateKey close] ==
         AncPrivateVaultGuardedMemoryStatusOK);
  assert([fixture.consumedAuthority.keyAgreementPrivateKey close] ==
         AncPrivateVaultGuardedMemoryStatusOK);
  assert([fixture.replacementAuthority.signingPrivateKey close] ==
         AncPrivateVaultGuardedMemoryStatusOK);
  assert([fixture.replacementAuthority.keyAgreementPrivateKey close] ==
         AncPrivateVaultGuardedMemoryStatusOK);
}

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    RecoveryFixture *fixture = BuildFixture(0x43);
    AncPrivateVaultRecoveryAuthorizationStatus status;
    AncPrivateVaultRecoveryAuthorizationVerifier *verifier =
        [[AncPrivateVaultRecoveryAuthorizationVerifier alloc]
             initWithAuthorization:fixture.authorization
                   currentSnapshot:fixture.snapshot
               currentRecoveryWrap:fixture.currentWrap
                 consumedAuthority:fixture.consumedAuthority
              replacementAuthority:fixture.replacementAuthority
           trustedNowMilliseconds:UINT64_C(1721200060000)
                             status:&status];
    assert(verifier != nil &&
           status == AncPrivateVaultRecoveryAuthorizationStatusOK);
    assert([verifier verifyRecoveryMembershipCommit:fixture.commit
                                         signedEntry:fixture.entry
                                        currentState:fixture.state
                                    signedEntryBytes:fixture.signedEntryBytes
                                  innerEnvelopeBytes:fixture.innerBytes]);
    assert(verifier.result != nil && verifier.result.authorizationHash.length == 32 &&
           verifier.result.snapshotHash.length == 32 &&
           verifier.result.confirmationNonce.length == 32 &&
           verifier.result.confirmationEnvelopeId.length == 16 &&
           verifier.result.ceremonyId.length == 16 &&
           verifier.result.candidateEndpointId.length == 16 &&
           verifier.result.replacementWrapHash.length == 32);
    assert(![verifier verifyRecoveryMembershipCommit:fixture.commit
                                          signedEntry:fixture.entry
                                         currentState:fixture.state
                                     signedEntryBytes:Pattern(0x99, 32)
                                   innerEnvelopeBytes:fixture.innerBytes]);
    assert(verifier.result == nil);
    CloseFixture(fixture);

    RecoveryFixture *mismatchedEEK = BuildFixture(0x99);
    verifier = [[AncPrivateVaultRecoveryAuthorizationVerifier alloc]
        initWithAuthorization:mismatchedEEK.authorization
              currentSnapshot:mismatchedEEK.snapshot
          currentRecoveryWrap:mismatchedEEK.currentWrap
            consumedAuthority:mismatchedEEK.consumedAuthority
         replacementAuthority:mismatchedEEK.replacementAuthority
      trustedNowMilliseconds:UINT64_C(1721200060000)
                        status:&status];
    assert(verifier != nil);
    assert(![verifier verifyRecoveryMembershipCommit:mismatchedEEK.commit
                                              signedEntry:mismatchedEEK.entry
                                             currentState:mismatchedEEK.state
                                         signedEntryBytes:mismatchedEEK.signedEntryBytes
                                       innerEnvelopeBytes:mismatchedEEK.innerBytes]);
    assert(verifier.status ==
           AncPrivateVaultRecoveryAuthorizationStatusEEKContinuity);

    AncPrivateVaultRecoveryPublicEvidenceVerifier *publicVerifier =
        [[AncPrivateVaultRecoveryPublicEvidenceVerifier alloc]
             initWithAuthorization:mismatchedEEK.authorization
                   currentSnapshot:mismatchedEEK.snapshot
               currentRecoveryWrap:mismatchedEEK.currentWrap
           trustedNowMilliseconds:UINT64_C(1721200060000)
                             status:&status];
    assert(publicVerifier != nil &&
           status == AncPrivateVaultRecoveryAuthorizationStatusOK);
    assert([publicVerifier
        verifyRecoveryMembershipCommit:mismatchedEEK.commit
                            signedEntry:mismatchedEEK.entry
                           currentState:mismatchedEEK.state
                       signedEntryBytes:mismatchedEEK.signedEntryBytes
                     innerEnvelopeBytes:mismatchedEEK.innerBytes]);
    assert(publicVerifier.result != nil &&
           publicVerifier.result.replacementWrapHash.length == 32);
    CloseFixture(mismatchedEEK);

    fixture = BuildFixture(0x43);
    verifier = [[AncPrivateVaultRecoveryAuthorizationVerifier alloc]
        initWithAuthorization:fixture.authorization
              currentSnapshot:fixture.snapshot
          currentRecoveryWrap:fixture.currentWrap
            consumedAuthority:fixture.replacementAuthority
         replacementAuthority:fixture.replacementAuthority
      trustedNowMilliseconds:UINT64_C(1721200060000)
                        status:&status];
    assert(verifier == nil &&
           status == AncPrivateVaultRecoveryAuthorizationStatusBinding);
    CloseFixture(fixture);
  }
  puts("private-vault recovery authorization tests passed");
  return 0;
}
