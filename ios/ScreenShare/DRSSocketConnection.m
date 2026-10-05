#import "DRSSocketConnection.h"

#import <sys/socket.h>
#import <sys/un.h>

@interface DRSSocketConnection ()
@property(nonatomic, assign) int socketHandle;
@property(nonatomic, copy) NSString *filePath;
@property(nonatomic, strong, nullable) NSInputStream *inputStream;
@property(nonatomic, strong, nullable, readwrite) NSOutputStream *outputStream;
@property(nonatomic, weak, nullable) id<NSStreamDelegate> streamDelegate;
@end

@implementation DRSSocketConnection

- (instancetype)initWithFilePath:(NSString *)filePath {
    self = [super init];
    if (self) {
        _filePath = [filePath copy];
        _socketHandle = socket(AF_UNIX, SOCK_STREAM, 0);
    }
    return self;
}

- (BOOL)openWithStreamDelegate:(id<NSStreamDelegate>)streamDelegate {
    if (self.socketHandle < 0) {
        NSLog(@"[DRSSocketConnection] invalid socket handle");
        return NO;
    }
    if (![self connectSocket]) {
        return NO;
    }
    self.streamDelegate = streamDelegate;
    [self setupStreams];
    [self.inputStream open];
    [self.outputStream open];
    return YES;
}

- (void)close {
    [self.inputStream close];
    [self.outputStream close];
    self.inputStream = nil;
    self.outputStream = nil;
    if (self.socketHandle >= 0) {
        close(self.socketHandle);
        self.socketHandle = -1;
    }
}

- (BOOL)connectSocket {
    struct sockaddr_un addr;
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    if (self.filePath.length > sizeof(addr.sun_path)) {
        NSLog(@"[DRSSocketConnection] socket path too long");
        return NO;
    }
    strncpy(addr.sun_path, self.filePath.UTF8String, sizeof(addr.sun_path) - 1);

    int status = connect(self.socketHandle, (struct sockaddr *)&addr, sizeof(addr));
    if (status < 0) {
        NSLog(@"[DRSSocketConnection] connect failure: %d", errno);
        return NO;
    }
    return YES;
}

- (void)setupStreams {
    CFReadStreamRef readStream;
    CFWriteStreamRef writeStream;
    CFStreamCreatePairWithSocket(kCFAllocatorDefault, self.socketHandle, &readStream, &writeStream);

    self.inputStream = (__bridge_transfer NSInputStream *)readStream;
    self.inputStream.delegate = self.streamDelegate;
    [self.inputStream setProperty:(__bridge id)kCFBooleanTrue
                           forKey:(__bridge NSString *)kCFStreamPropertyShouldCloseNativeSocket];
    [self.inputStream scheduleInRunLoop:[NSRunLoop mainRunLoop] forMode:NSDefaultRunLoopMode];

    self.outputStream = (__bridge_transfer NSOutputStream *)writeStream;
    self.outputStream.delegate = self.streamDelegate;
    [self.outputStream setProperty:(__bridge id)kCFBooleanTrue
                            forKey:(__bridge NSString *)kCFStreamPropertyShouldCloseNativeSocket];
    [self.outputStream scheduleInRunLoop:[NSRunLoop mainRunLoop] forMode:NSDefaultRunLoopMode];
}

@end
