#import "DRSSampleUploader.h"
#import "DRSSocketConnection.h"

#import <CoreImage/CoreImage.h>
#import <ReplayKit/ReplayKit.h>
#import <libkern/OSAtomic.h>
#import <stdatomic.h>

// Longest side of the encoded frame; keeps JPEG size and socket pressure sane.
static const CGFloat kMaxDimension = 1280.0;
static const float kJPEGCompression = 0.5f;

@interface DRSSampleUploader () <NSStreamDelegate>
@property(nonatomic, strong) DRSSocketConnection *connection;
@property(nonatomic, strong) NSData *dataToSend;
@property(nonatomic, assign) NSUInteger byteIndex;
@property(nonatomic, strong) dispatch_queue_t serialQueue;
@property(nonatomic, strong) CIContext *ciContext;
@end

@implementation DRSSampleUploader {
    atomic_bool _isSending;
}

- (instancetype)initWithConnection:(DRSSocketConnection *)connection {
    self = [super init];
    if (self) {
        _connection = connection;
        _serialQueue = dispatch_queue_create("com.drs.screenshare.uploader", DISPATCH_QUEUE_SERIAL);
        _ciContext = [CIContext contextWithOptions:nil];
        atomic_store(&_isSending, false);
        [self setupOutputStreamDelegate];
    }
    return self;
}

- (void)setupOutputStreamDelegate {
    self.connection.outputStream.delegate = self;
}

- (BOOL)sendSample:(CMSampleBufferRef)sampleBuffer {
    BOOL expected = false;
    if (!atomic_compare_exchange_strong(&_isSending, &expected, true)) {
        return NO; // a frame is still in flight
    }

    NSData *framed = [self framedDataForSampleBuffer:sampleBuffer];
    if (!framed) {
        atomic_store(&_isSending, false);
        return NO;
    }

    dispatch_async(self.serialQueue, ^{
        self.dataToSend = framed;
        self.byteIndex = 0;
        [self writeAvailable];
    });
    return YES;
}

- (NSData *)framedDataForSampleBuffer:(CMSampleBufferRef)sampleBuffer {
    CVImageBufferRef pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer);
    if (!pixelBuffer) {
        return nil;
    }

    CIImage *image = [CIImage imageWithCVPixelBuffer:pixelBuffer];
    CGFloat w = CVPixelBufferGetWidth(pixelBuffer);
    CGFloat h = CVPixelBufferGetHeight(pixelBuffer);
    CGFloat scale = 1.0;
    CGFloat longest = MAX(w, h);
    if (longest > kMaxDimension) {
        scale = kMaxDimension / longest;
        image = [image imageByApplyingTransform:CGAffineTransformMakeScale(scale, scale)];
    }
    NSUInteger outW = (NSUInteger)lround(w * scale);
    NSUInteger outH = (NSUInteger)lround(h * scale);

    CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
    NSData *jpeg = [self.ciContext JPEGRepresentationOfImage:image
                                                  colorSpace:colorSpace
                                                     options:@{(id)kCGImageDestinationLossyCompressionQuality: @(kJPEGCompression)}];
    CGColorSpaceRelease(colorSpace);
    if (!jpeg) {
        return nil;
    }

    // The display-orientation attachment is keyed by this string on the sample
    // buffer (CGImagePropertyOrientation). We read it by name to stay compatible
    // across SDKs that do not export the symbolic constant.
    int orientation = 0; // kCGImagePropertyOrientationUp maps to rotation 0
    CFTypeRef o = CMGetAttachment(sampleBuffer,
                                  (__bridge CFStringRef)@"RPVideoSampleBufferAttachmentKey_DisplayOrientation",
                                  NULL);
    if (o && CFGetTypeID(o) == CFNumberGetTypeID()) {
        orientation = ((__bridge NSNumber *)o).intValue;
    }

    CFHTTPMessageRef msg = CFHTTPMessageCreateResponse(kCFAllocatorDefault, 200, NULL, kCFHTTPVersion1_1);
    CFHTTPMessageSetHeaderFieldValue(msg, (__bridge CFStringRef)@"Content-Length",
                                     (__bridge CFStringRef)[NSString stringWithFormat:@"%lu", (unsigned long)jpeg.length]);
    CFHTTPMessageSetHeaderFieldValue(msg, (__bridge CFStringRef)@"Buffer-Width",
                                     (__bridge CFStringRef)[NSString stringWithFormat:@"%lu", (unsigned long)outW]);
    CFHTTPMessageSetHeaderFieldValue(msg, (__bridge CFStringRef)@"Buffer-Height",
                                     (__bridge CFStringRef)[NSString stringWithFormat:@"%lu", (unsigned long)outH]);
    CFHTTPMessageSetHeaderFieldValue(msg, (__bridge CFStringRef)@"Buffer-Orientation",
                                     (__bridge CFStringRef)[NSString stringWithFormat:@"%d", orientation]);
    CFHTTPMessageSetBody(msg, (__bridge CFDataRef)jpeg);

    NSData *serialized = (__bridge_transfer NSData *)CFHTTPMessageCopySerializedMessage(msg);
    CFRelease(msg);
    return serialized;
}

- (void)writeAvailable {
    NSOutputStream *stream = self.connection.outputStream;
    while (self.byteIndex < self.dataToSend.length && stream.hasSpaceAvailable) {
        NSInteger remaining = self.dataToSend.length - self.byteIndex;
        const uint8_t *bytes = (const uint8_t *)self.dataToSend.bytes + self.byteIndex;
        NSInteger written = [stream write:bytes maxLength:remaining];
        if (written <= 0) {
            break;
        }
        self.byteIndex += written;
    }
    if (self.byteIndex >= self.dataToSend.length) {
        self.dataToSend = nil;
        self.byteIndex = 0;
        atomic_store(&_isSending, false);
    }
}

// MARK: NSStreamDelegate (output stream has space)

- (void)stream:(NSStream *)aStream handleEvent:(NSStreamEvent)eventCode {
    if (eventCode == NSStreamEventHasSpaceAvailable) {
        dispatch_async(self.serialQueue, ^{
            if (self.dataToSend) {
                [self writeAvailable];
            }
        });
    }
}

@end
