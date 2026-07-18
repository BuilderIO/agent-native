#import "PrivateVaultEnrollmentSasReceiptStore.h"

#import "PrivateVaultAncCanonical.h"

@interface AncPrivateVaultEnrollmentSasReceiptStore ()
@property(nonatomic) AncPrivateVaultKeychain *keychain;
@property(nonatomic) NSString *recordId;
@end

static NSString *Hex(NSData *data) {
  if (![data isKindOfClass:NSData.class] || data.length != 16)
    return nil;
  const uint8_t *bytes = data.bytes;
  NSMutableString *value = [NSMutableString stringWithCapacity:32];
  for (NSUInteger index = 0; index < 16; index += 1)
    [value appendFormat:@"%02x", bytes[index]];
  return value;
}

static NSString *ReceiptRecordId(NSString *base, NSData *ceremonyId) {
  NSString *ceremony = Hex(ceremonyId);
  return base.length == 0 || ceremony == nil
             ? nil
             : [NSString stringWithFormat:@"%@:%@", base, ceremony];
}

static AncPrivateVaultEnrollmentSasReceiptStoreStatus
MapStatus(AncPrivateVaultKeychainStatus status) {
  switch (status) {
  case AncPrivateVaultKeychainStatusOK:
    return AncPrivateVaultEnrollmentSasReceiptStoreStatusOK;
  case AncPrivateVaultKeychainStatusNotFound:
    return AncPrivateVaultEnrollmentSasReceiptStoreStatusNotFound;
  case AncPrivateVaultKeychainStatusDuplicate:
    return AncPrivateVaultEnrollmentSasReceiptStoreStatusConflict;
  case AncPrivateVaultKeychainStatusCorrupt:
    return AncPrivateVaultEnrollmentSasReceiptStoreStatusCorrupt;
  case AncPrivateVaultKeychainStatusInaccessible:
    return AncPrivateVaultEnrollmentSasReceiptStoreStatusInaccessible;
  case AncPrivateVaultKeychainStatusInvalid:
    return AncPrivateVaultEnrollmentSasReceiptStoreStatusInvalid;
  case AncPrivateVaultKeychainStatusFailed:
    return AncPrivateVaultEnrollmentSasReceiptStoreStatusFailed;
  }
}

@implementation AncPrivateVaultEnrollmentSasReceiptStore
- (instancetype)initWithKeychain:(AncPrivateVaultKeychain *)keychain
                        recordId:(NSString *)recordId {
  self = [super init];
  if (self == nil || keychain == nil || recordId.length == 0)
    return nil;
  _keychain = keychain;
  _recordId = [recordId copy];
  return self;
}

