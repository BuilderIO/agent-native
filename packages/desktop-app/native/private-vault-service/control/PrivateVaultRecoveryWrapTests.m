#import <Foundation/Foundation.h>

#import "PrivateVaultCrypto.h"
#import "PrivateVaultRecoveryWrap.h"

#include <stdio.h>

#ifndef ANC_PV_RECOVERY_WRAP_VECTOR_PATH
#error ANC_PV_RECOVERY_WRAP_VECTOR_PATH must name the frozen Core fixture
#endif

#define CHECK(value)                                                           \
  do {                                                                         \
    if (!(value)) {                                                            \
      fprintf(stderr, "recovery-wrap CHECK failed %s:%d: %s\n", __FILE__,      \
              __LINE__, #value);                                               \
      return 1;                                                                \
    }                                                                          \
  } while (0)

static NSMutableData *Hex(NSString *hex) {
  if (![hex isKindOfClass:NSString.class] || hex.length % 2 != 0)
    return nil;
  NSMutableData *data = [NSMutableData dataWithLength:hex.length / 2];
  for (NSUInteger index = 0; index < data.length; index++) {
    unsigned int byte = 0;
    if (sscanf([[hex substringWithRange:NSMakeRange(index * 2, 2)] UTF8String],
               "%2x", &byte) != 1)
      return nil;
    ((uint8_t *)data.mutableBytes)[index] = (uint8_t)byte;
  }
  return data;
}

static NSMutableData *DomainHash(NSString *middle, NSData *suffix) {
  static const uint8_t prefix[] = "anc/v1/recovery-wrap";
  NSMutableData *message = [NSMutableData dataWithBytes:prefix
                                                 length:sizeof prefix];
  [message appendData:[middle dataUsingEncoding:NSUTF8StringEncoding]];
  uint8_t zero = 0;
  [message appendBytes:&zero length:1];
  [message appendData:suffix];
  NSMutableData *digest = [NSMutableData dataWithLength:32];
  if (anc_pv_blake2b_256(digest.mutableBytes, message.bytes, message.length) !=
      ANC_PV_CRYPTO_OK)
    return nil;
  anc_pv_zeroize(message.mutableBytes, message.length);
  return digest;
}

static NSMutableData *Derive(NSString *label) {
  return DomainHash(@"native-recovery-wrap/test-derivation",
                    [label dataUsingEncoding:NSUTF8StringEncoding]);
}

static NSData *ExpectedVault(NSDictionary *testCase) {
  NSString *value = testCase[@"overrides"][@"expectedVaultIdHex"];
  return Hex(value
                 ?: [@"01" stringByPaddingToLength:32
                                        withString:@"01"
                                   startingAtIndex:0]);
}

static NSMutableDictionary *MutableProjection(NSDictionary *value) {
  NSData *json = [NSJSONSerialization dataWithJSONObject:value
                                                 options:0
                                                   error:nil];
  return json == nil ? nil
                     : [NSJSONSerialization
                           JSONObjectWithData:json
                                      options:NSJSONReadingMutableContainers |
                                              NSJSONReadingMutableLeaves
                                        error:nil];
}

static NSDictionary *CaseNamed(NSArray *cases, NSString *name) {
  for (NSDictionary *testCase in cases)
    if ([testCase[@"name"] isEqual:name])
      return testCase;
  return nil;
}

static BOOL RejectsRotationProjection(NSDictionary *baseline,
                                      NSMutableDictionary *state,
                                      NSMutableDictionary *commit,
                                      NSMutableDictionary *entry) {
  AncPrivateVaultRecoveryWrapStatus status;
  return AncPrivateVaultRecoveryWrapVerifyRotation(Hex(baseline[@"encodedHex"]),
                                                   state, commit, entry,
                                                   &status) == nil &&
         status == AncPrivateVaultRecoveryWrapStatusControlBinding;
}

static AncPrivateVaultRecoveryWrapStatus RunCase(NSDictionary *testCase,
                                                 NSData **output) {
  if (output)
    *output = nil;
  NSString *stage = testCase[@"stage"];
  NSDictionary *overrides = testCase[@"overrides"];
  NSData *encoded = Hex(testCase[@"encodedHex"]);
  AncPrivateVaultRecoveryWrapStatus status;
  if ([stage isEqualToString:@"decode"]) {
    AncPrivateVaultRecoveryWrapDecode(encoded, ExpectedVault(testCase),
                                      &status);
    return status;
  }
  if ([stage isEqualToString:@"verify"]) {
    AncPrivateVaultRecoveryWrapVerify(
        encoded, ExpectedVault(testCase),
        Hex(overrides[@"issuerSigningPublicKeyHex"]), &status);
    return status;
  }
  if ([stage isEqualToString:@"rotation"]) {
    AncPrivateVaultRecoveryWrapVerifyRotation(encoded, overrides[@"state"],
                                              overrides[@"commit"],
                                              overrides[@"entry"], &status);
    return status;
  }
  if ([stage isEqualToString:@"current"]) {
    AncPrivateVaultRecoveryWrapVerifyCurrent(
        encoded, overrides[@"state"], [overrides[@"now"] unsignedLongLongValue],
        &status);
    return status;
  }
  if ([stage isEqualToString:@"hash"]) {
    NSData *hash = AncPrivateVaultRecoveryWrapHash(
        encoded, ExpectedVault(testCase), &status);
    if (output)
      *output = hash;
    return status;
  }
  NSMutableData *seed =
      Derive(overrides[@"recoveryKeyAgreementPrivateKeyLabel"]);
  uint8_t publicKey[32] = {0}, privateKey[32] = {0};
  if (seed == nil || anc_pv_box_seed_keypair(publicKey, privateKey,
                                             seed.bytes) != ANC_PV_CRYPTO_OK)
    return AncPrivateVaultRecoveryWrapStatusUnsealAuthentication;
  __block NSMutableData *commitment = nil;
  status = AncPrivateVaultRecoveryWrapUnseal(
      encoded, ExpectedVault(testCase),
      Hex(overrides[@"issuerSigningPublicKeyHex"]),
      Hex(overrides[@"issuerKeyAgreementPublicKeyHex"]), privateKey,
      ^BOOL(const uint8_t eek[32]) {
        commitment = DomainHash(@"native-recovery-wrap/test-commitment",
                                [NSData dataWithBytes:eek length:32]);
        return commitment != nil;
      });
  anc_pv_zeroize(privateKey, sizeof privateKey);
  anc_pv_zeroize(publicKey, sizeof publicKey);
  anc_pv_zeroize(seed.mutableBytes, seed.length);
  if (output)
    *output = commitment;
  return status;
}

int main(void) {
  @autoreleasepool {
    NSData *json =
        [NSData dataWithContentsOfFile:@ANC_PV_RECOVERY_WRAP_VECTOR_PATH];
    CHECK(json != nil);
    NSDictionary *fixture = [NSJSONSerialization JSONObjectWithData:json
                                                            options:0
                                                              error:nil];
    CHECK([fixture[@"schema"]
        isEqualToString:@"anc/v1-native-recovery-wrap-vectors@1"]);
    CHECK([fixture[@"positiveCases"] count] == 6);
    CHECK([fixture[@"negativeCases"] count] == 93);
    NSDictionary *exact = fixture[@"exact"];
    AncPrivateVaultRecoveryWrapStatus status;
    AncPrivateVaultRecoveryWrap *parsed = AncPrivateVaultRecoveryWrapVerify(
        Hex(exact[@"signedHex"]), Hex(exact[@"parsed"][@"vaultIdHex"]),
        Hex(exact[@"issuerSigningPublicKeyHex"]), &status);
    CHECK(parsed != nil && status == AncPrivateVaultRecoveryWrapStatusOK);
    CHECK([[AncPrivateVaultRecoveryWrapEncodeUnsigned(parsed, &status) copy]
        isEqualToData:Hex(exact[@"unsignedHex"])]);
    CHECK([[AncPrivateVaultRecoveryWrapHash(
        Hex(exact[@"signedHex"]), Hex(exact[@"parsed"][@"vaultIdHex"]), &status)
        copy] isEqualToData:Hex(exact[@"artifactHashHex"])]);

    NSDictionary *rotation =
        CaseNamed(fixture[@"positiveCases"],
                  @"ordinary_rotation_fractional_lower_boundary");
    CHECK(rotation != nil);
    NSDictionary *rotationOverrides = rotation[@"overrides"];
#define CHECK_HOSTILE_PROJECTION(mutation)                                     \
  do {                                                                         \
    NSMutableDictionary *state =                                               \
        MutableProjection(rotationOverrides[@"state"]);                        \
    NSMutableDictionary *commit =                                              \
        MutableProjection(rotationOverrides[@"commit"]);                       \
    NSMutableDictionary *entry =                                               \
        MutableProjection(rotationOverrides[@"entry"]);                        \
    mutation;                                                                  \
    CHECK(RejectsRotationProjection(rotation, state, commit, entry));          \
  } while (0)
    CHECK_HOSTILE_PROJECTION(state[@"unexpected"] = @YES);
    CHECK_HOSTILE_PROJECTION(state[@"freshnessMode"] = @"eventually_maybe");
    CHECK_HOSTILE_PROJECTION(state[@"removedEndpointIds"] =
                                 [NSMutableArray arrayWithObject:@"ABC"]);
    CHECK_HOSTILE_PROJECTION(state[@"activeMembers"][0][@"unattended"] = @YES);
    CHECK_HOSTILE_PROJECTION(commit[@"rotationCompleted"] = @"true");
    CHECK_HOSTILE_PROJECTION(commit[@"ceremonyKind"] = @"vibes_only");
    CHECK_HOSTILE_PROJECTION(commit[@"recoverySnapshotHash"] =
                                 [@"ab" stringByPaddingToLength:64
                                                     withString:@"ab"
                                                startingAtIndex:0]);
    CHECK_HOSTILE_PROJECTION(
        commit[@"removedEndpointIds"] = [NSMutableArray
            arrayWithObject:@"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]);
    CHECK_HOSTILE_PROJECTION(entry[@"unexpected"] = @NO);
    CHECK_HOSTILE_PROJECTION(entry[@"innerEnvelope"][@"recoveryGeneration"] =
                                 @2);
#undef CHECK_HOSTILE_PROJECTION

    NSDictionary *current = CaseNamed(fixture[@"positiveCases"],
                                      @"current_wrap_after_later_replay");
    CHECK(current != nil);
    NSMutableDictionary *malformedCurrent =
        MutableProjection(current[@"overrides"][@"state"]);
    malformedCurrent[@"activeMembers"][0][@"role"] = @"administrator";
    CHECK(AncPrivateVaultRecoveryWrapVerifyCurrent(
              Hex(current[@"encodedHex"]), malformedCurrent,
              [current[@"overrides"][@"now"] unsignedLongLongValue],
              &status) == nil &&
          status == AncPrivateVaultRecoveryWrapStatusControlBinding);

    for (NSDictionary *testCase in [fixture[@"positiveCases"]
             arrayByAddingObjectsFromArray:fixture[@"negativeCases"]]) {
      __block BOOL zeroed = YES;
      __block NSUInteger zeroEvents = 0;
      AncPrivateVaultRecoveryWrapSetZeroizationHookForTesting(^(BOOL clear) {
        zeroed = zeroed && clear;
        zeroEvents += 1;
      });
      NSData *output = nil;
      AncPrivateVaultRecoveryWrapStatus actual = RunCase(testCase, &output);
      AncPrivateVaultRecoveryWrapSetZeroizationHookForTesting(nil);
      BOOL accepts = [testCase[@"expectedStatus"] isEqualToString:@"accept"];
      if ((actual == AncPrivateVaultRecoveryWrapStatusOK) != accepts ||
          (!accepts && ![AncPrivateVaultRecoveryWrapCategory(actual)
                           isEqualToString:testCase[@"expectedCategory"]]))
        fprintf(stderr, "recovery-wrap case %s: expected %s, got %s\n",
                [testCase[@"name"] UTF8String],
                [testCase[@"expectedCategory"] UTF8String],
                [AncPrivateVaultRecoveryWrapCategory(actual) UTF8String]);
      CHECK((actual == AncPrivateVaultRecoveryWrapStatusOK) == accepts);
      if (!accepts)
        CHECK([AncPrivateVaultRecoveryWrapCategory(actual)
            isEqualToString:testCase[@"expectedCategory"]]);
      if ([testCase[@"expectedOutputZeroed"] boolValue])
        CHECK(zeroEvents > 0 && zeroed);
      if (accepts && [testCase[@"stage"] isEqualToString:@"unseal"])
        CHECK([output isEqualToData:Hex(exact[@"unsealedEekCommitmentHex"])]);
    }

    NSDictionary *unseal =
        CaseNamed(fixture[@"positiveCases"], @"exact_eek_unseal");
    NSMutableData *unsealSeed =
        Derive(unseal[@"overrides"][@"recoveryKeyAgreementPrivateKeyLabel"]);
    uint8_t unsealPublicKey[32] = {0}, unsealPrivateKey[32] = {0};
    CHECK(anc_pv_box_seed_keypair(unsealPublicKey, unsealPrivateKey,
                                  unsealSeed.bytes) == ANC_PV_CRYPTO_OK);
    __block BOOL exceptionBufferCleared = NO;
    AncPrivateVaultRecoveryWrapSetZeroizationHookForTesting(^(BOOL clear) {
      exceptionBufferCleared = clear;
    });
    status = AncPrivateVaultRecoveryWrapUnseal(
        Hex(unseal[@"encodedHex"]), ExpectedVault(unseal),
        Hex(unseal[@"overrides"][@"issuerSigningPublicKeyHex"]),
        Hex(unseal[@"overrides"][@"issuerKeyAgreementPublicKeyHex"]),
        unsealPrivateKey, ^BOOL(__unused const uint8_t eek[32]) {
          @throw [NSException exceptionWithName:@"HostileConsumer"
                                         reason:@"test"
                                       userInfo:nil];
        });
    AncPrivateVaultRecoveryWrapSetZeroizationHookForTesting(nil);
    CHECK(status == AncPrivateVaultRecoveryWrapStatusUnsealZeroization);
    CHECK(exceptionBufferCleared);
    anc_pv_zeroize(unsealPrivateKey, sizeof unsealPrivateKey);
    anc_pv_zeroize(unsealPublicKey, sizeof unsealPublicKey);
    anc_pv_zeroize(unsealSeed.mutableBytes, unsealSeed.length);
    puts("private-vault signed recovery-wrap tests passed");
  }
  return 0;
}
