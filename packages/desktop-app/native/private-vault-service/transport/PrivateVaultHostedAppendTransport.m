#import "PrivateVaultHostedAppendTransport.h"

#import "PrivateVaultEndpointRequest.h"
#import "PrivateVaultHostedOrigin.h"

static const NSUInteger kReceiptMaximumBytes = 1024;

static BOOL AncHostedAppendExactOrigin(NSURL *url) {
  return url != nil && [url.scheme.lowercaseString isEqualToString:@"https"] &&
         url.host.length > 0 && url.user.length == 0 &&
         url.password.length == 0 && url.port == nil &&
         (url.path.length == 0 || [url.path isEqualToString:@"/"]) &&
         url.query.length == 0 && url.fragment.length == 0;
}

static NSUInteger AncHostedAppendContentLength(NSString *value) {
  if (value.length == 0 || value.length > 4 || [value hasPrefix:@"0"])
    return NSNotFound;
  NSCharacterSet *invalid = NSCharacterSet.decimalDigitCharacterSet.invertedSet;
  if ([value rangeOfCharacterFromSet:invalid].location != NSNotFound)
    return NSNotFound;
  unsigned long long parsed = value.longLongValue;
  return parsed > 0 && parsed <= kReceiptMaximumBytes ? (NSUInteger)parsed
                                                      : NSNotFound;
}

@interface AncPrivateVaultHostedAppendOperation
    : NSObject <NSURLSessionDataDelegate, NSURLSessionTaskDelegate>
@property(nonatomic) NSURL *targetURL;
@property(nonatomic) NSURLSessionConfiguration *configuration;
@property(nonatomic) NSURLSession *session;
@property(nonatomic) NSMutableData *responseBody;
@property(nonatomic) NSUInteger expectedLength;
@property(nonatomic) AncPrivateVaultHostedAppendTransportStatus failure;
@property(nonatomic) BOOL finished;
@property(nonatomic, copy) AncPrivateVaultHostedAppendCompletion completion;
- (void)startBody:(NSData *)body proofHeader:(NSString *)proofHeader;
@end

@implementation AncPrivateVaultHostedAppendOperation

- (void)finish:(AncPrivateVaultHostedAppendTransportStatus)status
       receipt:(NSData *)receipt {
  if (self.finished)
    return;
  self.finished = YES;
  AncPrivateVaultHostedAppendCompletion completion = self.completion;
  self.completion = nil;
  [self.session finishTasksAndInvalidate];
  completion(status, status == AncPrivateVaultHostedAppendTransportStatusOK
                         ? [receipt copy]
                         : nil);
}

- (void)startBody:(NSData *)body proofHeader:(NSString *)proofHeader {
  self.responseBody = [NSMutableData data];
  self.expectedLength = NSNotFound;
  self.failure = AncPrivateVaultHostedAppendTransportStatusNetworkFailed;
  NSOperationQueue *delegateQueue = [[NSOperationQueue alloc] init];
  delegateQueue.maxConcurrentOperationCount = 1;
  self.session = [NSURLSession sessionWithConfiguration:self.configuration
                                               delegate:self
                                          delegateQueue:delegateQueue];
  NSMutableURLRequest *request = [NSMutableURLRequest
       requestWithURL:self.targetURL
          cachePolicy:NSURLRequestReloadIgnoringLocalCacheData
      timeoutInterval:15.0];
  request.HTTPMethod = @"POST";
  request.HTTPShouldHandleCookies = NO;
  request.HTTPBody = [body copy];
  [request setValue:AncPrivateVaultControlLogAppendContentType
      forHTTPHeaderField:@"Content-Type"];
  [request setValue:[NSString
                        stringWithFormat:@"%lu", (unsigned long)body.length]
      forHTTPHeaderField:@"Content-Length"];
  [request setValue:proofHeader
      forHTTPHeaderField:@"X-ANC-Endpoint-Request-Proof"];
  [[self.session dataTaskWithRequest:request] resume];
}

- (void)URLSession:(NSURLSession *)session
              dataTask:(NSURLSessionDataTask *)dataTask
    didReceiveResponse:(NSURLResponse *)response
     completionHandler:(void (^)(NSURLSessionResponseDisposition disposition))
                           completionHandler {
  (void)session;
  (void)dataTask;
  NSHTTPURLResponse *http = [response isKindOfClass:NSHTTPURLResponse.class]
                                ? (NSHTTPURLResponse *)response
                                : nil;
  if (http == nil || ![http.URL.absoluteString
                         isEqualToString:self.targetURL.absoluteString]) {
    self.failure = AncPrivateVaultHostedAppendTransportStatusInvalid;
    completionHandler(NSURLSessionResponseCancel);
    return;
  }
  if (http.statusCode != 200) {
    self.failure = AncPrivateVaultHostedAppendTransportStatusHTTPError;
    completionHandler(NSURLSessionResponseCancel);
    return;
  }
  NSString *contentType = [http valueForHTTPHeaderField:@"Content-Type"];
  NSUInteger contentLength = AncHostedAppendContentLength(
      [http valueForHTTPHeaderField:@"Content-Length"]);
  if (![contentType
          isEqualToString:AncPrivateVaultControlLogAppendContentType] ||
      contentLength == NSNotFound) {
    self.failure =
        contentLength == NSNotFound
            ? AncPrivateVaultHostedAppendTransportStatusResponseTooLarge
            : AncPrivateVaultHostedAppendTransportStatusInvalid;
    completionHandler(NSURLSessionResponseCancel);
    return;
  }
  self.expectedLength = contentLength;
  completionHandler(NSURLSessionResponseAllow);
}

