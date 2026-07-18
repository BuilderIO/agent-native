#import "PrivateVaultGenesisAuthorization.h"
#import "PrivateVaultGenesisAuthorizationInternal.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultControlLogInternal.h"
#import "PrivateVaultAuthorityStoreInternal.h"

#include <stdio.h>
#include <stdlib.h>
#import <objc/runtime.h>

#ifndef ANC_PV_GENESIS_AUTHORIZATION_VECTOR_PATH
#error "ANC_PV_GENESIS_AUTHORIZATION_VECTOR_PATH is required"
#endif

#define CHECK(condition)                                                        \
  do {                                                                          \
    if (!(condition)) {                                                         \
      fprintf(stderr, "check failed at %s:%d: %s\n", __FILE__, __LINE__,       \
              #condition);                                                      \
      abort();                                                                  \
    }                                                                           \
  } while (0)

static NSData *DataFromHex(NSString *hex) {
  if (![hex isKindOfClass:NSString.class] || hex.length % 2 != 0)
    return nil;
  NSMutableData *data = [NSMutableData dataWithLength:hex.length / 2];
  uint8_t *bytes = data.mutableBytes;
  for (NSUInteger index = 0; index < data.length; index += 1) {
    unsigned value = 0;
    NSString *pair = [hex substringWithRange:NSMakeRange(index * 2, 2)];
    NSScanner *scanner = [NSScanner scannerWithString:pair];
    if (![scanner scanHexInt:&value] || !scanner.isAtEnd)
      return nil;
    bytes[index] = (uint8_t)value;
  }
  return data;
}

static NSDictionary *LoadCorpus(void) {
  NSData *data = [NSData dataWithContentsOfFile:
                              @ANC_PV_GENESIS_AUTHORIZATION_VECTOR_PATH];
  CHECK(data != nil);
  NSError *error = nil;
  NSDictionary *corpus = [NSJSONSerialization JSONObjectWithData:data
                                                          options:0
                                                            error:&error];
  CHECK(error == nil && [corpus isKindOfClass:NSDictionary.class]);
  return corpus;
}

static NSDictionary *Map(NSData *bytes) {
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *root =
      AncPrivateVaultCanonicalDecode(bytes, 256 * 1024, &status);
  CHECK(root.type == AncPrivateVaultCanonicalTypeMap);
  return root.mapValue;
}

static NSString *Text(NSDictionary *map, NSNumber *key) {
  return ((AncPrivateVaultCanonicalValue *)map[key]).textValue;
}

static NSData *Bytes(NSDictionary *map, NSNumber *key) {
  return ((AncPrivateVaultCanonicalValue *)map[key]).bytesValue;
}

static uint64_t Integer(NSDictionary *map, NSNumber *key) {
  return (uint64_t)((AncPrivateVaultCanonicalValue *)map[key]).integerValue;
}

static id NullableBytes(NSDictionary *map, NSNumber *key) {
  AncPrivateVaultCanonicalValue *value = map[key];
  return value.type == AncPrivateVaultCanonicalTypeNull ? nil : value.bytesValue;
}

/* Test-only reconstruction of the already-hardened callback's typed values.
 * Production parsing remains solely in PrivateVaultControlLog. */
static AncPrivateVaultControlLogMember *BuildMember(
    AncPrivateVaultCanonicalValue *value) {
  NSArray *items = value.arrayValue;
  AncPrivateVaultControlLogMember *member =
      [[AncPrivateVaultControlLogMember alloc] init];
  [member setValue:((AncPrivateVaultCanonicalValue *)items[0]).textValue
            forKey:@"endpointId"];
  [member setValue:((AncPrivateVaultCanonicalValue *)items[1]).textValue
            forKey:@"role"];
  [member setValue:@(((AncPrivateVaultCanonicalValue *)items[2]).booleanValue)
            forKey:@"unattended"];
  [member setValue:((AncPrivateVaultCanonicalValue *)items[3]).bytesValue
            forKey:@"signingPublicKey"];
  [member setValue:((AncPrivateVaultCanonicalValue *)items[4]).bytesValue
            forKey:@"keyAgreementPublicKey"];
  [member setValue:((AncPrivateVaultCanonicalValue *)items[5]).textValue
            forKey:@"enrollmentRef"];
  return member;
}

static NSArray *BuildMembers(AncPrivateVaultCanonicalValue *value) {
  NSMutableArray *members = [NSMutableArray array];
  for (AncPrivateVaultCanonicalValue *item in value.arrayValue)
    [members addObject:BuildMember(item)];
  return members;
}

static NSArray *BuildStrings(AncPrivateVaultCanonicalValue *value) {
  NSMutableArray *strings = [NSMutableArray array];
  for (AncPrivateVaultCanonicalValue *item in value.arrayValue)
    [strings addObject:item.textValue];
  return strings;
}

static void BuildCallback(NSData *signedBytes,
                          AncPrivateVaultControlLogMembershipCommit **commit,
                          AncPrivateVaultControlLogSignedEntry **entry,
                          NSData **innerBytes) {
  NSDictionary *outer = Map(signedBytes);
  NSData *inner = Bytes(outer, @112);
  NSDictionary *body = Map(inner);
  AncPrivateVaultControlLogMembershipCommit *typedCommit =
      [[AncPrivateVaultControlLogMembershipCommit alloc] init];
  [typedCommit setValue:Text(body, @2) forKey:@"vaultId"];
  [typedCommit setValue:Text(body, @140) forKey:@"ceremonyId"];
  [typedCommit setValue:Text(body, @141) forKey:@"ceremonyKind"];
  [typedCommit setValue:@(Integer(body, @142)) forKey:@"epoch"];
  [typedCommit setValue:NullableBytes(body, @143)
                 forKey:@"previousMembershipHash"];
  [typedCommit setValue:BuildMembers(body[@144]) forKey:@"activeMembers"];
  [typedCommit setValue:BuildStrings(body[@145])
                 forKey:@"removedEndpointIds"];
  [typedCommit setValue:@(((AncPrivateVaultCanonicalValue *)body[@146])
                              .booleanValue)
                 forKey:@"rotationCompleted"];
  [typedCommit setValue:@(((AncPrivateVaultCanonicalValue *)body[@147])
                              .booleanValue)
                 forKey:@"outstandingJobsResolved"];
  [typedCommit setValue:NullableBytes(body, @148)
                 forKey:@"recoverySnapshotHash"];
  [typedCommit setValue:NullableBytes(body, @149)
                 forKey:@"recoveryAuthorizationHash"];
  [typedCommit setValue:@(Integer(body, @155))
                 forKey:@"recoveryGeneration"];
  [typedCommit setValue:Text(body, @156) forKey:@"recoveryId"];
  [typedCommit setValue:Bytes(body, @157)
                 forKey:@"recoverySigningPublicKey"];
  [typedCommit setValue:Bytes(body, @158)
                 forKey:@"recoveryKeyAgreementPublicKey"];
  [typedCommit setValue:Bytes(body, @159) forKey:@"recoveryWrapHash"];

  AncPrivateVaultControlLogSignedEntry *typedEntry =
      [[AncPrivateVaultControlLogSignedEntry alloc] init];
  [typedEntry setValue:Text(outer, @2) forKey:@"vaultId"];
  [typedEntry setValue:Text(outer, @4) forKey:@"createdAt"];
  [typedEntry setValue:Text(outer, @5) forKey:@"envelopeId"];
  [typedEntry setValue:@(Integer(outer, @110)) forKey:@"sequence"];
  [typedEntry setValue:Bytes(outer, @111) forKey:@"previousHash"];
  [typedEntry setValue:inner forKey:@"innerEnvelopeBytes"];
  [typedEntry setValue:Text(outer, @113) forKey:@"signerEndpointId"];
  [typedEntry setValue:Bytes(outer, @114) forKey:@"signature"];
  *commit = typedCommit;
  *entry = typedEntry;
  *innerBytes = inner;
}

static AncPrivateVaultGenesisBootstrapResult *BootstrapResult(
    NSData *bootstrap, NSData *positiveConfirmation, NSData *vaultId) {
  AncPrivateVaultGenesisBootstrapStatus status;
  AncPrivateVaultGenesisBootstrapResult *result =
      AncPrivateVaultGenesisBootstrapVerify(bootstrap, positiveConfirmation,
                                            vaultId, &status);
  CHECK(result != nil && status == AncPrivateVaultGenesisBootstrapStatusOK);
  return result;
}

static NSData *EmbeddedCommit(NSData *authorization) {
  return Bytes(Map(authorization), @375);
}

static void CheckPositive(NSDictionary *corpus) {
  NSDictionary *exact = corpus[@"exact"];
  NSDictionary *parsed = exact[@"parsed"];
  NSData *authorization = DataFromHex(exact[@"authorizationHex"]);
  NSData *confirmation = DataFromHex(exact[@"recoveryConfirmationHex"]);
  NSData *bootstrap = DataFromHex(exact[@"bootstrapTranscriptHex"]);
  NSData *vaultId = DataFromHex(parsed[@"vaultIdHex"]);
  NSData *signedCommit = DataFromHex(exact[@"signedGenesisCommitHex"]);
  AncPrivateVaultGenesisBootstrapResult *bootstrapResult =
      BootstrapResult(bootstrap, confirmation, vaultId);
  AncPrivateVaultGenesisAuthorizationStatus status;
  CHECK(AncPrivateVaultGenesisAuthorizationDecodeConfirmation(
      confirmation, vaultId, &status));
  CHECK(AncPrivateVaultGenesisAuthorizationDecode(authorization, vaultId,
                                                  &status));
  CHECK([AncPrivateVaultGenesisAuthorizationCopySignedCommit(
      authorization, vaultId, &status) isEqualToData:signedCommit]);
  NSMutableData *wrongVault = [vaultId mutableCopy];
  ((uint8_t *)wrongVault.mutableBytes)[0] ^= 1;
  CHECK(AncPrivateVaultGenesisAuthorizationCopySignedCommit(
            authorization, wrongVault, &status) == nil &&
        status == AncPrivateVaultGenesisAuthorizationStatusVaultBinding);
  AncPrivateVaultGenesisAuthorizationVerifier *verifier =
      [[AncPrivateVaultGenesisAuthorizationVerifier alloc]
          initWithAuthorization:authorization
           recoveryConfirmation:confirmation
             bootstrapTranscript:bootstrap
                  bootstrapResult:bootstrapResult
                          status:&status];
  CHECK(verifier != nil && status == AncPrivateVaultGenesisAuthorizationStatusOK);
  AncPrivateVaultControlLogReplayResult *replay = nil;
  AncPrivateVaultControlLogStatus replayStatus =
      [[[AncPrivateVaultControlLog alloc] init]
          replaySignedEntry:signedCommit
               currentState:nil
                   verifier:verifier
                     result:&replay];
  CHECK(replayStatus == AncPrivateVaultControlLogStatusOK && replay != nil);
  CHECK(replay.state.sequence == 0 && replay.state.epoch == 1 &&
        replay.state.recoveryGeneration == 1 && replay.state.activeMembers.count == 1);
  CHECK([replay.state.headHash
      isEqualToData:AncPrivateVaultControlLogSignedEntryDomainHash(signedCommit)]);
  AncPrivateVaultVerifiedReplayResult *authorityCapability =
      AncPrivateVaultVerifiedGenesisReplayResultCreate(
          replay, verifier.result, 1721117511000ULL);
  CHECK(authorityCapability != nil &&
        authorityCapability.expectedCheckpoint == nil &&
        authorityCapability.nextSnapshot.targetCustodyGeneration == 2 &&
        authorityCapability.nextSnapshot.previousCustodyGeneration == 1 &&
        authorityCapability.nextSnapshot.previousSequence == nil &&
        authorityCapability.nextSnapshot.previousHead == nil &&
        authorityCapability.nextSnapshot.sequence == 0);
  CHECK(verifier.result != nil &&
        [verifier.result.authorizationDigest
            isEqualToData:DataFromHex(exact[@"authorizationDigestHex"])] &&
        [verifier.result.signedGenesisCommit isEqualToData:signedCommit]);
  NSData *e0 = nil, *e1 = nil, *e2 = nil, *e3 = nil, *e4 = nil, *e5 = nil,
         *e6 = nil, *e7 = nil, *e8 = nil, *e9 = nil, *e10 = nil, *e11 = nil,
         *bootstrapDigest = nil;
  CHECK(AncPrivateVaultGenesisAuthorizationResultCopyEvidence(
      verifier.result, &e0, &e1, &e2, &e3, &e4, &e5, &e6, &e7, &e8, &e9,
      &e10, &e11, &bootstrapDigest));
  CHECK([e0 isEqualToData:verifier.result.vaultId] &&
        [e1 isEqualToData:verifier.result.ceremonyId] &&
        [e10 isEqualToData:verifier.result.authorizationDigest] &&
        [e11 isEqualToData:signedCommit] && bootstrapDigest.length == 32);
  AncPrivateVaultGenesisAuthorizationResult *forged =
      class_createInstance(AncPrivateVaultGenesisAuthorizationResult.class, 0);
  CHECK(!AncPrivateVaultGenesisAuthorizationResultCopyEvidence(
      forged, &e0, &e1, &e2, &e3, &e4, &e5, &e6, &e7, &e8, &e9, &e10,
      &e11, &bootstrapDigest));
  for (NSString *field in @[
         @"vaultId", @"ceremonyId", @"endpointId",
         @"endpointSigningPublicKey", @"endpointKeyAgreementPublicKey",
         @"enrollmentRef", @"recoveryId", @"recoverySigningPublicKey",
         @"recoveryKeyAgreementPublicKey", @"recoveryWrapHash",
         @"authorizationDigest", @"signedGenesisCommit"
       ]) {
    BOOL fieldImmutable = NO;
    @try {
      [verifier.result setValue:[NSData data] forKey:field];
    } @catch (__unused NSException *exception) {
      fieldImmutable = YES;
    }
    CHECK(fieldImmutable);
  }
  CHECK(AncPrivateVaultGenesisAuthorizationResultCopyEvidence(
      verifier.result, &e0, &e1, &e2, &e3, &e4, &e5, &e6, &e7, &e8, &e9,
      &e10, &e11, &bootstrapDigest));
  BOOL immutable = NO;
  @try {
    [verifier setValue:@1 forKey:@"status"];
  } @catch (__unused NSException *exception) {
    immutable = YES;
  }
  CHECK(immutable &&
        verifier.status == AncPrivateVaultGenesisAuthorizationStatusOK);

  NSMutableData *mutableAuthorization = [authorization mutableCopy];
  NSMutableData *mutableConfirmation = [confirmation mutableCopy];
  NSMutableData *mutableBootstrap = [bootstrap mutableCopy];
  AncPrivateVaultGenesisAuthorizationVerifier *snapshotVerifier =
      [[AncPrivateVaultGenesisAuthorizationVerifier alloc]
          initWithAuthorization:mutableAuthorization
           recoveryConfirmation:mutableConfirmation
             bootstrapTranscript:mutableBootstrap
                  bootstrapResult:bootstrapResult
                          status:&status];
  memset(mutableAuthorization.mutableBytes, 0, mutableAuthorization.length);
  memset(mutableConfirmation.mutableBytes, 0, mutableConfirmation.length);
  memset(mutableBootstrap.mutableBytes, 0, mutableBootstrap.length);
  replay = nil;
  CHECK([[[AncPrivateVaultControlLog alloc] init]
            replaySignedEntry:signedCommit
                 currentState:nil
                     verifier:snapshotVerifier
                       result:&replay] == AncPrivateVaultControlLogStatusOK);
}

static void CheckPositiveCases(NSDictionary *corpus) {
  NSDictionary *exact = corpus[@"exact"];
  NSData *vaultId = DataFromHex(exact[@"parsed"][@"vaultIdHex"]);
  for (NSDictionary *testCase in corpus[@"positiveCases"]) {
    NSData *authorization = DataFromHex(testCase[@"authorizationHex"]);
    NSData *confirmation = DataFromHex(testCase[@"recoveryConfirmationHex"]);
    NSData *bootstrap = DataFromHex(testCase[@"bootstrapTranscriptHex"]);
    AncPrivateVaultGenesisBootstrapResult *bootstrapResult =
        BootstrapResult(bootstrap, confirmation, vaultId);
    AncPrivateVaultGenesisAuthorizationStatus status;
    AncPrivateVaultGenesisAuthorizationVerifier *verifier =
        [[AncPrivateVaultGenesisAuthorizationVerifier alloc]
            initWithAuthorization:authorization
             recoveryConfirmation:confirmation
               bootstrapTranscript:bootstrap
                    bootstrapResult:bootstrapResult
                            status:&status];
    CHECK(verifier != nil &&
          status == AncPrivateVaultGenesisAuthorizationStatusOK);
    NSData *signedCommit = EmbeddedCommit(authorization);
    AncPrivateVaultControlLogReplayResult *replay = nil;
    CHECK([[[AncPrivateVaultControlLog alloc] init]
              replaySignedEntry:signedCommit
                   currentState:nil
                       verifier:verifier
                         result:&replay] == AncPrivateVaultControlLogStatusOK);
    CHECK(replay.state.sequence == 0 && replay.state.epoch == 1 &&
          [replay.state.headHash
              isEqualToData:
                  AncPrivateVaultControlLogSignedEntryDomainHash(signedCommit)]);
  }
}

static void CheckNegativeCases(NSDictionary *corpus) {
  NSDictionary *exact = corpus[@"exact"];
  NSData *positiveCommit = DataFromHex(exact[@"signedGenesisCommitHex"]);
  NSData *positiveConfirmation = DataFromHex(exact[@"recoveryConfirmationHex"]);
  NSData *positiveBootstrap = DataFromHex(exact[@"bootstrapTranscriptHex"]);
  NSData *positiveVaultId = DataFromHex(exact[@"parsed"][@"vaultIdHex"]);
  AncPrivateVaultGenesisBootstrapResult *positiveBootstrapResult =
      BootstrapResult(positiveBootstrap, positiveConfirmation, positiveVaultId);
  NSArray *cases = corpus[@"negativeCases"];
  CHECK([cases isKindOfClass:NSArray.class] && cases.count > 0);
  NSMutableSet *names = [NSMutableSet set];
  for (NSDictionary *testCase in cases) {
    NSString *name = testCase[@"name"];
    NSString *stage = testCase[@"stage"];
    NSString *expected = testCase[@"expectedCategory"];
    NSData *authorization = DataFromHex(testCase[@"authorizationHex"]);
    NSData *confirmation = DataFromHex(testCase[@"recoveryConfirmationHex"]);
    NSData *bootstrap = DataFromHex(testCase[@"bootstrapTranscriptHex"]);
    NSData *vaultId = DataFromHex(testCase[@"expectedVaultIdHex"]);
    CHECK(name != nil && ![names containsObject:name]);
    [names addObject:name];
    AncPrivateVaultGenesisAuthorizationStatus status =
        AncPrivateVaultGenesisAuthorizationStatusOK;
    BOOL accepted = NO;
    if ([stage isEqualToString:@"confirmation-decode"]) {
      accepted = AncPrivateVaultGenesisAuthorizationDecodeConfirmation(
          confirmation, vaultId, &status);
    } else if ([stage isEqualToString:@"authorization-decode"]) {
      accepted = AncPrivateVaultGenesisAuthorizationDecode(authorization,
                                                           vaultId, &status);
    } else {
      AncPrivateVaultGenesisBootstrapStatus bootstrapStatus;
      AncPrivateVaultGenesisBootstrapResult *bootstrapResult =
          AncPrivateVaultGenesisBootstrapVerify(
              bootstrap, confirmation, vaultId, &bootstrapStatus);
      if (bootstrapResult == nil)
        bootstrapResult = positiveBootstrapResult;
      AncPrivateVaultGenesisAuthorizationVerifier *verifier =
          [[AncPrivateVaultGenesisAuthorizationVerifier alloc]
              initWithAuthorization:authorization
               recoveryConfirmation:confirmation
                 bootstrapTranscript:bootstrap
                      bootstrapResult:bootstrapResult
                              status:&status];
      if (verifier != nil) {
        id callbackHex = testCase[@"callbackSignedGenesisCommitHex"];
        NSData *callback = callbackHex == NSNull.null || callbackHex == nil
                               ? EmbeddedCommit(authorization)
                               : DataFromHex(callbackHex);
        AncPrivateVaultCanonicalStatus callbackStatus;
        AncPrivateVaultCanonicalValue *callbackRoot =
            AncPrivateVaultCanonicalDecode(callback, 64 * 1024,
                                           &callbackStatus);
        if (callbackRoot.type != AncPrivateVaultCanonicalTypeMap ||
            ((AncPrivateVaultCanonicalValue *)callbackRoot.mapValue[@112]).type !=
                AncPrivateVaultCanonicalTypeBytes)
          callback = positiveCommit;
        AncPrivateVaultControlLogMembershipCommit *commit = nil;
        AncPrivateVaultControlLogSignedEntry *entry = nil;
        NSData *inner = nil;
        BuildCallback(callback, &commit, &entry, &inner);
        accepted = [verifier verifyGenesisMembershipCommit:commit
                                                signedEntry:entry
                                           signedEntryBytes:callback
                                         innerEnvelopeBytes:inner];
        status = verifier.status;
      }
    }
    NSString *actual = AncPrivateVaultGenesisAuthorizationCategory(status);
    if (accepted || ![actual isEqualToString:expected])
      fprintf(stderr, "%s: expected %s, got %s (accepted=%d)\n",
              name.UTF8String, expected.UTF8String, actual.UTF8String,
              accepted);
    CHECK(!accepted && [actual isEqualToString:expected]);
  }
}

static void CheckCrossArtifactMixAndMatch(NSDictionary *corpus) {
  NSDictionary *exact = corpus[@"exact"];
  NSData *authorization = DataFromHex(exact[@"authorizationHex"]);
  NSData *confirmation = DataFromHex(exact[@"recoveryConfirmationHex"]);
  NSData *bootstrap = DataFromHex(exact[@"bootstrapTranscriptHex"]);
  NSData *vaultId = DataFromHex(exact[@"parsed"][@"vaultIdHex"]);
  NSDictionary *alternateCase = nil;
  for (NSDictionary *testCase in corpus[@"negativeCases"])
    if ([testCase[@"name"] isEqualToString:
                              @"embedded_recovery_confirmation_substitution"])
      alternateCase = testCase;
  CHECK(alternateCase != nil);
  authorization = DataFromHex(alternateCase[@"authorizationHex"]);
  AncPrivateVaultGenesisAuthorizationStatus status;
  AncPrivateVaultGenesisBootstrapResult *bootstrapResult =
      BootstrapResult(bootstrap, confirmation, vaultId);
  AncPrivateVaultGenesisAuthorizationVerifier *verifier =
      [[AncPrivateVaultGenesisAuthorizationVerifier alloc]
          initWithAuthorization:authorization
           recoveryConfirmation:DataFromHex(
                                    alternateCase[@"recoveryConfirmationHex"])
             bootstrapTranscript:bootstrap
                  bootstrapResult:bootstrapResult
                          status:&status];
  CHECK(verifier != nil);
  NSData *signedCommit = EmbeddedCommit(authorization);
  AncPrivateVaultControlLogMembershipCommit *commit = nil;
  AncPrivateVaultControlLogSignedEntry *entry = nil;
  NSData *inner = nil;
  BuildCallback(signedCommit, &commit, &entry, &inner);
  CHECK(![verifier verifyGenesisMembershipCommit:commit
                                      signedEntry:entry
                                 signedEntryBytes:signedCommit
                               innerEnvelopeBytes:inner] &&
        verifier.status ==
            AncPrivateVaultGenesisAuthorizationStatusRecoveryConfirmationBinding);
}

int main(void) {
  @autoreleasepool {
    NSDictionary *corpus = LoadCorpus();
    CheckPositive(corpus);
    CheckPositiveCases(corpus);
    CheckNegativeCases(corpus);
    CheckCrossArtifactMixAndMatch(corpus);
    printf("private-vault genesis authorization tests passed (%lu negatives)\n",
           (unsigned long)((NSArray *)corpus[@"negativeCases"]).count);
  }
  return 0;
}
