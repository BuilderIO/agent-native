#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/Security.h>


NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSString *const AncPrivateVaultFenceService;
FOUNDATION_EXPORT NSString *const AncPrivateVaultHighWaterService;
FOUNDATION_EXPORT NSString *const AncPrivateVaultCustodyService;
FOUNDATION_EXPORT NSString *const AncPrivateVaultCustodyStageService;
FOUNDATION_EXPORT NSString *const AncPrivateVaultRotationPreparationService;
FOUNDATION_EXPORT NSString *const
    AncPrivateVaultRotationPreparationStageService;
FOUNDATION_EXPORT NSString *const AncPrivateVaultGenesisPreparationService;
FOUNDATION_EXPORT NSString *const
    AncPrivateVaultGenesisPreparationStageService;
FOUNDATION_EXPORT NSString *const AncPrivateVaultRotationCleanupReceiptService;
FOUNDATION_EXPORT NSString *const AncPrivateVaultTrustedTimeService;
FOUNDATION_EXPORT NSString *const AncPrivateVaultTrustedTimeHighWaterService;
FOUNDATION_EXPORT NSString *const AncPrivateVaultKeychainAccessGroup;
FOUNDATION_EXPORT NSString *const AncPrivateVaultKeychainStorageDomain;

typedef NS_ENUM(NSInteger, AncPrivateVaultKeychainStatus) {
  AncPrivateVaultKeychainStatusOK = 0,
  AncPrivateVaultKeychainStatusNotFound = 1,
  AncPrivateVaultKeychainStatusDuplicate = 2,
  AncPrivateVaultKeychainStatusCorrupt = 3,
  AncPrivateVaultKeychainStatusInaccessible = 4,
  AncPrivateVaultKeychainStatusInvalid = 5,
  AncPrivateVaultKeychainStatusFailed = 6,
};

typedef struct AncPrivateVaultSecItemFunctions {
  OSStatus (*copyMatching)(CFDictionaryRef query,
                           CFTypeRef _Nullable *_Nullable result);
  OSStatus (*add)(CFDictionaryRef attributes,
                  CFTypeRef _Nullable *_Nullable result);
  OSStatus (*update)(CFDictionaryRef query, CFDictionaryRef attributesToUpdate);
  OSStatus (*deleteItem)(CFDictionaryRef query);
} AncPrivateVaultSecItemFunctions;

typedef LAContext *_Nonnull (^AncPrivateVaultLAContextFactory)(void);
typedef BOOL (^AncPrivateVaultKeychainBytesConsumer)(const uint8_t *bytes,
                                                     size_t length);
typedef BOOL (^AncPrivateVaultKeychainCustodyRecordConsumer)(
    const uint8_t *record);
typedef BOOL (^AncPrivateVaultKeychainGenesisPreparationRecordConsumer)(
    const uint8_t *record);

#if ANC_PRIVATE_VAULT_TESTING
typedef void (^AncPrivateVaultKeychainBoundaryTestHook)(BOOL opened,
                                                        BOOL writeBoundary);
FOUNDATION_EXPORT void AncPrivateVaultKeychainSetBoundaryHookForTesting(
    AncPrivateVaultKeychainBoundaryTestHook _Nullable hook);
#endif

@interface AncPrivateVaultKeychain : NSObject

/*
 * Stable identity for one logical secure-storage trust domain. Independent
 * wrappers over the production access group share the default value; injected
 * test/back-end adapters must supply a distinct value unless they intentionally
 * model the same store.
 */
@property(nonatomic, copy, readonly) NSString *storageDomain;

- (instancetype)init;
- (instancetype)initWithFunctions:(AncPrivateVaultSecItemFunctions)functions
                   contextFactory:(AncPrivateVaultLAContextFactory)factory;
- (instancetype)initWithFunctions:(AncPrivateVaultSecItemFunctions)functions
                   contextFactory:(AncPrivateVaultLAContextFactory)factory
                    storageDomain:(NSString *)storageDomain
    NS_DESIGNATED_INITIALIZER;

