#import <Foundation/Foundation.h>

#include <assert.h>

#import "PrivateVaultEndpointRequest.h"
#import "PrivateVaultHostedAppendTransport.h"

typedef void (^HostedProtocolHandler)(NSURLProtocol *protocol,
                                      NSURLRequest *request);

@interface HostedURLProtocol : NSURLProtocol
@property(class, nonatomic, copy) HostedProtocolHandler handler;
@end

static HostedProtocolHandler gHostedHandler;

@implementation HostedURLProtocol
+ (HostedProtocolHandler)handler {
  return gHostedHandler;
}
+ (void)setHandler:(HostedProtocolHandler)handler {
  gHostedHandler = [handler copy];
}
+ (BOOL)canInitWithRequest:(NSURLRequest *)request {
  (void)request;
  return YES;
}
+ (NSURLRequest *)canonicalRequestForRequest:(NSURLRequest *)request {
  return request;
}
- (void)startLoading {
  HostedURLProtocol.handler(self, self.request);
}
- (void)stopLoading {
}
@end

static AncPrivateVaultHostedAppendTransport *
TransportWithConfiguration(NSURLSessionConfiguration *configuration) {
  configuration.protocolClasses = @[ HostedURLProtocol.class ];
  return [[AncPrivateVaultHostedAppendTransport alloc]
      initWithOrigin:[NSURL URLWithString:@"https://content-e2ee-lab.bwrb.dev"]
       configuration:configuration];
}

static AncPrivateVaultHostedAppendTransport *Transport(void) {
  return TransportWithConfiguration(
      NSURLSessionConfiguration.ephemeralSessionConfiguration);
}

static AncPrivateVaultHostedAppendTransportStatus
RunWithTransport(AncPrivateVaultHostedAppendTransport *transport, NSData *body,
                 NSString *proof, NSData **receipt) {
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  __block AncPrivateVaultHostedAppendTransportStatus observed =
      AncPrivateVaultHostedAppendTransportStatusInvalid;
  __block NSData *bytes = nil;
  [transport appendBody:body
            proofHeader:proof
             completion:^(AncPrivateVaultHostedAppendTransportStatus status,
                          NSData *value) {
               observed = status;
               bytes = [value copy];
               dispatch_semaphore_signal(done);
             }];
  assert(dispatch_semaphore_wait(
             done, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) == 0);
  if (receipt != NULL)
    *receipt = bytes;
  return observed;
}

static AncPrivateVaultHostedAppendTransportStatus
Run(NSData *body, NSString *proof, NSData **receipt) {
  return RunWithTransport(Transport(), body, proof, receipt);
}

static NSHTTPURLResponse *ResponseForURL(NSURL *url, NSInteger status,
                                         NSDictionary *headers) {
  return [[NSHTTPURLResponse alloc] initWithURL:url
                                     statusCode:status
                                    HTTPVersion:@"HTTP/1.1"
                                   headerFields:headers];
}

static NSHTTPURLResponse *Response(NSURLRequest *request, NSInteger status,
                                   NSDictionary *headers) {
  return ResponseForURL(request.URL, status, headers);
}

static NSData *RequestBody(NSURLRequest *request) {
  if (request.HTTPBody != nil)
    return request.HTTPBody;
  NSInputStream *stream = request.HTTPBodyStream;
  if (stream == nil)
    return nil;
  [stream open];
  NSMutableData *body = [NSMutableData data];
  uint8_t buffer[256];
  NSInteger count = 0;
  while ((count = [stream read:buffer maxLength:sizeof buffer]) > 0)
    [body appendBytes:buffer length:(NSUInteger)count];
  [stream close];
  return count < 0 ? nil : body;
}

