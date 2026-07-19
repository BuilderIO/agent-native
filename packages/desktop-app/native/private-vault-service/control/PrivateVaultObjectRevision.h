#import <Foundation/Foundation.h>

#import "PrivateVaultControlLog.h"
#import "PrivateVaultGuardedMemory.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultObjectRevisionStatus) {
  AncPrivateVaultObjectRevisionStatusOK = 0,
  AncPrivateVaultObjectRevisionStatusInvalid = 1,
  AncPrivateVaultObjectRevisionStatusBinding = 2,
  AncPrivateVaultObjectRevisionStatusSignature = 3,
  AncPrivateVaultObjectRevisionStatusCrypto = 4,
  AncPrivateVaultObjectRevisionStatusEncoding = 5,
  AncPrivateVaultObjectRevisionStatusCleanup = 6,
};

@interface AncPrivateVaultSealedObjectRevision : NSObject
@property(nonatomic, readonly) NSData *encodedRevision;
@property(nonatomic, readonly) NSData *revisionId;
@property(nonatomic, readonly) NSData *objectId;
@property(nonatomic, readonly) uint64_t revision;
@property(nonatomic, readonly) uint64_t epoch;
@property(nonatomic, readonly) NSString *contentType;
@property(nonatomic, readonly) uint64_t plaintextLength;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

@interface AncPrivateVaultInspectedObjectRevision : NSObject
@property(nonatomic, readonly) NSData *objectId;
@property(nonatomic, readonly) uint64_t revision;
@property(nonatomic, readonly) uint64_t epoch;
@property(nonatomic, readonly) NSString *contentType;
@property(nonatomic, readonly) NSData *writerEndpointId;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

@interface AncPrivateVaultOpenedObjectRevision : NSObject
@property(nonatomic, readonly) NSData *plaintext;
@property(nonatomic, readonly) NSData *revisionId;
@property(nonatomic, readonly) NSData *objectId;
@property(nonatomic, readonly) uint64_t revision;
@property(nonatomic, readonly) uint64_t epoch;
@property(nonatomic, readonly) NSString *contentType;
@property(nonatomic, readonly) NSData *writerEndpointId;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end

/* One bounded chunk is deliberate for the first Content beta. It keeps every
 * title/body byte inside the authenticated ciphertext while preserving the
 * frozen anc/v1 DEK-wrap, object-header, and secretstream chunk envelopes. */
FOUNDATION_EXPORT AncPrivateVaultSealedObjectRevision *_Nullable
AncPrivateVaultSealObjectRevision(
    NSData *vaultId, NSData *objectId, NSData *writerEndpointId,
    uint64_t revision, uint64_t epoch,
    NSString *contentType, NSData *plaintext, uint64_t createdAt,
    NSData *dekEnvelopeId, NSData *headerEnvelopeId, NSData *chunkEnvelopeId,
    NSData *dekNonce, AncPrivateVaultControlLogState *authenticatedState,
    AncPrivateVaultGuardedMemory *writerSigningSeed,
    AncPrivateVaultGuardedMemory *epochKey,
    AncPrivateVaultObjectRevisionStatus *_Nullable status);

/* Writer identity is resolved only from authenticated control state. The host
 * supplies opaque bytes, never a public key or endpoint claim. */
FOUNDATION_EXPORT AncPrivateVaultOpenedObjectRevision *_Nullable
AncPrivateVaultOpenObjectRevision(
    NSData *encodedRevision, NSData *expectedVaultId,
    NSData *_Nullable expectedObjectId,
    AncPrivateVaultControlLogState *authenticatedState,
    AncPrivateVaultGuardedMemory *epochKey,
    AncPrivateVaultObjectRevisionStatus *_Nullable status);

/* Authenticates the signed object header and its bundle bindings without
 * unwrapping a DEK or decrypting document plaintext. */
FOUNDATION_EXPORT AncPrivateVaultInspectedObjectRevision *_Nullable
AncPrivateVaultInspectObjectRevision(
    NSData *encodedRevision, NSData *expectedVaultId,
    NSData *_Nullable expectedObjectId,
    AncPrivateVaultControlLogState *authenticatedState,
    AncPrivateVaultObjectRevisionStatus *_Nullable status);

FOUNDATION_EXPORT NSString *AncPrivateVaultObjectRevisionCategory(
    AncPrivateVaultObjectRevisionStatus status);

NS_ASSUME_NONNULL_END
