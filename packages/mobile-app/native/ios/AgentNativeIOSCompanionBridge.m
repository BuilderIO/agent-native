#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <React/RCTViewManager.h>

@interface RCT_EXTERN_MODULE(AgentNativeIOSCompanion, RCTEventEmitter)

RCT_EXTERN_METHOD(startCaptureActivity:(NSString *)captureId
                  kind:(NSString *)kind
                  startedAtMs:(nonnull NSNumber *)startedAtMs
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(updateCaptureActivity:(NSString *)captureId
                  phase:(NSString *)phase
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(endCaptureActivity:(NSString *)captureId
                  phase:(NSString *)phase
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(endStaleCaptureActivities:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end

@interface RCT_EXTERN_MODULE(AgentNativeBroadcastPickerManager, RCTViewManager)
@end
