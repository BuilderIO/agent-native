#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, AncPrivateVaultHostedAppendTransportStatus) {
  AncPrivateVaultHostedAppendTransportStatusOK = 0,
  AncPrivateVaultHostedAppendTransportStatusInvalid = 1,
  AncPrivateVaultHostedAppendTransportStatusNetworkFailed = 2,
  AncPrivateVaultHostedAppendTransportStatusHTTPError = 3,
  AncPrivateVaultHostedAppendTransportStatusResponseTooLarge = 4,
};

typedef void (^AncPrivateVaultHostedAppendCompletion)(
    AncPrivateVaultHostedAppendTransportStatus status,
    NSData *_Nullable receipt);

@interface AncPrivateVaultHostedAppendTransport : NSObject
- (instancetype)init;
- (void)appendBody:(NSData *)body
       proofHeader:(NSString *)proofHeader
        completion:(AncPrivateVaultHostedAppendCompletion)completion;
#if ANC_PRIVATE_VAULT_TESTING
- (nullable instancetype)initWithOrigin:(NSURL *)origin
                          configuration:
                              (NSURLSessionConfiguration *)configuration;
#endif
@end

NS_ASSUME_NONNULL_END
