// Encodes ReplayKit CMSampleBuffers and streams them to the main app over the
// shared socket, in the exact framed format RCTWebRTC/ScreenCapturer.m parses
// (a CFHTTPMessage response with Buffer-Width/Height/Orientation + a JPEG body).
#import <Foundation/Foundation.h>
#import <CoreMedia/CoreMedia.h>

@class DRSSocketConnection;

NS_ASSUME_NONNULL_BEGIN

@interface DRSSampleUploader : NSObject

- (instancetype)initWithConnection:(DRSSocketConnection *)connection;
/// Returns NO if a previous frame is still being written (this frame is dropped).
- (BOOL)sendSample:(CMSampleBufferRef)sampleBuffer;

@end

NS_ASSUME_NONNULL_END