- (AncPrivateVaultEnrollmentSasReceiptStoreStatus)
    storeReceipt:(NSData *)encodedReceipt
       challenge:(AncPrivateVaultEnrollmentChallengeResult *)challenge {
  AncPrivateVaultEnrollmentSasReceiptStatus receiptStatus;
  AncPrivateVaultEnrollmentSasReceipt *receipt =
      AncPrivateVaultEnrollmentSasReceiptVerify(encodedReceipt, challenge,
                                                &receiptStatus);
  NSString *vault = Hex(receipt.vaultId);
  NSString *recordId = ReceiptRecordId(self.recordId, receipt.ceremonyId);
  if (receipt == nil || vault == nil || recordId == nil) {
    return receiptStatus == AncPrivateVaultEnrollmentSasReceiptStatusInvalid
               ? AncPrivateVaultEnrollmentSasReceiptStoreStatusInvalid
               : AncPrivateVaultEnrollmentSasReceiptStoreStatusCorrupt;
  }
  NSData *existing = nil;
  AncPrivateVaultKeychainStatus existingRead = [self.keychain
      copyDataForService:AncPrivateVaultEnrollmentSasReceiptService
                 vaultId:vault
                recordId:recordId
                    data:&existing];
  if (existingRead == AncPrivateVaultKeychainStatusOK) {
    if ([existing isEqualToData:receipt.encodedReceipt])
      return AncPrivateVaultEnrollmentSasReceiptStoreStatusOK;
    AncPrivateVaultEnrollmentSasReceiptStatus existingStatus;
    return AncPrivateVaultEnrollmentSasReceiptVerify(existing, challenge,
                                                     &existingStatus) != nil
               ? AncPrivateVaultEnrollmentSasReceiptStoreStatusConflict
               : AncPrivateVaultEnrollmentSasReceiptStoreStatusCorrupt;
  }
  if (existingRead != AncPrivateVaultKeychainStatusNotFound)
    return MapStatus(existingRead);
  AncPrivateVaultKeychainStatus stored =
      [self.keychain addData:receipt.encodedReceipt
                  forService:AncPrivateVaultEnrollmentSasReceiptService
                     vaultId:vault
                    recordId:recordId];
  if (stored == AncPrivateVaultKeychainStatusOK)
    return AncPrivateVaultEnrollmentSasReceiptStoreStatusOK;
  if (stored != AncPrivateVaultKeychainStatusDuplicate &&
      stored != AncPrivateVaultKeychainStatusCorrupt)
    return MapStatus(stored);
  existing = nil;
  AncPrivateVaultKeychainStatus read = [self.keychain
      copyDataForService:AncPrivateVaultEnrollmentSasReceiptService
                 vaultId:vault
                recordId:recordId
                    data:&existing];
  if (read != AncPrivateVaultKeychainStatusOK)
    return MapStatus(read);
  if ([existing isEqualToData:receipt.encodedReceipt])
    return AncPrivateVaultEnrollmentSasReceiptStoreStatusOK;
  AncPrivateVaultEnrollmentSasReceiptStatus existingStatus;
  return AncPrivateVaultEnrollmentSasReceiptVerify(existing, challenge,
                                                   &existingStatus) != nil
             ? AncPrivateVaultEnrollmentSasReceiptStoreStatusConflict
             : AncPrivateVaultEnrollmentSasReceiptStoreStatusCorrupt;
}

- (AncPrivateVaultEnrollmentSasReceiptStoreStatus)
    readChallenge:(AncPrivateVaultEnrollmentChallengeResult *)challenge
          receipt:(AncPrivateVaultEnrollmentSasReceipt **)receipt {
  if (receipt == NULL)
    return AncPrivateVaultEnrollmentSasReceiptStoreStatusInvalid;
  *receipt = nil;
  NSData *vaultId = nil;
  @try {
    AncPrivateVaultCanonicalStatus status;
    AncPrivateVaultCanonicalValue *root = AncPrivateVaultCanonicalDecode(
        challenge.encodedChallenge, 2048, &status);
    vaultId = root.mapValue[@2].bytesValue;
  } @catch (__unused NSException *exception) {
    return AncPrivateVaultEnrollmentSasReceiptStoreStatusInvalid;
  }
  NSString *vault = Hex(vaultId);
  NSString *recordId = ReceiptRecordId(self.recordId, challenge.ceremonyId);
  if (vault == nil || recordId == nil)
    return AncPrivateVaultEnrollmentSasReceiptStoreStatusInvalid;
  NSData *encoded = nil;
  AncPrivateVaultKeychainStatus read = [self.keychain
      copyDataForService:AncPrivateVaultEnrollmentSasReceiptService
                 vaultId:vault
                recordId:recordId
                    data:&encoded];
  if (read != AncPrivateVaultKeychainStatusOK)
    return MapStatus(read);
  AncPrivateVaultEnrollmentSasReceiptStatus receiptStatus;
  AncPrivateVaultEnrollmentSasReceipt *decoded =
      AncPrivateVaultEnrollmentSasReceiptVerify(encoded, challenge,
                                                &receiptStatus);
  if (decoded == nil)
    return AncPrivateVaultEnrollmentSasReceiptStoreStatusCorrupt;
  *receipt = decoded;
  return AncPrivateVaultEnrollmentSasReceiptStoreStatusOK;
}
@end