- (void)URLSession:(NSURLSession *)session
          dataTask:(NSURLSessionDataTask *)dataTask
    didReceiveData:(NSData *)data {
  (void)session;
  if (self.finished)
    return;
  NSUInteger receivedLength = self.responseBody.length;
  if (self.expectedLength == NSNotFound || data.length == 0 ||
      receivedLength > self.expectedLength ||
      receivedLength > kReceiptMaximumBytes ||
      data.length > self.expectedLength - receivedLength ||
      data.length > kReceiptMaximumBytes - receivedLength) {
    self.failure = AncPrivateVaultHostedAppendTransportStatusResponseTooLarge;
    [dataTask cancel];
    return;
  }
  [self.responseBody appendData:data];
}

- (void)URLSession:(NSURLSession *)session
                    task:(NSURLSessionTask *)task
    didCompleteWithError:(NSError *)error {
  (void)session;
  (void)task;
  if (error != nil || self.expectedLength == NSNotFound ||
      self.responseBody.length != self.expectedLength) {
    [self finish:self.failure receipt:nil];
    return;
  }
  [self finish:AncPrivateVaultHostedAppendTransportStatusOK
       receipt:self.responseBody];
}

- (void)URLSession:(NSURLSession *)session
                          task:(NSURLSessionTask *)task
    willPerformHTTPRedirection:(NSHTTPURLResponse *)response
                    newRequest:(NSURLRequest *)request
             completionHandler:
                 (void (^)(NSURLRequest *_Nullable))completionHandler {
  (void)session;
  (void)task;
  (void)response;
  (void)request;
  self.failure = AncPrivateVaultHostedAppendTransportStatusInvalid;
  completionHandler(nil);
}

- (void)URLSession:(NSURLSession *)session
                   task:(NSURLSessionTask *)task
    didReceiveChallenge:(NSURLAuthenticationChallenge *)challenge
      completionHandler:
          (void (^)(NSURLSessionAuthChallengeDisposition disposition,
                    NSURLCredential *_Nullable credential))completionHandler {
  (void)session;
  (void)task;
  if ([challenge.protectionSpace.authenticationMethod
          isEqualToString:NSURLAuthenticationMethodServerTrust]) {
    completionHandler(NSURLSessionAuthChallengePerformDefaultHandling, nil);
  } else {
    completionHandler(NSURLSessionAuthChallengeCancelAuthenticationChallenge,
                      nil);
  }
}

@end

@interface AncPrivateVaultHostedAppendTransport ()
@property(nonatomic) NSURL *origin;
@property(nonatomic) NSURLSessionConfiguration *configuration;
@end

@implementation AncPrivateVaultHostedAppendTransport

- (instancetype)init {
  NSURL *origin = [NSURL URLWithString:@ANC_PRIVATE_VAULT_HOSTED_ORIGIN];
  NSURLSessionConfiguration *configuration =
      NSURLSessionConfiguration.ephemeralSessionConfiguration;
  return [self initWithValidatedOrigin:origin configuration:configuration];
}

- (instancetype)initWithValidatedOrigin:(NSURL *)origin
                          configuration:
                              (NSURLSessionConfiguration *)configuration {
  self = [super init];
  if (self == nil || !AncHostedAppendExactOrigin(origin) ||
      configuration == nil)
    return nil;
  _origin = [origin copy];
  _configuration = [configuration copy];
  _configuration.HTTPCookieStorage = nil;
  _configuration.URLCredentialStorage = nil;
  _configuration.URLCache = nil;
  _configuration.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
  _configuration.timeoutIntervalForRequest = 15.0;
  _configuration.timeoutIntervalForResource = 20.0;
  _configuration.waitsForConnectivity = NO;
  return self;
}

#if ANC_PRIVATE_VAULT_TESTING
- (instancetype)initWithOrigin:(NSURL *)origin
                 configuration:(NSURLSessionConfiguration *)configuration {
  return [self initWithValidatedOrigin:origin configuration:configuration];
}
#endif

- (void)appendBody:(NSData *)body
       proofHeader:(NSString *)proofHeader
        completion:(AncPrivateVaultHostedAppendCompletion)completion {
  if (![body isKindOfClass:NSData.class] || body.length == 0 ||
      body.length > 64 * 1024 + 1024 * 1024 + 256 ||
      ![proofHeader isKindOfClass:NSString.class] || proofHeader.length == 0 ||
      proofHeader.length > 8192 || completion == nil) {
    if (completion != nil)
      completion(AncPrivateVaultHostedAppendTransportStatusInvalid, nil);
    return;
  }
  NSString *target = [self.origin.absoluteString
      stringByAppendingString:AncPrivateVaultControlLogAppendPath];
  AncPrivateVaultHostedAppendOperation *operation =
      [[AncPrivateVaultHostedAppendOperation alloc] init];
  operation.targetURL = [NSURL URLWithString:target];
  operation.configuration = self.configuration;
  operation.completion = completion;
  [operation startBody:body proofHeader:proofHeader];
}

@end
