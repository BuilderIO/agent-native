#import <Foundation/Foundation.h>
#import <CommonCrypto/CommonDigest.h>

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultControlLog.h"
#import "PrivateVaultCrypto.h"

#include <assert.h>

static AncPrivateVaultCanonicalValue *I(int64_t value) {
  return [AncPrivateVaultCanonicalValue integer:value];
}
static AncPrivateVaultCanonicalValue *T(NSString *value) {
  return [AncPrivateVaultCanonicalValue text:value];
}
static AncPrivateVaultCanonicalValue *B(NSData *value) {
  return [AncPrivateVaultCanonicalValue bytes:value];
}
static NSData *Pattern(uint8_t byte, NSUInteger length) {
  NSMutableData *data = [NSMutableData dataWithLength:length];
  memset(data.mutableBytes, byte, length);
  return data;
}

static AncPrivateVaultCanonicalValue *Member(NSString *endpointId,
                                              NSData *signingPublicKey,
                                              uint8_t agreementByte) {
  return [AncPrivateVaultCanonicalValue array:@[
    T(endpointId), T(@"endpoint"), [AncPrivateVaultCanonicalValue boolean:NO],
    B(signingPublicKey), B(Pattern(agreementByte, 32)),
    T([@"enrollment:" stringByAppendingString:endpointId]),
  ]];
}

static NSData *MembershipInner(NSString *kind, uint64_t epoch,
                               NSData *_Nullable previousMembershipHash,
                               NSArray *members, NSArray<NSString *> *removed,
                               BOOL rotation, BOOL jobs, uint8_t wrapByte) {
  NSDictionary *map = @{
    @1 : T(@"anc/v1"), @2 : T(@"vault:control-0001"),
    @3 : T(@"membership_commit"),
    @140 : T([@"ceremony:" stringByAppendingString:kind]), @141 : T(kind),
    @142 : I((int64_t)epoch),
    @143 : previousMembershipHash == nil ? [AncPrivateVaultCanonicalValue nullValue] : B(previousMembershipHash),
    @144 : [AncPrivateVaultCanonicalValue array:members],
    @145 : [AncPrivateVaultCanonicalValue array:@[]],
    @146 : [AncPrivateVaultCanonicalValue boolean:rotation],
    @147 : [AncPrivateVaultCanonicalValue boolean:jobs],
    @148 : [AncPrivateVaultCanonicalValue nullValue],
    @149 : [AncPrivateVaultCanonicalValue nullValue],
    @155 : I(1), @156 : T(@"recovery:authority-0001"),
    @157 : B(Pattern(0xc1, 32)), @158 : B(Pattern(0xd1, 32)),
    @159 : B(Pattern(wrapByte, 32)),
  };
  NSMutableArray *removedValues = [NSMutableArray array];
  for (NSString *value in removed) [removedValues addObject:T(value)];
  NSMutableDictionary *fixed = [map mutableCopy];
  fixed[@145] = [AncPrivateVaultCanonicalValue array:removedValues];
  AncPrivateVaultCanonicalStatus status;
  return AncPrivateVaultCanonicalEncode([AncPrivateVaultCanonicalValue map:fixed], &status);
}

static NSData *ContinuityInner(NSData *membershipHash) {
  AncPrivateVaultCanonicalStatus status;
  return AncPrivateVaultCanonicalEncode([AncPrivateVaultCanonicalValue map:@{
    @1 : T(@"anc/v1"), @2 : T(@"vault:control-0001"),
    @3 : T(@"continuity_checkpoint"), @150 : B(membershipHash),
  }], &status);
}

static NSData *SignedEntry(uint64_t sequence, NSData *previousHash,
                           NSData *inner, NSString *signerId,
                           const uint8_t privateKey[64], NSString *createdAt) {
  NSMutableDictionary *map = [@{
    @1 : T(@"anc/v1"), @2 : T(@"vault:control-0001"), @3 : T(@"log-entry"),
    @4 : T(createdAt), @5 : T([NSString stringWithFormat:@"log-entry:%llu", sequence]),
    @110 : I((int64_t)sequence), @111 : B(previousHash), @112 : B(inner), @113 : T(signerId),
  } mutableCopy];
  AncPrivateVaultCanonicalStatus status;
  NSData *unsignedBytes = AncPrivateVaultCanonicalEncode([AncPrivateVaultCanonicalValue map:map], &status);
  static const char domain[] = "anc/v1/log-entry";
  NSMutableData *message = [NSMutableData dataWithBytes:domain length:sizeof domain];
  [message appendData:unsignedBytes];
  uint8_t signature[64] = {0};
  assert(anc_pv_ed25519_sign(signature, message.bytes, message.length, privateKey) == ANC_PV_CRYPTO_OK);
  map[@114] = B([NSData dataWithBytes:signature length:sizeof signature]);
  anc_pv_zeroize(signature, sizeof signature);
  return AncPrivateVaultCanonicalEncode([AncPrivateVaultCanonicalValue map:map], &status);
}

static NSData *ReplaceCanonicalMapField(NSData *encoded, NSNumber *key,
                                        AncPrivateVaultCanonicalValue *replacement) {
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *decoded =
      AncPrivateVaultCanonicalDecode(encoded, encoded.length, &status);
  assert(decoded.type == AncPrivateVaultCanonicalTypeMap);
  NSMutableDictionary *map = [decoded.mapValue mutableCopy];
  map[key] = replacement;
  NSData *result = AncPrivateVaultCanonicalEncode([AncPrivateVaultCanonicalValue map:map], &status);
  assert(result != nil && status == AncPrivateVaultCanonicalStatusOK);
  return result;
}

static NSData *ReplaceFirstMemberUnattended(NSData *inner,
                                             AncPrivateVaultCanonicalValue *replacement) {
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *decoded = AncPrivateVaultCanonicalDecode(inner, inner.length, &status);
  NSMutableDictionary *map = [decoded.mapValue mutableCopy];
  AncPrivateVaultCanonicalValue *membersValue = map[@144];
  NSMutableArray *members = [membersValue.arrayValue mutableCopy];
  NSMutableArray *firstMember = [((AncPrivateVaultCanonicalValue *)members[0]).arrayValue mutableCopy];
  firstMember[2] = replacement;
  members[0] = [AncPrivateVaultCanonicalValue array:firstMember];
  map[@144] = [AncPrivateVaultCanonicalValue array:members];
  NSData *result = AncPrivateVaultCanonicalEncode([AncPrivateVaultCanonicalValue map:map], &status);
  assert(result != nil && status == AncPrivateVaultCanonicalStatusOK);
  return result;
}

