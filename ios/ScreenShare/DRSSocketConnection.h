// Client socket for the broadcast extension. Connects to the unix-domain socket
// the main app binds inside the shared App Group container (rtc_SSFD) and exposes
// an NSOutputStream the SampleUploader writes framed frames to.
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface DRSSocketConnection : NSObject

@property(nonatomic, strong, readonly, nullable) NSOutputStream *outputStream;

- (instancetype)initWithFilePath:(NSString *)filePath;
- (BOOL)openWithStreamDelegate:(id<NSStreamDelegate>)streamDelegate;
- (void)close;

@end

NS_ASSUME_NONNULL_END
