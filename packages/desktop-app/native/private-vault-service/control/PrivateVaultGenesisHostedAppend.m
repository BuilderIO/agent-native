#import "PrivateVaultGenesisHostedAppend.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultGenesisPreparationArtifactStore.h"

@interface AncPrivateVaultGenesisHostedAppendReceipt ()
@property(nonatomic, readwrite) NSString *vaultId;
@property(nonatomic, readwrite) NSString *entryId;
@property(nonatomic, readwrite) uint64_t sequence;
@property(nonatomic, readwrite) NSData *headHash;
@property(nonatomic, readwrite) NSData *recoveryWrapHash;
@property(nonatomic, readwrite) uint64_t recoveryWrapByteLength;
@end

@implementation AncPrivateVaultGenesisHostedAppendReceipt
@end

static BOOL AncGenesisHostedOpaqueId(NSString *value) {
  NSData *bytes = [value dataUsingEncoding:NSUTF8StringEncoding];
  if (bytes.length < 8 || bytes.length > 160)
    return NO;
  const uint8_t *raw = bytes.bytes;
  for (NSUInteger index = 0; index < bytes.length; index += 1) {
    const uint8_t byte = raw[index];
    const BOOL alphaNumeric = (byte >= 'A' && byte <= 'Z') ||
                              (byte >= 'a' && byte <= 'z') ||
                              (byte >= '0' && byte <= '9');
    if (!alphaNumeric &&
        (index == 0 ||
         (byte != '.' && byte != '_' && byte != ':' && byte != '-')))
      return NO;
  }
  return YES;
}

AncPrivateVaultGenesisHostedAppendReceipt *
AncPrivateVaultGenesisHostedAppendReceiptDecode(NSData *encoded) {
  if (![encoded isKindOfClass:NSData.class] || encoded.length == 0 ||
      encoded.length > ANC_PV_GENESIS_HOSTED_APPEND_RECEIPT_MAX_BYTES)
    return nil;
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(
      encoded, ANC_PV_GENESIS_HOSTED_APPEND_RECEIPT_MAX_BYTES, &status);
  if (root == nil || root.type != AncPrivateVaultCanonicalTypeMap)
    return nil;
  NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map =
      root.mapValue;
  if (map.count != 9)
    return nil;
  for (NSUInteger key = 1; key <= 9; key += 1)
    if (map[@(key)] == nil)
      return nil;
  AncPrivateVaultCanonicalValue *suite = map[@1], *version = map[@2],
                                 *type = map[@3], *vault = map[@4],
                                 *entry = map[@5], *sequence = map[@6],
                                 *head = map[@7], *wrapHash = map[@8],
                                 *wrapLength = map[@9];
  if (suite.type != AncPrivateVaultCanonicalTypeText ||
      ![suite.textValue isEqualToString:@"anc/v1"] ||
      version.type != AncPrivateVaultCanonicalTypeInteger ||
      version.integerValue != 1 ||
      type.type != AncPrivateVaultCanonicalTypeText ||
      ![type.textValue isEqualToString:
                           @"control-log-genesis-append-receipt"] ||
      vault.type != AncPrivateVaultCanonicalTypeText ||
      entry.type != AncPrivateVaultCanonicalTypeText ||
      !AncGenesisHostedOpaqueId(vault.textValue) ||
      !AncGenesisHostedOpaqueId(entry.textValue) ||
      sequence.type != AncPrivateVaultCanonicalTypeInteger ||
      sequence.integerValue != 0 ||
      head.type != AncPrivateVaultCanonicalTypeBytes ||
      head.bytesValue.length != ANC_PV_HASH_BYTES ||
      wrapHash.type != AncPrivateVaultCanonicalTypeBytes ||
      wrapHash.bytesValue.length != ANC_PV_HASH_BYTES ||
      wrapLength.type != AncPrivateVaultCanonicalTypeInteger ||
      wrapLength.integerValue <= 0 ||
      wrapLength.integerValue >
          ANC_PV_GENESIS_PREPARATION_ARTIFACT_WRAP_MAX_BYTES)
    return nil;
  NSData *roundTrip = AncPrivateVaultCanonicalEncode(root, &status);
  if (roundTrip == nil || ![roundTrip isEqualToData:encoded])
    return nil;
  AncPrivateVaultGenesisHostedAppendReceipt *receipt =
      [AncPrivateVaultGenesisHostedAppendReceipt new];
  receipt.vaultId = [vault.textValue copy];
  receipt.entryId = [entry.textValue copy];
  receipt.sequence = 0;
  receipt.headHash = [head.bytesValue copy];
  receipt.recoveryWrapHash = [wrapHash.bytesValue copy];
  receipt.recoveryWrapByteLength = (uint64_t)wrapLength.integerValue;
  return receipt;
}

NSData *AncPrivateVaultGenesisHostedAppendRequestEncode(
    NSData *signedGenesisEntry, NSData *recoveryWrap) {
  if (![signedGenesisEntry isKindOfClass:NSData.class] ||
      ![recoveryWrap isKindOfClass:NSData.class] ||
      signedGenesisEntry.length == 0 || signedGenesisEntry.length > 262144 ||
      recoveryWrap.length == 0 ||
      recoveryWrap.length >
          ANC_PV_GENESIS_PREPARATION_ARTIFACT_WRAP_MAX_BYTES)
    return nil;
  AncPrivateVaultCanonicalValue *root =
      [AncPrivateVaultCanonicalValue map:@{
        @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
        @2 : [AncPrivateVaultCanonicalValue integer:1],
        @3 : [AncPrivateVaultCanonicalValue
                 text:@"control-log-genesis-append-request"],
        @4 : [AncPrivateVaultCanonicalValue bytes:signedGenesisEntry],
        @5 : [AncPrivateVaultCanonicalValue bytes:recoveryWrap],
      }];
  AncPrivateVaultCanonicalStatus status;
  NSData *encoded = AncPrivateVaultCanonicalEncode(root, &status);
  return encoded.length > 0 &&
                 encoded.length <= ANC_PV_GENESIS_HOSTED_APPEND_REQUEST_MAX_BYTES
             ? encoded
             : nil;
}