@interface TestVerifier : NSObject <AncPrivateVaultControlLogAuthorizationVerifier>
@property(nonatomic) BOOL allowGenesis;
@property(nonatomic) BOOL allowRecovery;
@property(nonatomic) BOOL allowRecoveryWrapRotation;
@property(nonatomic) BOOL allowAbort;
@property(nonatomic) NSInteger genesisMutation;
@property(nonatomic) BOOL catchGenesisMutationException;
@property(nonatomic) BOOL caughtGenesisMutationException;
@property(nonatomic) BOOL throwGenesisException;
@property(nonatomic) BOOL mutateRecoveryWrapSnapshot;
@property(nonatomic) BOOL mutateRecoverySnapshot;
@property(nonatomic) BOOL mutateAbortSnapshot;
@property(nonatomic, nullable) NSData *expectedRecoveryWrapSignedEntry;
@property(nonatomic, nullable) NSData *expectedRecoveryWrapInnerEnvelope;
@property(nonatomic, nullable) NSData *expectedRecoveryWrapHash;
@property(nonatomic, nullable) NSData *expectedPriorMembershipHash;
@property(nonatomic) uint64_t expectedRecoveryWrapEpoch;
@property(nonatomic, nullable) NSString *expectedRecoveryWrapActivationTime;
@property(nonatomic, nullable) NSData *expectedGenesisSignedEntry;
@property(nonatomic, nullable) NSData *expectedGenesisInnerEnvelope;
@property(nonatomic, nullable) NSMutableData *genesisOriginalInput;
@end
@implementation TestVerifier
- (BOOL)verifyGenesisMembershipCommit:(AncPrivateVaultControlLogMembershipCommit *)commit
                           signedEntry:(AncPrivateVaultControlLogSignedEntry *)entry
                      signedEntryBytes:(NSData *)signedEntryBytes
                    innerEnvelopeBytes:(NSData *)innerEnvelopeBytes {
  if (self.throwGenesisException)
    [NSException raise:NSInternalInconsistencyException format:@"genesis verifier failure"];
  @try {
    switch (self.genesisMutation) {
      case 1:
        [commit setValue:@"ceremony:mutated" forKey:@"ceremonyId"];
        break;
      case 2:
        [entry setValue:@"log-entry:mutated" forKey:@"envelopeId"];
        break;
      case 3:
        [commit.activeMembers[0] setValue:@"endpoint:mutated" forKey:@"endpointId"];
        break;
      case 4:
        ((uint8_t *)[(NSMutableData *)signedEntryBytes mutableBytes])[0] ^= 1;
        break;
      case 5:
        ((uint8_t *)[(NSMutableData *)innerEnvelopeBytes mutableBytes])[0] ^= 1;
        break;
      case 6:
        ((uint8_t *)self.genesisOriginalInput.mutableBytes)[0] ^= 1;
        break;
    }
  } @catch (NSException *exception) {
    if (!self.catchGenesisMutationException) @throw exception;
    self.caughtGenesisMutationException = YES;
  }
  return self.allowGenesis &&
      [commit.ceremonyKind isEqualToString:@"first_device"] &&
      commit.activeMembers.count == 1 && entry.sequence == 0 &&
      [entry.innerEnvelopeBytes isEqualToData:innerEnvelopeBytes] &&
      (self.expectedGenesisSignedEntry == nil ||
       [signedEntryBytes isEqualToData:self.expectedGenesisSignedEntry]) &&
      (self.expectedGenesisInnerEnvelope == nil ||
       [innerEnvelopeBytes isEqualToData:self.expectedGenesisInnerEnvelope]);
}
- (BOOL)verifyRecoveryWrapRotationCommit:(AncPrivateVaultControlLogMembershipCommit *)commit
                              signedEntry:(AncPrivateVaultControlLogSignedEntry *)entry
                             currentState:(AncPrivateVaultControlLogState *)state
                         signedEntryBytes:(NSData *)signedEntryBytes
                       innerEnvelopeBytes:(NSData *)innerEnvelopeBytes {
  if (self.mutateRecoveryWrapSnapshot) {
    [commit setValue:@"ceremony:mutated" forKey:@"ceremonyId"];
  }
  return self.allowRecoveryWrapRotation && state != nil &&
      entry.sequence == state.sequence + 1 && commit.epoch == state.epoch + 1 &&
      (self.expectedRecoveryWrapEpoch == 0 || commit.epoch == self.expectedRecoveryWrapEpoch) &&
      (self.expectedRecoveryWrapHash == nil ||
       [commit.recoveryWrapHash isEqualToData:self.expectedRecoveryWrapHash]) &&
      (self.expectedPriorMembershipHash == nil ||
       [commit.previousMembershipHash isEqualToData:self.expectedPriorMembershipHash]) &&
      (self.expectedRecoveryWrapActivationTime == nil ||
       [entry.createdAt isEqual:self.expectedRecoveryWrapActivationTime]) &&
      (self.expectedRecoveryWrapSignedEntry == nil ||
       [signedEntryBytes isEqualToData:self.expectedRecoveryWrapSignedEntry]) &&
      (self.expectedRecoveryWrapInnerEnvelope == nil ||
       [innerEnvelopeBytes isEqualToData:self.expectedRecoveryWrapInnerEnvelope]);
}
- (BOOL)verifyRecoverySignedEntry:(NSData *)entry innerEnvelope:(NSData *)inner
                      currentState:(AncPrivateVaultControlLogState *)state {
  if (self.mutateRecoverySnapshot) {
    [state setValue:@"recovery:poisoned" forKey:@"recoveryId"];
  }
  return self.allowRecovery && entry.length > inner.length && state != nil;
}
- (BOOL)verifyRecoveryMembershipCommit:
            (AncPrivateVaultControlLogMembershipCommit *)commit
                            signedEntry:
                                (AncPrivateVaultControlLogSignedEntry *)entry
                           currentState:
                               (AncPrivateVaultControlLogState *)state
                       signedEntryBytes:(NSData *)signedEntryBytes
                     innerEnvelopeBytes:(NSData *)innerEnvelopeBytes {
  if (self.mutateRecoverySnapshot) {
    [commit setValue:@"ceremony:poisoned" forKey:@"ceremonyId"];
  }
  return self.allowRecovery && state != nil &&
         [commit.ceremonyKind isEqualToString:@"recovery"] &&
         entry.sequence == state.sequence + 1 &&
         [entry.innerEnvelopeBytes isEqualToData:innerEnvelopeBytes] &&
         signedEntryBytes.length > innerEnvelopeBytes.length;
}
- (BOOL)verifyCeremonyAbortSignedEntry:(NSData *)entry innerEnvelope:(NSData *)inner
                           currentState:(AncPrivateVaultControlLogState *)state {
  if (self.mutateAbortSnapshot) {
    [state setValue:@"recovery:poisoned" forKey:@"recoveryId"];
  }
  return self.allowAbort && entry.length > inner.length && state != nil;
}
@end

