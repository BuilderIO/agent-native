#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/Security.h>

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSString *const AncPrivateVaultFenceService;
FOUNDATION_EXPORT NSString *const AncPrivateVaultHighWaterService;
FOUNDATION_EXPORT NSString *const AncPrivateVaultCustodyService;
FOUNDATION_EXPORT NSString *const AncPrivateVaultCustodyStageService;
FOUNDATION_EXPORT NSString *const AncPrivateVaultKeychainAccessGroup;

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
  OSStatus (*update)(CFDictionaryRef query,
                     CFDictionaryRef attributesToUpdate);
  OSStatus (*deleteItem)(CFDictionaryRef query);
} AncPrivateVaultSecItemFunctions;

typedef LAContext * _Nonnull (^AncPrivateVaultLAContextFactory)(void);

@interface AncPrivateVaultKeychain : NSObject

- (instancetype)init;
- (instancetype)initWithFunctions:(AncPrivateVaultSecItemFunctions)functions
                    contextFactory:(AncPrivateVaultLAContextFactory)factory
    NS_DESIGNATED_INITIALIZER;

- (AncPrivateVaultKeychainStatus)copyDataForService:(NSString *)service
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

// Every mutation performs an exact readback. Delete succeeds only after an
// absent readback; callers never infer durability from SecItem's status alone.
- (AncPrivateVaultKeychainStatus)deleteDataForService:(NSString *)service
                                               vaultId:(NSString *)vaultId
                                              recordId:(NSString *)recordId;

@end

NS_ASSUME_NONNULL_END
