#import "PrivateVaultGenesisBootstrap.h"

#import <Foundation/Foundation.h>
#include <stdio.h>

#ifndef ANC_PV_GENESIS_BOOTSTRAP_VECTOR_PATH
#error "ANC_PV_GENESIS_BOOTSTRAP_VECTOR_PATH must name the frozen corpus"
#endif

#define CHECK(condition)                                                       \
  do {                                                                         \
    if (!(condition)) {                                                        \
      fprintf(stderr, "CHECK failed at %s:%d: %s\n", __FILE__, __LINE__,       \
              #condition);                                                     \
      abort();                                                                 \
    }                                                                          \
  } while (0)

static NSData *DataFromHex(id value) {
  if (![value isKindOfClass:NSString.class] || [value length] % 2 != 0)
    return nil;
  NSString *hex = value;
  NSMutableData *data = [NSMutableData dataWithLength:hex.length / 2];
  uint8_t *bytes = data.mutableBytes;
  for (NSUInteger index = 0; index < data.length; index++) {
    unichar high = [hex characterAtIndex:index * 2];
    unichar low = [hex characterAtIndex:index * 2 + 1];
    if (!((high >= '0' && high <= '9') || (high >= 'a' && high <= 'f')) ||
        !((low >= '0' && low <= '9') || (low >= 'a' && low <= 'f')))
      return nil;
    uint8_t highValue =
        high <= '9' ? (uint8_t)(high - '0') : (uint8_t)(high - 'a' + 10);
    uint8_t lowValue =
        low <= '9' ? (uint8_t)(low - '0') : (uint8_t)(low - 'a' + 10);
    bytes[index] = (uint8_t)((highValue << 4) | lowValue);
  }
  return data;
}

static NSDictionary *LoadCorpus(void) {
  NSString *path = @ANC_PV_GENESIS_BOOTSTRAP_VECTOR_PATH;
  NSData *json = [NSData dataWithContentsOfFile:path];
  CHECK(json != nil);
  NSError *error = nil;
  id value = [NSJSONSerialization JSONObjectWithData:json
                                             options:0
                                               error:&error];
  CHECK(error == nil && [value isKindOfClass:NSDictionary.class]);
  return value;
}

static void CheckPositive(NSDictionary *corpus) {
  CHECK([corpus[@"schema"]
      isEqualToString:@"anc/v1-native-genesis-bootstrap-vectors@1"]);
  CHECK([corpus[@"suite"] isEqualToString:@"anc/v1"]);
  CHECK([corpus[@"domain"][@"escaped"]
      isEqualToString:@"anc/v1/genesis-bootstrap-transcript\\0"]);
  NSDictionary *exact = corpus[@"exact"];
  NSDictionary *parsed = exact[@"parsed"];
  NSData *confirmationBytes = DataFromHex(exact[@"recoveryConfirmationHex"]);
  NSData *transcriptBytes = DataFromHex(exact[@"transcriptHex"]);
  NSData *expectedDigest = DataFromHex(exact[@"digestHex"]);
  NSData *vaultId = DataFromHex(parsed[@"vaultIdHex"]);
  CHECK(confirmationBytes != nil && transcriptBytes != nil &&
        expectedDigest != nil && vaultId != nil);

  AncPrivateVaultGenesisBootstrapStatus status;
  AncPrivateVaultGenesisRecoveryConfirmation *confirmation =
      AncPrivateVaultGenesisRecoveryConfirmationDecode(confirmationBytes,
                                                       vaultId, &status);
  CHECK(confirmation != nil &&
        status == AncPrivateVaultGenesisBootstrapStatusOK);
  CHECK([AncPrivateVaultGenesisRecoveryConfirmationEncode(confirmation, &status)
      isEqualToData:confirmationBytes]);

  AncPrivateVaultGenesisBootstrapTranscript *transcript =
      AncPrivateVaultGenesisBootstrapDecode(transcriptBytes, vaultId, &status);
  CHECK(transcript != nil && status == AncPrivateVaultGenesisBootstrapStatusOK);
  CHECK([AncPrivateVaultGenesisBootstrapEncode(transcript, &status)
      isEqualToData:transcriptBytes]);
  CHECK([transcript.vaultId isEqualToData:vaultId]);
  CHECK([transcript.ceremonyId
      isEqualToData:DataFromHex(parsed[@"ceremonyIdHex"])]);
  CHECK([transcript.endpointId
      isEqualToData:DataFromHex(parsed[@"endpointIdHex"])]);
  CHECK([transcript.endpointSigningPublicKey
      isEqualToData:DataFromHex(parsed[@"endpointSigningPublicKeyHex"])]);
  CHECK([transcript.endpointKeyAgreementPublicKey
      isEqualToData:DataFromHex(parsed[@"endpointKeyAgreementPublicKeyHex"])]);
  CHECK([transcript.enrollmentRef
      isEqualToData:DataFromHex(parsed[@"enrollmentRefHex"])]);
  CHECK([transcript.recoveryId
      isEqualToData:DataFromHex(parsed[@"recoveryIdHex"])]);
  CHECK([transcript.recoverySigningPublicKey
      isEqualToData:DataFromHex(parsed[@"recoverySigningPublicKeyHex"])]);
  CHECK([transcript.recoveryKeyAgreementPublicKey
      isEqualToData:DataFromHex(parsed[@"recoveryKeyAgreementPublicKeyHex"])]);
  CHECK(transcript.recoveryGeneration == 1 && transcript.epoch == 1);
  CHECK([transcript.recoveryWrapHash
      isEqualToData:DataFromHex(parsed[@"recoveryWrapHashHex"])]);
  CHECK([transcript.recoveryConfirmationHash
      isEqualToData:DataFromHex(parsed[@"recoveryConfirmationHashHex"])]);
  BOOL transcriptImmutable = NO;
  @try {
    [transcript setValue:[NSMutableData dataWithLength:16] forKey:@"vaultId"];
  } @catch (__unused NSException *exception) {
    transcriptImmutable = YES;
  }
  CHECK(transcriptImmutable && [transcript.vaultId isEqualToData:vaultId]);

  AncPrivateVaultGenesisBootstrapResult *result =
      AncPrivateVaultGenesisBootstrapVerify(transcriptBytes, confirmationBytes,
                                            vaultId, &status);
  CHECK(result != nil && status == AncPrivateVaultGenesisBootstrapStatusOK);
  CHECK([result.digest isEqualToData:expectedDigest]);
  BOOL resultImmutable = NO;
  @try {
    [result setValue:[NSMutableData dataWithLength:32] forKey:@"digest"];
  } @catch (__unused NSException *exception) {
    resultImmutable = YES;
  }
  CHECK(resultImmutable && [result.digest isEqualToData:expectedDigest]);
  CHECK([AncPrivateVaultGenesisBootstrapVerifyDigest(transcriptBytes, vaultId,
                                                     expectedDigest, &status)
      isEqualToData:expectedDigest]);
}

static void CheckNegativeCases(NSDictionary *corpus) {
  NSArray *cases = corpus[@"negativeCases"];
  CHECK([cases isKindOfClass:NSArray.class] && cases.count == 72);
  NSMutableSet *names = [NSMutableSet setWithCapacity:cases.count];
  for (NSDictionary *testCase in cases) {
    NSString *name = testCase[@"name"];
    NSString *stage = testCase[@"stage"];
    NSString *expectedCategory = testCase[@"expectedCategory"];
    NSData *encoded = DataFromHex(testCase[@"encodedHex"]);
    CHECK(name != nil && [names containsObject:name] == NO && encoded != nil);
    [names addObject:name];
    AncPrivateVaultGenesisBootstrapStatus status =
        AncPrivateVaultGenesisBootstrapStatusOK;
    if ([stage isEqualToString:@"decode"]) {
      CHECK(AncPrivateVaultGenesisBootstrapDecode(encoded, nil, &status) ==
            nil);
    } else if ([stage isEqualToString:@"binding"]) {
      NSData *expectedVaultId = DataFromHex(testCase[@"expectedVaultIdHex"]);
      CHECK(AncPrivateVaultGenesisBootstrapDecode(encoded, expectedVaultId,
                                                  &status) == nil);
    } else if ([stage isEqualToString:@"confirmation"]) {
      NSData *confirmation = DataFromHex(testCase[@"confirmationHex"]);
      CHECK(AncPrivateVaultGenesisBootstrapVerify(encoded, confirmation, nil,
                                                  &status) == nil);
    } else if ([stage isEqualToString:@"hash"]) {
      NSData *expectedDigest = DataFromHex(testCase[@"expectedDigestHex"]);
      CHECK(AncPrivateVaultGenesisBootstrapVerifyDigest(
                encoded, nil, expectedDigest, &status) == nil);
    } else {
      CHECK(NO);
    }
    NSString *actualCategory = AncPrivateVaultGenesisBootstrapCategory(status);
    if (![actualCategory isEqualToString:expectedCategory])
      fprintf(stderr, "%s: expected %s, got %s\n", name.UTF8String,
              expectedCategory.UTF8String, actualCategory.UTF8String);
    CHECK([actualCategory isEqualToString:expectedCategory]);
  }
}

int main(void) {
  @autoreleasepool {
    NSDictionary *corpus = LoadCorpus();
    CheckPositive(corpus);
    CheckNegativeCases(corpus);
    puts("private-vault genesis bootstrap codec tests passed (72 negatives)");
  }
  return 0;
}