static void TestReplayAndAdversarialCases(void) {
  uint8_t publicKey[32] = {0}, privateKey[64] = {0};
  uint8_t seed[32]; memset(seed, 1, sizeof seed);
  assert(anc_pv_ed25519_seed_keypair(publicKey, privateKey, seed) == ANC_PV_CRYPTO_OK);
  NSData *publicData = [NSData dataWithBytes:publicKey length:32];
  NSString *owner = @"endpoint:owner-0001";
  NSData *genesisInner = MembershipInner(@"first_device", 1, nil,
      @[Member(owner, publicData, 0x41)], @[], NO, NO, 0xe1);
  NSData *genesis = SignedEntry(0, [NSMutableData dataWithLength:32], genesisInner,
                                owner, privateKey, @"2026-07-17T01:00:00.000Z");
  AncPrivateVaultControlLog *log = [[AncPrivateVaultControlLog alloc] init];
  TestVerifier *verifier = [[TestVerifier alloc] init]; verifier.allowGenesis = YES;
  verifier.expectedGenesisSignedEntry = genesis;
  verifier.expectedGenesisInnerEnvelope = genesisInner;
  AncPrivateVaultControlLogReplayResult *result = nil;
  for (AncPrivateVaultCanonicalValue *wrongSequence in
       @[[AncPrivateVaultCanonicalValue boolean:NO], [AncPrivateVaultCanonicalValue boolean:YES]]) {
    NSData *invalid = ReplaceCanonicalMapField(genesis, @110, wrongSequence);
    assert([log replaySignedEntry:invalid currentState:nil verifier:verifier result:&result] ==
           AncPrivateVaultControlLogStatusInvalidEntry);
  }
  for (NSNumber *integerField in @[@142, @155]) {
    for (AncPrivateVaultCanonicalValue *wrongInteger in
         @[[AncPrivateVaultCanonicalValue boolean:NO], [AncPrivateVaultCanonicalValue boolean:YES]]) {
      NSData *invalidInner = ReplaceCanonicalMapField(genesisInner, integerField, wrongInteger);
      NSData *invalid = SignedEntry(0, [NSMutableData dataWithLength:32], invalidInner,
                                    owner, privateKey, @"2026-07-17T01:00:00.000Z");
      assert([log replaySignedEntry:invalid currentState:nil verifier:verifier result:&result] ==
             AncPrivateVaultControlLogStatusInvalidEntry);
    }
  }
  for (NSNumber *booleanField in @[@146, @147]) {
    for (AncPrivateVaultCanonicalValue *wrongBoolean in @[I(0), I(1)]) {
      NSData *invalidInner = ReplaceCanonicalMapField(genesisInner, booleanField, wrongBoolean);
      NSData *invalid = SignedEntry(0, [NSMutableData dataWithLength:32], invalidInner,
                                    owner, privateKey, @"2026-07-17T01:00:00.000Z");
      assert([log replaySignedEntry:invalid currentState:nil verifier:verifier result:&result] ==
             AncPrivateVaultControlLogStatusInvalidEntry);
    }
  }
  for (AncPrivateVaultCanonicalValue *wrongUnattended in @[I(0), I(1)]) {
    NSData *invalidInner = ReplaceFirstMemberUnattended(genesisInner, wrongUnattended);
    NSData *invalid = SignedEntry(0, [NSMutableData dataWithLength:32], invalidInner,
                                  owner, privateKey, @"2026-07-17T01:00:00.000Z");
    assert([log replaySignedEntry:invalid currentState:nil verifier:verifier result:&result] ==
           AncPrivateVaultControlLogStatusInvalidEntry);
  }
  assert([log replaySignedEntry:genesis currentState:nil verifier:nil result:&result] ==
         AncPrivateVaultControlLogStatusGenesisAuthorizationRequired && result == nil);
  TestVerifier *throwingVerifier = [[TestVerifier alloc] init];
  throwingVerifier.allowGenesis = YES;
  throwingVerifier.throwGenesisException = YES;
  assert([log replaySignedEntry:genesis currentState:nil verifier:throwingVerifier
                          result:&result] ==
         AncPrivateVaultControlLogStatusGenesisAuthorizationRequired && result == nil);
  for (NSInteger mutation = 1; mutation <= 6; mutation += 1) {
    NSMutableData *mutableGenesis = [genesis mutableCopy];
    TestVerifier *mutatingVerifier = [[TestVerifier alloc] init];
    mutatingVerifier.allowGenesis = YES;
    mutatingVerifier.genesisMutation = mutation;
    mutatingVerifier.catchGenesisMutationException = YES;
    mutatingVerifier.genesisOriginalInput = mutableGenesis;
    assert([log replaySignedEntry:mutableGenesis currentState:nil
                        verifier:mutatingVerifier result:&result] ==
           AncPrivateVaultControlLogStatusGenesisAuthorizationRequired && result == nil);
    if (mutation <= 5) assert(mutatingVerifier.caughtGenesisMutationException);
    if (mutation != 6) assert([mutableGenesis isEqualToData:genesis]);
  }
  assert([log replaySignedEntry:genesis currentState:nil verifier:verifier result:&result] ==
         AncPrivateVaultControlLogStatusOK);
  assert(result.state.sequence == 0 && result.state.activeMembers.count == 1);
  AncPrivateVaultControlLogState *state = result.state;
  assert([log replaySignedEntry:genesis currentState:state verifier:nil result:&result] ==
         AncPrivateVaultControlLogStatusOK && result.idempotent);

  NSData *continuity = SignedEntry(1, state.headHash, ContinuityInner(state.membershipHash),
      owner, privateKey, @"2026-07-17T01:00:01.000Z");
  assert([log replaySignedEntry:continuity currentState:state verifier:nil result:&result] ==
         AncPrivateVaultControlLogStatusOK);
  state = result.state;

  uint8_t devicePublic[32], devicePrivate[64], deviceSeed[32];
  memset(deviceSeed, 2, sizeof deviceSeed);
  assert(anc_pv_ed25519_seed_keypair(devicePublic, devicePrivate, deviceSeed) == ANC_PV_CRYPTO_OK);
  NSData *addInner = MembershipInner(@"add_device", 1, state.membershipHash,
      @[Member(@"endpoint:device-0002", [NSData dataWithBytes:devicePublic length:32], 0x42),
        Member(owner, publicData, 0x41)], @[], NO, NO, 0xe1);
  NSData *add = SignedEntry(2, state.headHash, addInner, owner, privateKey,
                            @"2026-07-17T01:00:02.000Z");
  assert([log replaySignedEntry:add currentState:state verifier:nil result:&result] ==
         AncPrivateVaultControlLogStatusOK);
  state = result.state;
  assert(state.activeMembers.count == 2 && state.epoch == 1);

  NSMutableData *tampered = [add mutableCopy];
  ((uint8_t *)tampered.mutableBytes)[tampered.length - 1] ^= 1;
  assert([log replaySignedEntry:tampered currentState:nil verifier:verifier result:&result] !=
         AncPrivateVaultControlLogStatusOK);
  NSData *gap = SignedEntry(4, state.headHash, ContinuityInner(state.membershipHash), owner,
                            privateKey, @"2026-07-17T01:00:04.000Z");
  assert([log replaySignedEntry:gap currentState:state verifier:nil result:&result] ==
         AncPrivateVaultControlLogStatusGap);
  NSData *fork = SignedEntry(3, Pattern(0xff, 32), ContinuityInner(state.membershipHash), owner,
                             privateKey, @"2026-07-17T01:00:03.000Z");
  assert([log replaySignedEntry:fork currentState:state verifier:nil result:&result] ==
         AncPrivateVaultControlLogStatusFork);
  anc_pv_zeroize(privateKey, sizeof privateKey);
  anc_pv_zeroize(devicePrivate, sizeof devicePrivate);
}

