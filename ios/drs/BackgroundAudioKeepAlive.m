#import <React/RCTBridgeModule.h>

// Exposes the Swift BackgroundAudioKeepAlive class to the JS bridge — a
// Swift-only RCTBridgeModule still needs this tiny Objective-C file so the
// bridge's runtime module lookup can find it.
@interface RCT_EXTERN_MODULE(BackgroundAudioKeepAlive, NSObject)

RCT_EXTERN_METHOD(start:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stop:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
