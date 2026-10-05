#import "SampleHandler.h"
#import "DRSSocketConnection.h"
#import "DRSSampleUploader.h"

// Matches kRTCScreensharingSocketFD / kRTCAppGroupIdentifier in RCTWebRTC.
static NSString *const kSocketFileName = @"rtc_SSFD";
static NSString *const kAppGroupInfoKey = @"RTCAppGroupIdentifier";

@interface SampleHandler ()
@property(nonatomic, strong) DRSSocketConnection *connection;
@property(nonatomic, strong) DRSSampleUploader *uploader;
@end

@implementation SampleHandler

- (void)broadcastStartedWithSetupInfo:(NSDictionary<NSString *, NSObject *> *)setupInfo {
    NSString *appGroup = [[NSBundle mainBundle] objectForInfoDictionaryKey:kAppGroupInfoKey];
    if (appGroup.length == 0) {
        [self finishWithError:@"Missing RTCAppGroupIdentifier in the extension Info.plist"];
        return;
    }
    NSURL *container =
        [[NSFileManager defaultManager] containerURLForSecurityApplicationGroupIdentifier:appGroup];
    if (!container) {
        [self finishWithError:@"App Group container unavailable"];
        return;
    }
    NSString *socketPath = [[container URLByAppendingPathComponent:kSocketFileName] path];

    self.connection = [[DRSSocketConnection alloc] initWithFilePath:socketPath];
    self.uploader = [[DRSSampleUploader alloc] initWithConnection:self.connection];
    if (![self.connection openWithStreamDelegate:self.uploader]) {
        [self finishWithError:@"The Desktop Remote app is not ready to receive the screen. Start the session in the app first."];
        return;
    }
}

- (void)broadcastPaused {}
- (void)broadcastResumed {}

- (void)broadcastFinished {
    [self.connection close];
    self.connection = nil;
    self.uploader = nil;
}

- (void)processSampleBuffer:(CMSampleBufferRef)sampleBuffer withType:(RPSampleBufferType)sampleBufferType {
    if (sampleBufferType == RPSampleBufferTypeVideo) {
        [self.uploader sendSample:sampleBuffer];
    }
    // Audio sample types are ignored; the screen session is video-only.
}

- (void)finishWithError:(NSString *)message {
    NSError *error = [NSError errorWithDomain:@"com.drs.screenshare"
                                         code:-1
                                     userInfo:@{NSLocalizedDescriptionKey: message}];
    [self finishBroadcastWithError:error];
}

@end