static NSData *HexData(NSString *hex) {
  assert([hex isKindOfClass:[NSString class]] && hex.length % 2 == 0);
  NSMutableData *data = [NSMutableData dataWithLength:hex.length / 2];
  uint8_t *bytes = data.mutableBytes;
  for (NSUInteger index = 0; index < hex.length; index += 2) {
    unsigned int byte = 0;
    NSString *pair = [hex substringWithRange:NSMakeRange(index, 2)];
    NSScanner *scanner = [NSScanner scannerWithString:pair];
    assert([scanner scanHexInt:&byte] && scanner.isAtEnd && byte <= UINT8_MAX);
    bytes[index / 2] = (uint8_t)byte;
  }
  return data;
}

static void AssertExactKeys(NSDictionary *object, NSArray<NSString *> *keys) {
  assert([object isKindOfClass:[NSDictionary class]]);
  assert([[NSSet setWithArray:object.allKeys] isEqualToSet:[NSSet setWithArray:keys]]);
}

static void AssertFixtureMember(AncPrivateVaultControlLogMember *actual,
                                NSDictionary *expected) {
  AssertExactKeys(expected, @[@"endpointId", @"role", @"unattended", @"signingPublicKey",
                              @"keyAgreementPublicKey", @"enrollmentRef"]);
  assert([actual.endpointId isEqual:expected[@"endpointId"]]);
  assert([actual.role isEqual:expected[@"role"]]);
  assert(actual.unattended == [expected[@"unattended"] boolValue]);
  assert([actual.signingPublicKey isEqual:HexData(expected[@"signingPublicKey"])]);
  assert([actual.keyAgreementPublicKey isEqual:HexData(expected[@"keyAgreementPublicKey"])]);
  assert([actual.enrollmentRef isEqual:expected[@"enrollmentRef"]]);
}

static void AssertFixtureState(AncPrivateVaultControlLogState *actual,
                               NSDictionary *expected) {
  AssertExactKeys(expected, @[@"vaultId", @"sequence", @"headHash", @"membershipHash",
                              @"signedAt", @"activeMembers", @"removedEndpointIds", @"epoch",
                              @"recoveryGeneration", @"recoveryId", @"recoverySigningPublicKey",
                              @"recoveryKeyAgreementPublicKey", @"recoveryWrapHash",
                              @"freshnessMode"]);
  assert([actual.vaultId isEqual:expected[@"vaultId"]]);
  assert(actual.sequence == [expected[@"sequence"] unsignedLongLongValue]);
  assert([actual.headHash isEqual:HexData(expected[@"headHash"])]);
  assert([actual.membershipHash isEqual:HexData(expected[@"membershipHash"])]);
  assert([actual.signedAt isEqual:expected[@"signedAt"]]);
  NSArray *members = expected[@"activeMembers"];
  assert([members isKindOfClass:[NSArray class]] && actual.activeMembers.count == members.count);
  for (NSUInteger index = 0; index < members.count; index++) {
    AssertFixtureMember(actual.activeMembers[index], members[index]);
  }
  assert([actual.removedEndpointIds isEqual:expected[@"removedEndpointIds"]]);
  assert(actual.epoch == [expected[@"epoch"] unsignedLongLongValue]);
  assert(actual.recoveryGeneration == [expected[@"recoveryGeneration"] unsignedLongLongValue]);
  assert([actual.recoveryId isEqual:expected[@"recoveryId"]]);
  assert([actual.recoverySigningPublicKey isEqual:HexData(expected[@"recoverySigningPublicKey"])]);
  assert([actual.recoveryKeyAgreementPublicKey isEqual:HexData(expected[@"recoveryKeyAgreementPublicKey"])]);
  assert([actual.recoveryWrapHash isEqual:HexData(expected[@"recoveryWrapHash"])]);
  assert([actual.freshnessMode isEqual:expected[@"freshnessMode"]]);
}