- (AncPrivateVaultKeychainStatus)
    copyDataForService:(NSString *)service
               vaultId:(NSString *)vaultId
              recordId:(NSString *)recordId
                  data:(NSData *_Nullable *_Nullable)data;
- (AncPrivateVaultKeychainStatus)addData:(NSData *)data
                              forService:(NSString *)service
                                 vaultId:(NSString *)vaultId
                                recordId:(NSString *)recordId;
- (AncPrivateVaultKeychainStatus)updateData:(NSData *)data
                                 forService:(NSString *)service
                                    vaultId:(NSString *)vaultId
                                   recordId:(NSString *)recordId;

/* Secret-bearing callers use these APIs so the sole pageable object is the
 * tightly scoped CFData supplied by Security.framework. Reads are consumed
 * synchronously and writes wrap the caller's guarded bytes without copying. */
- (AncPrivateVaultKeychainStatus)
    consumeBytesForService:(NSString *)service
                   vaultId:(NSString *)vaultId
                  recordId:(NSString *)recordId
                  consumer:(AncPrivateVaultKeychainBytesConsumer)consumer;
- (AncPrivateVaultKeychainStatus)addBytes:(const uint8_t *)bytes
                                   length:(size_t)length
                               forService:(NSString *)service
                                  vaultId:(NSString *)vaultId
                                 recordId:(NSString *)recordId;
- (AncPrivateVaultKeychainStatus)updateBytes:(const uint8_t *)bytes
                                      length:(size_t)length
                                  forService:(NSString *)service
                                     vaultId:(NSString *)vaultId
                                    recordId:(NSString *)recordId;

/* Exact secret-bearing custody boundary. These methods accept only the live
 * and stage custody services and always consume/write exactly 1088 bytes. */
- (AncPrivateVaultKeychainStatus)
    consumeCustodyRecordForService:(NSString *)service
                           vaultId:(NSString *)vaultId
                          recordId:(NSString *)recordId
                          consumer:
                              (AncPrivateVaultKeychainCustodyRecordConsumer)
                                  consumer;
- (AncPrivateVaultKeychainStatus)addCustodyRecord:(const uint8_t *)record
                                           length:(size_t)length
                                       forService:(NSString *)service
             vaultId:(NSString *)vaultId
            recordId:(NSString *)recordId;
- (AncPrivateVaultKeychainStatus)updateCustodyRecord:(const uint8_t *)record
                                              length:(size_t)length
                                          forService:(NSString *)service
                vaultId:(NSString *)vaultId
               recordId:(NSString *)recordId;

- (AncPrivateVaultKeychainStatus)
    consumeGenesisPreparationRecordForService:(NSString *)service
                                      vaultId:(NSString *)vaultId
                                     recordId:(NSString *)recordId
                                     consumer:(AncPrivateVaultKeychainGenesisPreparationRecordConsumer)consumer;
- (AncPrivateVaultKeychainStatus)addGenesisPreparationRecord:(const uint8_t *)record
                                                      length:(size_t)length
                                                  forService:(NSString *)service
                                                     vaultId:(NSString *)vaultId
                                                    recordId:(NSString *)recordId;
- (AncPrivateVaultKeychainStatus)updateGenesisPreparationRecord:(const uint8_t *)record
                                                         length:(size_t)length
                                                     forService:(NSString *)service
                                                        vaultId:(NSString *)vaultId
                                                       recordId:(NSString *)recordId;
- (AncPrivateVaultKeychainStatus)
    deleteGenesisPreparationStageVaultId:(NSString *)vaultId
                                recordId:(NSString *)recordId;
- (AncPrivateVaultKeychainStatus)
    deleteCustodyRecordForService:(NSString *)service
                           vaultId:(NSString *)vaultId
                          recordId:(NSString *)recordId;

// Every mutation performs an exact readback. Delete succeeds only after an
// absent readback; callers never infer durability from SecItem's status alone.
- (AncPrivateVaultKeychainStatus)deleteDataForService:(NSString *)service
                                              vaultId:(NSString *)vaultId
                                             recordId:(NSString *)recordId;

@end

NS_ASSUME_NONNULL_END
