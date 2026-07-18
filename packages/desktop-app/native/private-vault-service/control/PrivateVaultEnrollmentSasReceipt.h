#import <Foundation/Foundation.h>

#import "PrivateVaultEnrollmentChallenge.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultEnrollmentSasDecision) {
  AncPrivateVaultEnrollmentSasDecisionConfirmed = 1,
  AncPrivateVaultEnrollmentSasDecisionMismatch = 2,
};

typedef NS_ENUM(NSInteger, AncPrivateVaultEnrollmentSasReceiptStatus) {
  AncPrivateVaultEnrollmentSasReceiptStatusOK = 0,
  AncPrivateVaultEnrollmentSasReceiptStatusInvalid = 1,
  AncPrivateVaultEnrollmentSasReceiptStatusBindingMismatch = 2,
  AncPrivateVaultEnrollmentSasReceiptStatusInvalidSignature = 3,
  AncPrivateVaultEnrollmentSasReceiptStatusCryptoFailed = 4,
};

@interface AncPrivateVaultEnrollmentSasReceipt : NSObject
@property(nonatomic, readonly) NSData *encodedReceipt;
@property(nonatomic, readonly) NSData *receiptHash;
@property(nonatomic, readonly) NSData *receiptId;
@property(nonatomic, readonly) NSData *vaultId;
@property(nonatomic, readonly) NSData *offerHash;
@property(nonatomic, readonly) NSData *challengeHash;
@property(nonatomic, readonly) NSData *sasTranscriptHash;
@property(nonatomic, readonly) NSData *candidateEndpointId;
@property(nonatomic, readonly) NSData *ceremonyId;
@property(nonatomic, readonly) uint64_t decidedAt;
@property(nonatomic, readonly) AncPrivateVaultEnrollmentSasDecision decision;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

FOUNDATION_EXPORT AncPrivateVaultEnrollmentSasReceipt
    *_Nullable AncPrivateVaultEnrollmentSasReceiptBuild(
        AncPrivateVaultEnrollmentChallengeResult *challenge, NSData *receiptId,
        uint64_t decidedAt, AncPrivateVaultEnrollmentSasDecision decision,
        const uint8_t *_Nonnull candidateSigningSeed,
        AncPrivateVaultEnrollmentSasReceiptStatus *_Nullable status);

FOUNDATION_EXPORT AncPrivateVaultEnrollmentSasReceipt
    *_Nullable AncPrivateVaultEnrollmentSasReceiptVerify(
        NSData *encodedReceipt,
        AncPrivateVaultEnrollmentChallengeResult *expectedChallenge,
        AncPrivateVaultEnrollmentSasReceiptStatus *_Nullable status);

NS_ASSUME_NONNULL_END