static NSData *FixtureSHA256(NSData *data) {
  uint8_t digest[CC_SHA256_DIGEST_LENGTH] = {0};
  assert(data.length <= UINT32_MAX);
  CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
  return [NSData dataWithBytes:digest length:sizeof digest];
}

static AncPrivateVaultControlLogMember *FixtureMember(NSDictionary *json) {
  AssertExactKeys(json, @[@"endpointId", @"role", @"unattended", @"signingPublicKey",
                          @"keyAgreementPublicKey", @"enrollmentRef"]);
  AncPrivateVaultControlLogMember *member = [[AncPrivateVaultControlLogMember alloc] init];
  [member setValue:json[@"endpointId"] forKey:@"endpointId"];
  [member setValue:json[@"role"] forKey:@"role"];
  [member setValue:json[@"unattended"] forKey:@"unattended"];
  [member setValue:HexData(json[@"signingPublicKey"]) forKey:@"signingPublicKey"];
  [member setValue:HexData(json[@"keyAgreementPublicKey"]) forKey:@"keyAgreementPublicKey"];
  [member setValue:json[@"enrollmentRef"] forKey:@"enrollmentRef"];
  return member;
}

static AncPrivateVaultControlLogState *_Nullable FixtureState(id json) {
  if (json == [NSNull null]) return nil;
  assert([json isKindOfClass:[NSDictionary class]]);
  NSDictionary *dictionary = json;
  AssertExactKeys(dictionary, @[@"vaultId", @"sequence", @"headHash", @"membershipHash",
                                @"signedAt", @"activeMembers", @"removedEndpointIds", @"epoch",
                                @"recoveryGeneration", @"recoveryId", @"recoverySigningPublicKey",
                                @"recoveryKeyAgreementPublicKey", @"recoveryWrapHash",
                                @"freshnessMode"]);
  AncPrivateVaultControlLogState *state = [[AncPrivateVaultControlLogState alloc] init];
  NSMutableArray *members = [NSMutableArray array];
  for (NSDictionary *member in dictionary[@"activeMembers"]) {
    [members addObject:FixtureMember(member)];
  }
  [state setValue:dictionary[@"vaultId"] forKey:@"vaultId"];
  [state setValue:dictionary[@"sequence"] forKey:@"sequence"];
  [state setValue:HexData(dictionary[@"headHash"]) forKey:@"headHash"];
  [state setValue:HexData(dictionary[@"membershipHash"]) forKey:@"membershipHash"];
  [state setValue:dictionary[@"signedAt"] forKey:@"signedAt"];
  [state setValue:[members copy] forKey:@"activeMembers"];
  [state setValue:[dictionary[@"removedEndpointIds"] copy] forKey:@"removedEndpointIds"];
  [state setValue:dictionary[@"epoch"] forKey:@"epoch"];
  [state setValue:dictionary[@"recoveryGeneration"] forKey:@"recoveryGeneration"];
  [state setValue:dictionary[@"recoveryId"] forKey:@"recoveryId"];
  [state setValue:HexData(dictionary[@"recoverySigningPublicKey"])
            forKey:@"recoverySigningPublicKey"];
  [state setValue:HexData(dictionary[@"recoveryKeyAgreementPublicKey"])
            forKey:@"recoveryKeyAgreementPublicKey"];
  [state setValue:HexData(dictionary[@"recoveryWrapHash"]) forKey:@"recoveryWrapHash"];
  [state setValue:dictionary[@"freshnessMode"] forKey:@"freshnessMode"];
  AssertFixtureState(state, dictionary);
  return state;
}

static AncPrivateVaultControlLogStatus FixtureExpectedStatus(NSString *error) {
  NSDictionary<NSString *, NSNumber *> *statuses = @{
    @"invalid_entry" : @(AncPrivateVaultControlLogStatusInvalidEntry),
    @"invalid_signature" : @(AncPrivateVaultControlLogStatusInvalidSignature),
    @"invalid_genesis" : @(AncPrivateVaultControlLogStatusInvalidGenesis),
    @"invalid_transition" : @(AncPrivateVaultControlLogStatusInvalidTransition),
    @"unauthorized_signer" : @(AncPrivateVaultControlLogStatusUnauthorizedSigner),
    @"candidate_self_enrollment" : @(AncPrivateVaultControlLogStatusCandidateSelfEnrollment),
    @"rollback" : @(AncPrivateVaultControlLogStatusRollback),
    @"gap" : @(AncPrivateVaultControlLogStatusGap),
    @"fork" : @(AncPrivateVaultControlLogStatusFork),
    @"genesis_authorization_required" : @(AncPrivateVaultControlLogStatusGenesisAuthorizationRequired),
    @"recovery_authorization_required" : @(AncPrivateVaultControlLogStatusRecoveryAuthorizationRequired),
    @"recovery_wrap_rotation_required" : @(AncPrivateVaultControlLogStatusRecoveryWrapRotationRequired),
    @"ceremony_abort_authorization_required" : @(AncPrivateVaultControlLogStatusCeremonyAbortAuthorizationRequired),
  };
  NSNumber *status = statuses[error];
  assert(status != nil);
  return (AncPrivateVaultControlLogStatus)status.integerValue;
}