int main(void) {
  @autoreleasepool {
    NSData *body = [@"opaque-body" dataUsingEncoding:NSUTF8StringEncoding];
    NSString *proof = @"canonical-proof";
    HostedURLProtocol.handler = ^(NSURLProtocol *protocol,
                                  NSURLRequest *request) {
      assert([request.URL.absoluteString
          isEqualToString:@"https://content-e2ee-lab.bwrb.dev/api/"
                          @"private-vault/control-log/append"]);
      assert([request.HTTPMethod isEqualToString:@"POST"] &&
             !request.HTTPShouldHandleCookies &&
             [RequestBody(request) isEqualToData:body]);
      assert([[request valueForHTTPHeaderField:@"Content-Type"]
                 isEqualToString:AncPrivateVaultControlLogAppendContentType] &&
             [[request valueForHTTPHeaderField:@"X-ANC-Endpoint-Request-Proof"]
                 isEqualToString:proof]);
      [protocol.client URLProtocol:protocol
                didReceiveResponse:Response(request, 200, @{
                  @"Content-Type" : AncPrivateVaultControlLogAppendContentType,
                  @"Content-Length" : @"3",
                })
                cacheStoragePolicy:NSURLCacheStorageNotAllowed];
      [protocol.client URLProtocol:protocol
                       didLoadData:[NSData dataWithBytes:"a" length:1]];
      [protocol.client URLProtocol:protocol
                       didLoadData:[NSData dataWithBytes:"bc" length:2]];
      [protocol.client URLProtocolDidFinishLoading:protocol];
    };
    NSData *receipt = nil;
    assert(Run(body, proof, &receipt) ==
               AncPrivateVaultHostedAppendTransportStatusOK &&
           [receipt
               isEqualToData:[@"abc" dataUsingEncoding:NSUTF8StringEncoding]]);

    HostedURLProtocol.handler = ^(NSURLProtocol *protocol,
                                  NSURLRequest *request) {
      [protocol.client URLProtocol:protocol
                didReceiveResponse:Response(request, 200, @{
                  @"Content-Type" : AncPrivateVaultControlLogAppendContentType,
                  @"Content-Length" : @"1",
                })
                cacheStoragePolicy:NSURLCacheStorageNotAllowed];
      [protocol.client URLProtocol:protocol
                       didLoadData:[NSData dataWithBytes:"ab" length:2]];
      [protocol.client URLProtocolDidFinishLoading:protocol];
    };
    assert(Run(body, proof, nil) ==
           AncPrivateVaultHostedAppendTransportStatusResponseTooLarge);

    HostedURLProtocol.handler = ^(NSURLProtocol *protocol,
                                  NSURLRequest *request) {
      (void)request;
      [protocol.client
                 URLProtocol:protocol
          didReceiveResponse:Response(request, 409, @{@"Content-Length" : @"0"})
          cacheStoragePolicy:NSURLCacheStorageNotAllowed];
      [protocol.client URLProtocolDidFinishLoading:protocol];
    };
    assert(Run(body, proof, nil) ==
           AncPrivateVaultHostedAppendTransportStatusHTTPError);

    HostedURLProtocol.handler = ^(NSURLProtocol *protocol,
                                  NSURLRequest *request) {
      (void)request;
      [protocol.client
                 URLProtocol:protocol
          didReceiveResponse:
              ResponseForURL(
                  [NSURL URLWithString:@"https://other.test/receipt"], 200, @{
                    @"Content-Type" :
                        AncPrivateVaultControlLogAppendContentType,
                    @"Content-Length" : @"1",
                  })
          cacheStoragePolicy:NSURLCacheStorageNotAllowed];
      [protocol.client URLProtocolDidFinishLoading:protocol];
    };
    assert(Run(body, proof, nil) ==
           AncPrivateVaultHostedAppendTransportStatusInvalid);

    HostedURLProtocol.handler =
        ^(NSURLProtocol *protocol, NSURLRequest *request) {
          [protocol.client URLProtocol:protocol
                    didReceiveResponse:Response(request, 200, @{
                      @"Content-Type" : @"application/json",
                      @"Content-Length" : @"1",
                    })
                    cacheStoragePolicy:NSURLCacheStorageNotAllowed];
          [protocol.client URLProtocolDidFinishLoading:protocol];
        };
    assert(Run(body, proof, nil) ==
           AncPrivateVaultHostedAppendTransportStatusInvalid);

    for (NSString *invalidLength in @[ @"", @"0", @"01", @"1025", @"x" ]) {
      HostedURLProtocol.handler =
          ^(NSURLProtocol *protocol, NSURLRequest *request) {
            [protocol.client
                       URLProtocol:protocol
                didReceiveResponse:Response(request, 200, @{
                  @"Content-Type" : AncPrivateVaultControlLogAppendContentType,
                  @"Content-Length" : invalidLength,
                })
                cacheStoragePolicy:NSURLCacheStorageNotAllowed];
            [protocol.client URLProtocolDidFinishLoading:protocol];
          };
      assert(Run(body, proof, nil) ==
             AncPrivateVaultHostedAppendTransportStatusResponseTooLarge);
    }

    HostedURLProtocol.handler = ^(NSURLProtocol *protocol,
                                  NSURLRequest *request) {
      [protocol.client URLProtocol:protocol
                didReceiveResponse:Response(request, 200, @{
                  @"Content-Type" : AncPrivateVaultControlLogAppendContentType,
                  @"Content-Length" : @"3",
                })
                cacheStoragePolicy:NSURLCacheStorageNotAllowed];
      [protocol.client URLProtocol:protocol
                       didLoadData:[NSData dataWithBytes:"ab" length:2]];
      [protocol.client URLProtocolDidFinishLoading:protocol];
    };
    assert(Run(body, proof, nil) ==
           AncPrivateVaultHostedAppendTransportStatusNetworkFailed);

    NSHTTPCookieStorage *cookieStorage =
        NSHTTPCookieStorage.sharedHTTPCookieStorage;
    NSHTTPCookie *ambientCookie = [NSHTTPCookie cookieWithProperties:@{
      NSHTTPCookieName : @"session",
      NSHTTPCookieValue : @"must-not-leak",
      NSHTTPCookieDomain : @"content-e2ee-lab.bwrb.dev",
      NSHTTPCookiePath : @"/",
    }];
    [cookieStorage setCookie:ambientCookie];
    NSURLSessionConfiguration *credentialed =
        NSURLSessionConfiguration.ephemeralSessionConfiguration;
    credentialed.HTTPCookieStorage = cookieStorage;
    credentialed.HTTPShouldSetCookies = YES;
    credentialed.URLCredentialStorage =
        NSURLCredentialStorage.sharedCredentialStorage;
    HostedURLProtocol.handler = ^(NSURLProtocol *protocol,
                                  NSURLRequest *request) {
      assert([request valueForHTTPHeaderField:@"Cookie"] == nil &&
             [request valueForHTTPHeaderField:@"Authorization"] == nil);
      [protocol.client URLProtocol:protocol
                didReceiveResponse:Response(request, 200, @{
                  @"Content-Type" : AncPrivateVaultControlLogAppendContentType,
                  @"Content-Length" : @"1",
                })
                cacheStoragePolicy:NSURLCacheStorageNotAllowed];
      [protocol.client URLProtocol:protocol
                       didLoadData:[NSData dataWithBytes:"a" length:1]];
      [protocol.client URLProtocolDidFinishLoading:protocol];
    };
    assert(RunWithTransport(TransportWithConfiguration(credentialed), body,
                            proof, nil) ==
           AncPrivateVaultHostedAppendTransportStatusOK);
    [cookieStorage deleteCookie:ambientCookie];

    assert([[AncPrivateVaultHostedAppendTransport alloc]
               initWithOrigin:[NSURL URLWithString:@"http://example.test"]
                configuration:NSURLSessionConfiguration
                                  .ephemeralSessionConfiguration] == nil);
    assert(
        [[AncPrivateVaultHostedAppendTransport alloc]
            initWithOrigin:[NSURL URLWithString:@"https://example.test/tenant"]
             configuration:NSURLSessionConfiguration
                               .ephemeralSessionConfiguration] == nil);
    puts("hosted append transport tests passed");
  }
  return 0;
}
