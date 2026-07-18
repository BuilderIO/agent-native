#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

enum {
  ANC_PV_GENESIS_ADMISSION_CANDIDATE_MAX_BYTES = 1315072,
  ANC_PV_GENESIS_ADMISSION_CHALLENGE_MAX_BYTES = 2048,
  ANC_PV_GENESIS_ADMISSION_REQUEST_MAX_BYTES = 1317376,
  ANC_PV_GENESIS_ADMISSION_RECEIPT_MAX_BYTES = 2048,
};

typedef NS_ENUM(NSInteger, AncPrivateVaultGenesisAdmissionStatus) {
  AncPrivateVaultGenesisAdmissionStatusOK = 0,
  AncPrivateVaultGenesisAdmissionStatusInvalid = 1,
  AncPrivateVaultGenesisAdmissionStatusTooLarge = 2,
  AncPrivateVaultGenesisAdmissionStatusExpired = 3,
  AncPrivateVaultGenesisAdmissionStatusBindingMismatch = 4,
  AncPrivateVaultGenesisAdmissionStatusCryptoFailed = 5,
};

@interface AncPrivateVaultGenesisAdmissionChallenge : NSObject
@property(nonatomic, readonly) NSString *challengeId;
@property(nonatomic, readonly) NSString *accountId;
@property(nonatomic, readonly) NSString *workspaceId;
@property(nonatomic, readonly) NSData *candidateHash;
@property(nonatomic, readonly) NSString *issuedAt;
@property(nonatomic, readonly) NSString *expiresAt;
@property(nonatomic, readonly) NSData *authenticationTag;
@end

@interface AncPrivateVaultGenesisAdmissionReceipt : NSObject
@property(nonatomic, readonly) NSString *accountId;
@property(nonatomic, readonly) NSString *workspaceId;
@property(nonatomic, readonly) NSString *vaultId;
@property(nonatomic, readonly) NSString *controlEntryId;
@property(nonatomic, readonly) NSData *controlEntryHash;
@property(nonatomic, readonly) NSString *signerEndpointId;
@property(nonatomic, readonly) NSData *candidateHash;
@property(nonatomic, readonly) NSData *bootstrapTranscriptHash;
@end

FOUNDATION_EXPORT NSData
    *_Nullable AncPrivateVaultGenesisAdmissionCandidateEncode(
        NSData *bootstrapTranscript, NSData *recoveryConfirmation,
        NSData *authorization,
        AncPrivateVaultGenesisAdmissionStatus *_Nullable status);

/** Strictly splits the immutable account-admission candidate retained as
 * bootstrap control evidence. Returned components are owning copies. */
FOUNDATION_EXPORT BOOL AncPrivateVaultGenesisAdmissionCandidateDecode(
    NSData *candidate, NSData *_Nullable *_Nonnull bootstrapTranscript,
    NSData *_Nullable *_Nonnull recoveryConfirmation,
    NSData *_Nullable *_Nonnull authorization,
    AncPrivateVaultGenesisAdmissionStatus *_Nullable status);

/* The server-only HMAC tag remains opaque locally and is reverified by the
 * server on admission. Native verification binds every visible coordinate,
 * candidate hash, canonical byte, and validity window before signing. */
FOUNDATION_EXPORT AncPrivateVaultGenesisAdmissionChallenge
    *_Nullable AncPrivateVaultGenesisAdmissionChallengeDecode(
        NSData *challenge, NSData *expectedCandidate, uint64_t nowMilliseconds,
        AncPrivateVaultGenesisAdmissionStatus *_Nullable status);

FOUNDATION_EXPORT NSData
    *_Nullable AncPrivateVaultGenesisAdmissionRequestEncode(
        NSData *candidate, NSData *challenge,
        AncPrivateVaultGenesisAdmissionStatus *_Nullable status);

FOUNDATION_EXPORT AncPrivateVaultGenesisAdmissionReceipt
    *_Nullable AncPrivateVaultGenesisAdmissionReceiptDecode(
        NSData *receipt, AncPrivateVaultGenesisAdmissionChallenge *challenge,
        NSData *expectedCandidate, NSString *expectedVaultId,
        NSString *expectedControlEntryId, NSData *expectedControlEntryHash,
        NSString *expectedSignerEndpointId,
        NSData *expectedBootstrapTranscriptHash,
        AncPrivateVaultGenesisAdmissionStatus *_Nullable status);

NS_ASSUME_NONNULL_END