static void TestCoreFixture(NSString *fixturePath) {
  NSData *fixture = [NSData dataWithContentsOfFile:fixturePath];
  assert(fixture.length > 0);
  NSDictionary *json = [NSJSONSerialization JSONObjectWithData:fixture options:0 error:nil];
  AssertExactKeys(json, @[@"schema", @"suite", @"encoding", @"generator",
                          @"protocolBaseCommit", @"sourceAnchors", @"domains", @"identities",
                          @"states", @"steps", @"cases"]);
  assert([json[@"schema"] isEqual:@"anc/v1-native-control-log-vectors@2"]);
  assert([json[@"suite"] isEqual:@"anc/v1"] && [json[@"encoding"] isEqual:@"hex"]);
  assert([json[@"protocolBaseCommit"] isEqual:@"fd8c9800abbda048b21796a0953f449d1cc100ce"]);
  assert([json[@"generator"] isEqual:@"buildAncV1NativeControlLogVectors"]);

  NSArray *anchors = json[@"sourceAnchors"];
  NSArray *expectedSourcePaths = @[
    @"packages/core/src/e2ee/native-control-log-vectors.ts",
    @"packages/core/src/e2ee/canonical.ts",
    @"packages/core/src/e2ee/control-log.ts",
    @"packages/core/src/e2ee/portable-crypto.ts",
    @"packages/core/src/e2ee/suite.ts",
  ];
  assert([anchors isKindOfClass:[NSArray class]] && anchors.count == expectedSourcePaths.count);
  NSString *sourceRoot = NSProcessInfo.processInfo.environment[@"ANC_V1_CONTROL_LOG_SOURCE_ROOT"];
  assert(sourceRoot.length > 0);
  for (NSUInteger index = 0; index < anchors.count; index++) {
    NSDictionary *anchor = anchors[index];
    AssertExactKeys(anchor, @[@"path", @"sha256"]);
    assert([anchor[@"path"] isEqual:expectedSourcePaths[index]]);
    assert(HexData(anchor[@"sha256"]).length == 32);
    NSString *sourcePath = [sourceRoot stringByAppendingPathComponent:anchor[@"path"]];
    NSData *source = [NSData dataWithContentsOfFile:sourcePath];
    assert(source.length > 0);
    assert([FixtureSHA256(source) isEqualToData:HexData(anchor[@"sha256"])]);
  }
  NSArray *domains = json[@"domains"];
  assert([domains isKindOfClass:[NSArray class]] && domains.count == 3);
  NSArray *operations = @[@"signature", @"entry_hash", @"membership_hash"];
  for (NSUInteger index = 0; index < domains.count; index++) {
    NSDictionary *domain = domains[index];
    AssertExactKeys(domain, @[@"operation", @"tag", @"escaped", @"utf8Hex"]);
    assert([domain[@"operation"] isEqual:operations[index]] &&
           [domain[@"tag"] isEqual:@"log-entry"] &&
           [domain[@"escaped"] isEqual:@"anc/v1/log-entry\\u0000"]);
    assert([HexData(domain[@"utf8Hex"]) isEqual:
        [NSData dataWithBytes:"anc/v1/log-entry" length:sizeof("anc/v1/log-entry")]]);
  }
  NSDictionary *identities = json[@"identities"];
  AssertExactKeys(identities, @[@"owner", @"device", @"broker",
                                @"brokerReplacementCandidate", @"brokerReplacement",
                                @"recovered"]);
  for (NSDictionary *identity in identities.allValues) {
    AssertFixtureMember(FixtureMember(identity), identity);
  }

  NSArray *states = json[@"states"];
  assert([states isKindOfClass:[NSArray class]] && states.count == 22);
  NSMutableDictionary<NSString *, id> *stateByRef = [NSMutableDictionary dictionary];
  for (NSDictionary *vector in states) {
    AssertExactKeys(vector, @[@"ref", @"state"]);
    NSString *reference = vector[@"ref"];
    assert([reference isKindOfClass:[NSString class]] && reference.length > 0 &&
           stateByRef[reference] == nil);
    AncPrivateVaultControlLogState *fixtureState = FixtureState(vector[@"state"]);
    stateByRef[reference] = fixtureState ?: [NSNull null];
  }
  assert(stateByRef[@"none"] == [NSNull null]);

  TestVerifier *verifier = [[TestVerifier alloc] init];
  verifier.allowGenesis = YES; verifier.allowRecovery = YES;
  verifier.allowRecoveryWrapRotation = YES; verifier.allowAbort = YES;
  AncPrivateVaultControlLog *log = [[AncPrivateVaultControlLog alloc] init];
  AncPrivateVaultControlLogState *state = nil;
  NSArray *steps = json[@"steps"];
  assert([steps isKindOfClass:[NSArray class]] && steps.count == 11);
  for (NSDictionary *step in steps) {
    AssertExactKeys(step, @[@"name", @"expected", @"sequence", @"innerType", @"ceremonyKind",
                            @"signerEndpointId", @"signerPublicKeyHex", @"innerHex", @"unsignedHex",
                            @"signatureHex", @"outerHex", @"entryHashHex", @"membershipHashHex",
                            @"expectedState"]);
    assert([step[@"expected"] isEqual:@"accept"]);
    assert(HexData(step[@"signerPublicKeyHex"]).length == 32);
    assert(HexData(step[@"signatureHex"]).length == 64);
    assert(HexData(step[@"innerHex"]).length > 0 && HexData(step[@"unsignedHex"]).length > 0);
    NSData *outerBytes = HexData(step[@"outerHex"]);
    if ([step[@"name"] isEqual:@"recovery"]) {
      NSString *priorRecoveryId = [state.recoveryId copy];
      NSData *priorHeadHash = [state.headHash copy];
      uint64_t priorSequence = state.sequence;
      TestVerifier *mutatingVerifier = [[TestVerifier alloc] init];
      mutatingVerifier.allowRecovery = YES;
      mutatingVerifier.mutateRecoverySnapshot = YES;
      AncPrivateVaultControlLogReplayResult *negativeResult = nil;
      assert([log replaySignedEntry:outerBytes currentState:state verifier:mutatingVerifier
                              result:&negativeResult] ==
             AncPrivateVaultControlLogStatusRecoveryAuthorizationRequired);
      assert(negativeResult == nil && state.sequence == priorSequence &&
             [state.headHash isEqualToData:priorHeadHash] &&
             [state.recoveryId isEqualToString:priorRecoveryId]);
    }
    if ([step[@"name"] isEqual:@"ceremony_abort"]) {
      NSString *priorRecoveryId = [state.recoveryId copy];
      NSData *priorHeadHash = [state.headHash copy];
      uint64_t priorSequence = state.sequence;
      TestVerifier *mutatingVerifier = [[TestVerifier alloc] init];
      mutatingVerifier.allowAbort = YES;
      mutatingVerifier.mutateAbortSnapshot = YES;
      AncPrivateVaultControlLogReplayResult *negativeResult = nil;
      assert([log replaySignedEntry:outerBytes currentState:state verifier:mutatingVerifier
                              result:&negativeResult] ==
             AncPrivateVaultControlLogStatusCeremonyAbortAuthorizationRequired);
      assert(negativeResult == nil && state.sequence == priorSequence &&
             [state.headHash isEqualToData:priorHeadHash] &&
             [state.recoveryId isEqualToString:priorRecoveryId]);
    }
    BOOL ordinaryRotation = state != nil && step[@"ceremonyKind"] != [NSNull null] &&
        ![step[@"ceremonyKind"] isEqual:@"recovery"] &&
        [step[@"expectedState"][@"epoch"] unsignedLongLongValue] == state.epoch + 1;
    if (ordinaryRotation) {
      verifier.expectedRecoveryWrapSignedEntry = outerBytes;
      verifier.expectedRecoveryWrapInnerEnvelope = HexData(step[@"innerHex"]);
      verifier.expectedRecoveryWrapHash = HexData(step[@"expectedState"][@"recoveryWrapHash"]);
      verifier.expectedPriorMembershipHash = state.membershipHash;
      verifier.expectedRecoveryWrapEpoch = [step[@"expectedState"][@"epoch"] unsignedLongLongValue];
      verifier.expectedRecoveryWrapActivationTime = step[@"expectedState"][@"signedAt"];
    }
    if ([step[@"name"] isEqual:@"remove_device"]) {
      AncPrivateVaultControlLogReplayResult *negativeResult = nil;
      assert([log replaySignedEntry:outerBytes currentState:state verifier:nil
                              result:&negativeResult] ==
             AncPrivateVaultControlLogStatusRecoveryWrapRotationRequired);
      TestVerifier *falseVerifier = [[TestVerifier alloc] init];
      assert([log replaySignedEntry:outerBytes currentState:state verifier:falseVerifier
                              result:&negativeResult] ==
             AncPrivateVaultControlLogStatusRecoveryWrapRotationRequired);
      TestVerifier *mutatingVerifier = [[TestVerifier alloc] init];
      mutatingVerifier.allowRecoveryWrapRotation = YES;
      mutatingVerifier.mutateRecoveryWrapSnapshot = YES;
      assert([log replaySignedEntry:outerBytes currentState:state verifier:mutatingVerifier
                              result:&negativeResult] ==
             AncPrivateVaultControlLogStatusRecoveryWrapRotationRequired);
      NSMutableData *tampered = [outerBytes mutableCopy];
      ((uint8_t *)tampered.mutableBytes)[tampered.length - 1] ^= 1;
      assert([log replaySignedEntry:tampered currentState:state verifier:verifier
                              result:&negativeResult] ==
             AncPrivateVaultControlLogStatusInvalidSignature);
    }
    AncPrivateVaultControlLogReplayResult *result = nil;
    AncPrivateVaultControlLogStatus replay = [log replaySignedEntry:outerBytes
        currentState:state verifier:verifier result:&result];
    if (replay != AncPrivateVaultControlLogStatusOK) {
      fprintf(stderr, "fixture step %s rejected with status %ld\n",
              [step[@"name"] UTF8String], (long)replay);
    }
    assert(replay == AncPrivateVaultControlLogStatusOK && !result.idempotent);
    assert(result.state.sequence == [step[@"sequence"] unsignedLongLongValue]);
    assert([result.entryHash isEqual:HexData(step[@"entryHashHex"])]);
    assert([result.state.membershipHash isEqual:HexData(step[@"membershipHashHex"])]);
    AssertFixtureState(result.state, step[@"expectedState"]);
    NSString *stateReference = [@"step:" stringByAppendingString:step[@"name"]];
    assert(stateByRef[stateReference] != nil && stateByRef[stateReference] != [NSNull null]);
    AssertFixtureState(stateByRef[stateReference], step[@"expectedState"]);
    state = result.state;
    verifier.expectedRecoveryWrapSignedEntry = nil;
    verifier.expectedRecoveryWrapInnerEnvelope = nil;
    verifier.expectedRecoveryWrapHash = nil;
    verifier.expectedPriorMembershipHash = nil;
    verifier.expectedRecoveryWrapEpoch = 0;
    verifier.expectedRecoveryWrapActivationTime = nil;
  }

  NSArray *cases = json[@"cases"];
  assert([cases isKindOfClass:[NSArray class]] && cases.count == 100);
  NSMutableSet *caseNames = [NSMutableSet set];
  NSMutableDictionary<NSString *, NSNumber *> *matrixCounts = [NSMutableDictionary dictionary];
  for (NSDictionary *fixtureCase in cases) {
    AssertExactKeys(fixtureCase, @[@"name", @"matrix", @"priorStateRef", @"entryHex",
                                   @"expectedStatus", @"expectedError", @"expectedState",
                                   @"expectedEntryHashHex", @"authorization",
                                   @"canonicalErrorCategory"]);
    NSString *name = fixtureCase[@"name"];
    NSString *matrix = fixtureCase[@"matrix"];
    assert([name isKindOfClass:[NSString class]] && name.length > 0 &&
           ![caseNames containsObject:name]);
    [caseNames addObject:name];
    assert(([@[@"stateful", @"boundary", @"authorization", @"transition", @"wire"]
        containsObject:matrix]));
    matrixCounts[matrix] = @([matrixCounts[matrix] unsignedIntegerValue] + 1);
    NSString *priorReference = fixtureCase[@"priorStateRef"];
    id priorObject = stateByRef[priorReference];
    assert(priorObject != nil);
    AncPrivateVaultControlLogState *priorState =
        priorObject == [NSNull null] ? nil : priorObject;
    NSDictionary *authorization = fixtureCase[@"authorization"];
    AssertExactKeys(authorization, @[@"genesis", @"recovery", @"recoveryWrapRotation",
                                     @"ceremonyAbort"]);
    TestVerifier *caseVerifier = [[TestVerifier alloc] init];
    caseVerifier.allowGenesis = [authorization[@"genesis"] boolValue];
    caseVerifier.allowRecovery = [authorization[@"recovery"] boolValue];
    caseVerifier.allowRecoveryWrapRotation = [authorization[@"recoveryWrapRotation"] boolValue];
    caseVerifier.allowAbort = [authorization[@"ceremonyAbort"] boolValue];
    NSData *entryBytes = HexData(fixtureCase[@"entryHex"]);
    id canonicalCategory = fixtureCase[@"canonicalErrorCategory"];
    assert(canonicalCategory == [NSNull null] ||
           [canonicalCategory isKindOfClass:[NSString class]]);
    if (canonicalCategory != [NSNull null] &&
        [canonicalCategory hasPrefix:@"canonical."]) {
      AncPrivateVaultCanonicalStatus canonicalStatus = AncPrivateVaultCanonicalStatusOK;
      assert(AncPrivateVaultCanonicalDecode(entryBytes, entryBytes.length, &canonicalStatus) == nil);
      NSDictionary<NSString *, NSNumber *> *canonicalStatuses = @{
        @"canonical.non_shortest" : @(AncPrivateVaultCanonicalStatusNonCanonical),
        @"canonical.map_key_order" : @(AncPrivateVaultCanonicalStatusNonCanonical),
        @"canonical.indefinite" : @(AncPrivateVaultCanonicalStatusInvalid),
        @"canonical.duplicate_map_key" : @(AncPrivateVaultCanonicalStatusInvalid),
        @"canonical.unsupported_float" : @(AncPrivateVaultCanonicalStatusInvalid),
        @"canonical.invalid_utf8" : @(AncPrivateVaultCanonicalStatusInvalid),
        @"canonical.simple" : @(AncPrivateVaultCanonicalStatusInvalid),
        @"canonical.break" : @(AncPrivateVaultCanonicalStatusInvalid),
        @"canonical.truncation" : @(AncPrivateVaultCanonicalStatusInvalid),
        @"canonical.trailing_data" : @(AncPrivateVaultCanonicalStatusInvalid),
        @"canonical.map_key_negative" : @(AncPrivateVaultCanonicalStatusInvalid),
        @"canonical.map_key_type" : @(AncPrivateVaultCanonicalStatusInvalid),
      };
      NSNumber *expectedCanonicalStatus = canonicalStatuses[canonicalCategory];
      assert(expectedCanonicalStatus != nil &&
             canonicalStatus == (AncPrivateVaultCanonicalStatus)expectedCanonicalStatus.integerValue);
    }
    AncPrivateVaultControlLogReplayResult *result = nil;
    AncPrivateVaultControlLogStatus replay = [log replaySignedEntry:entryBytes
        currentState:priorState verifier:caseVerifier result:&result];
    NSString *expectedStatus = fixtureCase[@"expectedStatus"];
    if ([expectedStatus isEqual:@"reject"]) {
      assert([fixtureCase[@"expectedError"] isKindOfClass:[NSString class]]);
      AncPrivateVaultControlLogStatus expected = FixtureExpectedStatus(fixtureCase[@"expectedError"]);
      if (replay != expected) {
        fprintf(stderr, "fixture case %s returned %ld, expected %ld\n",
                name.UTF8String, (long)replay, (long)expected);
      }
      assert(replay == expected && result == nil &&
             fixtureCase[@"expectedState"] == [NSNull null] &&
             fixtureCase[@"expectedEntryHashHex"] == [NSNull null]);
    } else {
      assert([expectedStatus isEqual:@"accept"] || [expectedStatus isEqual:@"idempotent"]);
      assert(fixtureCase[@"expectedError"] == [NSNull null] &&
             [fixtureCase[@"expectedState"] isKindOfClass:[NSDictionary class]] &&
             [fixtureCase[@"expectedEntryHashHex"] isKindOfClass:[NSString class]]);
      assert(replay == AncPrivateVaultControlLogStatusOK && result != nil &&
             result.idempotent == [expectedStatus isEqual:@"idempotent"]);
      assert([result.entryHash isEqualToData:HexData(fixtureCase[@"expectedEntryHashHex"])]);
      AssertFixtureState(result.state, fixtureCase[@"expectedState"]);
    }
  }
  assert([matrixCounts[@"stateful"] unsignedIntegerValue] == 8);
  assert([matrixCounts[@"boundary"] unsignedIntegerValue] == 12);
  assert([matrixCounts[@"authorization"] unsignedIntegerValue] == 8);
  assert([matrixCounts[@"transition"] unsignedIntegerValue] == 32);
  assert([matrixCounts[@"wire"] unsignedIntegerValue] == 40);
}

static void TestUnknownMissingAndFixturePath(void) {
  AncPrivateVaultCanonicalStatus status;
  NSData *unknown = AncPrivateVaultCanonicalEncode([AncPrivateVaultCanonicalValue map:@{
    @1 : T(@"anc/v1"), @2 : T(@"vault:control-0001"), @3 : T(@"log-entry"), @999 : I(1),
  }], &status);
  AncPrivateVaultControlLogReplayResult *result = nil;
  assert([[[AncPrivateVaultControlLog alloc] init] replaySignedEntry:unknown
      currentState:nil verifier:nil result:&result] == AncPrivateVaultControlLogStatusInvalidEntry);

  NSString *fixturePath = NSProcessInfo.processInfo.environment[@"ANC_V1_CONTROL_LOG_FIXTURE_PATH"];
  assert(fixturePath.length > 0);
  TestCoreFixture(fixturePath);
}

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    TestReplayAndAdversarialCases();
    TestUnknownMissingAndFixturePath();
    puts("private-vault signed control-log replay tests passed");
  }
  return 0;
}
