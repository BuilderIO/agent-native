#import <Foundation/Foundation.h>

#import "PrivateVaultEnrollmentSasReceipt.h"
#import "PrivateVaultKeychain.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultEnrollmentSasReceiptStoreStatus) {
  AncPrivateVaultEnrollmentSasReceiptStoreStatusOK = 0,
  AncPrivateVaultEnrollmentSasReceiptStoreStatusNotFound = 1,
  AncPrivateVaultEnrollmentSasReceiptStoreStatusInvalid = 2,
  AncPrivateVaultEnrollmentSasReceiptStoreStatusConflict = 3,
  AncPrivateVaultEnrollmentSasReceiptStoreStatusCorrupt = 4,
  AncPrivateVaultEnrollmentSasReceiptStoreStatusInaccessible = 5,
  AncPrivateVaultEnrollmentSasReceiptStoreStatusFailed = 6,
};

/* Add-only durable decision store. Once a ceremony records mismatch, a later
 * confirmation cannot replace it; identical crash retries are idempotent. */
@interface AncPrivateVaultEnrollmentSasReceiptStore : NSObject
- (instancetype)initWithKeychain:(AncPrivateVaultKeychain *)keychain
                        recordId:(NSString *)recordId NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
- (AncPrivateVaultEnrollmentSasReceiptStoreStatus)
    storeReceipt:(NSData *)encodedReceipt
       challenge:(AncPrivateVaultEnrollmentChallengeResult *)challenge;
- (AncPrivateVaultEnrollmentSasReceiptStoreStatus)
    readChallenge:(AncPrivateVaultEnrollmentChallengeResult *)challenge
          receipt:
              (AncPrivateVaultEnrollmentSasReceipt *_Nullable *_Nonnull)receipt;
@end

NS_ASSUME_NONNULL_END
