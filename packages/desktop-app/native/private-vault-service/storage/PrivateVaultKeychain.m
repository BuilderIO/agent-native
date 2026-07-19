#import "PrivateVaultKeychain.h"

#import "PrivateVaultCrypto.h"
#import "PrivateVaultCustodyRecord.h"
#import "PrivateVaultGenesisPreparationRecord.h"

NSString *const AncPrivateVaultFenceService =
    @"com.agentnative.desktop.private-vault.anc-v1.fence";
NSString *const AncPrivateVaultHighWaterService =
    @"com.agentnative.desktop.private-vault.anc-v1.high-water";
NSString *const AncPrivateVaultCustodyService =
    @"com.agentnative.desktop.private-vault.anc-v1.custody";
NSString *const AncPrivateVaultCustodyStageService =
    @"com.agentnative.desktop.private-vault.anc-v1.custody-stage";
NSString *const AncPrivateVaultRotationPreparationService =
    @"com.agentnative.desktop.private-vault.anc-v1.rotation-preparation";
NSString *const AncPrivateVaultRotationPreparationStageService =
    @"com.agentnative.desktop.private-vault.anc-v1.rotation-preparation-stage";
NSString *const AncPrivateVaultGenesisPreparationService =
    @"com.agentnative.desktop.private-vault.anc-v1.genesis-preparation";
NSString *const AncPrivateVaultGenesisPreparationStageService =
    @"com.agentnative.desktop.private-vault.anc-v1.genesis-preparation-stage";
NSString *const AncPrivateVaultRotationCleanupReceiptService =
    @"com.agentnative.desktop.private-vault.anc-v1.rotation-cleanup-receipt";
NSString *const AncPrivateVaultGenesisCleanupReceiptService =
    @"com.agentnative.desktop.private-vault.anc-v1.genesis-cleanup-receipt";
NSString *const AncPrivateVaultTrustedTimeService =
    @"com.agentnative.desktop.private-vault.anc-v1.trusted-time";
NSString *const AncPrivateVaultTrustedTimeHighWaterService =
    @"com.agentnative.desktop.private-vault.anc-v1.trusted-time-high-water";
NSString *const AncPrivateVaultRecoveryPreparationService =
    @"com.agentnative.desktop.private-vault.anc-v1.recovery-preparation";
NSString *const AncPrivateVaultEnrollmentOfferService =
    @"com.agentnative.desktop.private-vault.anc-v1.enrollment-offer";
NSString *const AncPrivateVaultEnrollmentSasReceiptService =
    @"com.agentnative.desktop.private-vault.anc-v1.enrollment-sas-receipt";
NSString *const AncPrivateVaultContinuityPendingService =
    @"com.agentnative.desktop.private-vault.anc-v1.continuity-pending";
NSString *const AncPrivateVaultKeychainAccessGroup =
    @"W3PMF2T3MW.com.agentnative.desktop.private-vault";
NSString *const AncPrivateVaultKeychainStorageDomain =
    @"system-keychain:W3PMF2T3MW.com.agentnative.desktop.private-vault";

static const NSUInteger kMaximumIdentifierBytes = 512;
// Fence records are currently under 1.1 KiB at maximum identifier sizes. Keep
// this adapter intentionally narrow rather than becoming a general blob store.
static const NSUInteger kMaximumRecordBytes = 2048;
static const NSUInteger kRotationPreparationRecordBytes = 512;
static const char kAccountDomain[] = "anc/v1/private-vault/keychain-account";
static NSString *const kAncCustodyExactBoundaryThreadKey =
    @"com.agentnative.private-vault.keychain.custody-exact";

#if ANC_PRIVATE_VAULT_TESTING
static AncPrivateVaultKeychainBoundaryTestHook gAncKeychainBoundaryHook;
void AncPrivateVaultKeychainSetBoundaryHookForTesting(
    AncPrivateVaultKeychainBoundaryTestHook hook) {
  gAncKeychainBoundaryHook = [hook copy];
}
static void AncNotifyBoundary(BOOL opened, BOOL writeBoundary) {
  if (gAncKeychainBoundaryHook != nil)
    gAncKeychainBoundaryHook(opened, writeBoundary);
}
#else
static void AncNotifyBoundary(BOOL opened, BOOL writeBoundary) {
  (void)opened;
  (void)writeBoundary;
}
#endif

static OSStatus AncSecItemCopyMatching(CFDictionaryRef query,
                                       CFTypeRef *result) {
  return SecItemCopyMatching(query, result);
}

static OSStatus AncSecItemAdd(CFDictionaryRef attributes, CFTypeRef *result) {
  return SecItemAdd(attributes, result);
}

static OSStatus AncSecItemUpdate(CFDictionaryRef query,
                                 CFDictionaryRef attributes) {
  return SecItemUpdate(query, attributes);
}

static OSStatus AncSecItemDelete(CFDictionaryRef query) {
  return SecItemDelete(query);
}

static AncPrivateVaultKeychainStatus AncStatusForOSStatus(OSStatus status) {
  switch (status) {
  case errSecSuccess:
    return AncPrivateVaultKeychainStatusOK;
  case errSecItemNotFound:
    return AncPrivateVaultKeychainStatusNotFound;
  case errSecDuplicateItem:
    return AncPrivateVaultKeychainStatusDuplicate;
  case errSecDecode:
    return AncPrivateVaultKeychainStatusCorrupt;
  case errSecInteractionNotAllowed:
  case errSecAuthFailed:
  case errSecNotAvailable:
    return AncPrivateVaultKeychainStatusInaccessible;
  case errSecParam:
    return AncPrivateVaultKeychainStatusInvalid;
  default:
    return AncPrivateVaultKeychainStatusFailed;
  }
}

static BOOL AncIsRotationPreparationService(NSString *service) {
  return
      [service isEqualToString:AncPrivateVaultRotationPreparationService] ||
      [service isEqualToString:AncPrivateVaultRotationPreparationStageService];
}
static BOOL AncIsGenesisPreparationService(NSString *service) {
  return
      [service isEqualToString:AncPrivateVaultGenesisPreparationService] ||
      [service isEqualToString:AncPrivateVaultGenesisPreparationStageService];
}

static BOOL AncIsCustodyService(NSString *service) {
  return [service isEqualToString:AncPrivateVaultCustodyService] ||
         [service isEqualToString:AncPrivateVaultCustodyStageService];
}

static NSObject *AncCustodyExactBoundaryToken(void) {
  static NSObject *token;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    token = [[NSObject alloc] init];
  });
  return token;
}

static AncPrivateVaultKeychainStatus
AncRunCustodyExactBoundary(AncPrivateVaultKeychainStatus (^operation)(void)) {
  NSMutableDictionary *thread = NSThread.currentThread.threadDictionary;
  if (thread[kAncCustodyExactBoundaryThreadKey] != nil)
    return AncPrivateVaultKeychainStatusInvalid;
  NSNumber *prior = thread[kAncCustodyExactBoundaryThreadKey];
  thread[kAncCustodyExactBoundaryThreadKey] = AncCustodyExactBoundaryToken();
  AncPrivateVaultKeychainStatus status = AncPrivateVaultKeychainStatusFailed;
  @try {
    status = operation();
  } @finally {
    if (prior == nil)
      [thread removeObjectForKey:kAncCustodyExactBoundaryThreadKey];
    else
      thread[kAncCustodyExactBoundaryThreadKey] = prior;
  }
  return status;
}

static BOOL AncCustodyExactBoundaryActive(void) {
  return NSThread.currentThread
             .threadDictionary[kAncCustodyExactBoundaryThreadKey] ==
         AncCustodyExactBoundaryToken();
}

static BOOL AncRecordLengthAllowed(NSString *service, NSUInteger length) {
  if (AncIsRotationPreparationService(service))
    return length == kRotationPreparationRecordBytes;
  if (AncIsGenesisPreparationService(service))
    return length == ANC_PV_GENESIS_PREPARATION_RECORD_BYTES;
  return length > 0 && length <= kMaximumRecordBytes;
}

static BOOL AncAppendLengthAndData(NSMutableData *output, NSData *value) {
  if (value.length == 0 || value.length > kMaximumIdentifierBytes ||
      value.length > UINT32_MAX) {
    return NO;
  }
  uint32_t length = CFSwapInt32HostToBig((uint32_t)value.length);
  [output appendBytes:&length length:sizeof(length)];
  [output appendData:value];
  return YES;
}

static NSString *_Nullable AncAccount(NSString *service, NSString *vaultId,
                                      NSString *recordId) {
  NSData *serviceData = [service dataUsingEncoding:NSUTF8StringEncoding];
  NSData *vaultData = [vaultId dataUsingEncoding:NSUTF8StringEncoding];
  NSData *recordData = [recordId dataUsingEncoding:NSUTF8StringEncoding];
  if (serviceData.length == 0 || serviceData.length > kMaximumIdentifierBytes) {
    return nil;
  }
  NSMutableData *input =
      [NSMutableData dataWithBytes:kAccountDomain
                            length:sizeof(kAccountDomain) - 1];
  if (!AncAppendLengthAndData(input, serviceData) ||
      !AncAppendLengthAndData(input, vaultData) ||
      !AncAppendLengthAndData(input, recordData)) {
    return nil;
  }
  uint8_t digest[ANC_PV_HASH_BYTES];
  if (anc_pv_blake2b_256(digest, input.bytes, input.length) !=
      ANC_PV_CRYPTO_OK) {
    return nil;
  }
  static const char hex[] = "0123456789abcdef";
  char account[ANC_PV_HASH_BYTES * 2 + 1];
  for (NSUInteger index = 0; index < ANC_PV_HASH_BYTES; ++index) {
    account[index * 2] = hex[digest[index] >> 4];
    account[index * 2 + 1] = hex[digest[index] & 0x0f];
  }
  account[sizeof(account) - 1] = '\0';
  anc_pv_zeroize(digest, sizeof(digest));
  return [NSString stringWithUTF8String:account];
}

@interface AncPrivateVaultKeychain ()
@property(nonatomic, assign) AncPrivateVaultSecItemFunctions functions;
@property(nonatomic, copy) AncPrivateVaultLAContextFactory contextFactory;
- (AncPrivateVaultKeychainStatus)
    consumeBytesCoreForService:(NSString *)service
                       vaultId:(NSString *)vaultId
                      recordId:(NSString *)recordId
                      consumer:(AncPrivateVaultKeychainBytesConsumer)consumer
                  custodyExact:(BOOL)custodyExact;
- (AncPrivateVaultKeychainStatus)writeBytesCore:(const uint8_t *)bytes
                                         length:(size_t)length
                                     forService:(NSString *)service
                                        vaultId:(NSString *)vaultId
                                       recordId:(NSString *)recordId
                                            add:(BOOL)add
                                   custodyExact:(BOOL)custodyExact;
- (AncPrivateVaultKeychainStatus)deleteDataCoreForService:(NSString *)service
                                                  vaultId:(NSString *)vaultId
                                                 recordId:(NSString *)recordId
                                             custodyExact:(BOOL)custodyExact;
@end

@implementation AncPrivateVaultKeychain

- (instancetype)init {
  AncPrivateVaultSecItemFunctions functions = {
      .copyMatching = AncSecItemCopyMatching,
      .add = AncSecItemAdd,
      .update = AncSecItemUpdate,
      .deleteItem = AncSecItemDelete,
  };
  return [self initWithFunctions:functions
                  contextFactory:^LAContext * {
                    return [[LAContext alloc] init];
                  }];
}

- (instancetype)initWithFunctions:(AncPrivateVaultSecItemFunctions)functions
                   contextFactory:(AncPrivateVaultLAContextFactory)factory {
  return [self initWithFunctions:functions
                  contextFactory:factory
                   storageDomain:AncPrivateVaultKeychainStorageDomain];
}

- (instancetype)initWithFunctions:(AncPrivateVaultSecItemFunctions)functions
                   contextFactory:(AncPrivateVaultLAContextFactory)factory
                    storageDomain:(NSString *)storageDomain {
  self = [super init];
  if (self == nil)
    return nil;
  if (functions.copyMatching == NULL || functions.add == NULL ||
      functions.update == NULL || functions.deleteItem == NULL ||
      factory == nil || storageDomain.length == 0 ||
      [storageDomain lengthOfBytesUsingEncoding:NSUTF8StringEncoding] > 512) {
    return nil;
  }
  _functions = functions;
  _contextFactory = [factory copy];
  _storageDomain = [storageDomain copy];
  return self;
}

- (NSDictionary *_Nullable)baseQueryForService:(NSString *)service
                                       vaultId:(NSString *)vaultId
                                      recordId:(NSString *)recordId {
  if (![service isEqualToString:AncPrivateVaultFenceService] &&
      ![service isEqualToString:AncPrivateVaultHighWaterService] &&
      ![service isEqualToString:AncPrivateVaultCustodyService] &&
      ![service isEqualToString:AncPrivateVaultCustodyStageService] &&
      ![service isEqualToString:AncPrivateVaultRotationPreparationService] &&
      ![service
          isEqualToString:AncPrivateVaultRotationPreparationStageService] &&
      ![service isEqualToString:AncPrivateVaultGenesisPreparationService] &&
      ![service
          isEqualToString:AncPrivateVaultGenesisPreparationStageService] &&
      ![service isEqualToString:AncPrivateVaultRotationCleanupReceiptService] &&
      ![service isEqualToString:AncPrivateVaultGenesisCleanupReceiptService] &&
      ![service isEqualToString:AncPrivateVaultTrustedTimeService] &&
      ![service isEqualToString:AncPrivateVaultTrustedTimeHighWaterService] &&
      ![service isEqualToString:AncPrivateVaultRecoveryPreparationService] &&
      ![service isEqualToString:AncPrivateVaultEnrollmentOfferService] &&
      ![service isEqualToString:AncPrivateVaultEnrollmentSasReceiptService] &&
      ![service isEqualToString:AncPrivateVaultContinuityPendingService]) {
    return nil;
  }
  NSString *account = AncAccount(service, vaultId, recordId);
  if (account == nil)
    return nil;
  return @{
    (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService : service,
    (__bridge id)kSecAttrAccount : account,
    (__bridge id)kSecAttrAccessGroup : AncPrivateVaultKeychainAccessGroup,
    (__bridge id)kSecAttrSynchronizable : @NO,
    (__bridge id)kSecUseDataProtectionKeychain : @YES,
  };
}

- (AncPrivateVaultKeychainStatus)copyDataForService:(NSString *)service
                                            vaultId:(NSString *)vaultId
                                           recordId:(NSString *)recordId
                                               data:(NSData **)data {
  if (data == NULL)
    return AncPrivateVaultKeychainStatusInvalid;
  *data = nil;
  if (AncCustodyExactBoundaryActive() || AncIsCustodyService(service) ||
      AncIsRotationPreparationService(service) ||
      AncIsGenesisPreparationService(service))
    return AncPrivateVaultKeychainStatusInvalid;
  NSDictionary *base = [self baseQueryForService:service
                                         vaultId:vaultId
                                        recordId:recordId];
  if (base == nil)
    return AncPrivateVaultKeychainStatusInvalid;
  LAContext *context = self.contextFactory();
  if (context == nil)
    return AncPrivateVaultKeychainStatusFailed;
  context.interactionNotAllowed = YES;
  NSMutableDictionary *query = [base mutableCopy];
  query[(__bridge id)kSecReturnData] = @YES;
  query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
  query[(__bridge id)kSecUseAuthenticationContext] = context;
  CFTypeRef rawResult = NULL;
  OSStatus result =
      self.functions.copyMatching((__bridge CFDictionaryRef)query, &rawResult);
  if (result != errSecSuccess) {
    if (rawResult != NULL)
      CFRelease(rawResult);
    return AncStatusForOSStatus(result);
  }
  if (rawResult == NULL || CFGetTypeID(rawResult) != CFDataGetTypeID()) {
    if (rawResult != NULL)
      CFRelease(rawResult);
    return AncPrivateVaultKeychainStatusCorrupt;
  }
  NSData *copied = CFBridgingRelease(rawResult);
  if (copied.length == 0 || copied.length > kMaximumRecordBytes) {
    return AncPrivateVaultKeychainStatusCorrupt;
  }
  /* Legacy callers receive the single Security.framework CFData boundary.
   * Secret-bearing repositories must use consumeBytesForService so this
   * boundary cannot escape the synchronous callback. */
  *data = copied;
  return AncPrivateVaultKeychainStatusOK;
}

- (AncPrivateVaultKeychainStatus)
    consumeBytesForService:(NSString *)service
                   vaultId:(NSString *)vaultId
                  recordId:(NSString *)recordId
                  consumer:(AncPrivateVaultKeychainBytesConsumer)consumer {
  if (AncCustodyExactBoundaryActive() || AncIsCustodyService(service))
    return AncPrivateVaultKeychainStatusInvalid;
  return [self consumeBytesCoreForService:service
                                  vaultId:vaultId
                                 recordId:recordId
                                 consumer:consumer
                             custodyExact:NO];
}

- (AncPrivateVaultKeychainStatus)
    consumeBytesCoreForService:(NSString *)service
                       vaultId:(NSString *)vaultId
                      recordId:(NSString *)recordId
                      consumer:(AncPrivateVaultKeychainBytesConsumer)consumer
                  custodyExact:(BOOL)custodyExact {
  const BOOL active = AncCustodyExactBoundaryActive();
  if (consumer == nil || active != custodyExact ||
      (custodyExact && !AncIsCustodyService(service)) ||
      (!custodyExact && AncIsCustodyService(service)))
    return AncPrivateVaultKeychainStatusInvalid;
  NSDictionary *base = [self baseQueryForService:service
                                         vaultId:vaultId
                                        recordId:recordId];
  if (base == nil)
    return AncPrivateVaultKeychainStatusInvalid;
  LAContext *context = self.contextFactory();
  if (context == nil)
    return AncPrivateVaultKeychainStatusFailed;
  context.interactionNotAllowed = YES;
  NSMutableDictionary *query = [base mutableCopy];
  query[(__bridge id)kSecReturnData] = @YES;
  query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
  query[(__bridge id)kSecUseAuthenticationContext] = context;
  CFTypeRef raw = NULL;
  OSStatus result =
      self.functions.copyMatching((__bridge CFDictionaryRef)query, &raw);
  if (result != errSecSuccess) {
    if (raw != NULL)
      CFRelease(raw);
    return AncStatusForOSStatus(result);
  }
  if (raw == NULL || CFGetTypeID(raw) != CFDataGetTypeID()) {
    if (raw != NULL)
      CFRelease(raw);
    return AncPrivateVaultKeychainStatusCorrupt;
  }
  CFDataRef boundary = (CFDataRef)raw;
  AncNotifyBoundary(YES, NO);
  CFIndex boundaryLength = CFDataGetLength(boundary);
  const BOOL exactLength = boundaryLength == ANC_PV_CUSTODY_RECORD_BYTES;
  if (boundaryLength <= 0 ||
      (custodyExact
           ? !exactLength
           : !AncRecordLengthAllowed(service, (NSUInteger)boundaryLength))) {
    CFRelease(boundary);
    AncNotifyBoundary(NO, NO);
    return AncPrivateVaultKeychainStatusCorrupt;
  }
  BOOL consumed = NO;
  @try {
    consumed = consumer(CFDataGetBytePtr(boundary), (size_t)boundaryLength);
  } @catch (__unused NSException *exception) {
    consumed = NO;
  }
  CFRelease(boundary);
  AncNotifyBoundary(NO, NO);
  return consumed ? AncPrivateVaultKeychainStatusOK
                  : AncPrivateVaultKeychainStatusCorrupt;
}

- (AncPrivateVaultKeychainStatus)writeBytesCore:(const uint8_t *)bytes
                                         length:(size_t)length
                                     forService:(NSString *)service
                                        vaultId:(NSString *)vaultId
                                       recordId:(NSString *)recordId
                                            add:(BOOL)add
                                   custodyExact:(BOOL)custodyExact {
  const BOOL active = AncCustodyExactBoundaryActive();
  if (active != custodyExact ||
      (custodyExact && !AncIsCustodyService(service)) ||
      (!custodyExact && AncIsCustodyService(service)) ||
      (custodyExact && length != ANC_PV_CUSTODY_RECORD_BYTES))
    return AncPrivateVaultKeychainStatusInvalid;
  NSDictionary *base = [self baseQueryForService:service
                                         vaultId:vaultId
                                        recordId:recordId];
  if (base == nil || bytes == NULL ||
      !AncRecordLengthAllowed(service, length) || length > LONG_MAX)
    return AncPrivateVaultKeychainStatusInvalid;
  CFDataRef boundary = CFDataCreateWithBytesNoCopy(
      kCFAllocatorDefault, bytes, (CFIndex)length, kCFAllocatorNull);
  if (boundary == NULL)
    return AncPrivateVaultKeychainStatusFailed;
  AncNotifyBoundary(YES, YES);
  OSStatus mutation;
  if (add) {
    NSMutableDictionary *attributes = [base mutableCopy];
    attributes[(__bridge id)kSecAttrAccessible] =
        (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
    attributes[(__bridge id)kSecValueData] = (__bridge id)boundary;
    mutation = self.functions.add((__bridge CFDictionaryRef)attributes, NULL);
    [attributes removeObjectForKey:(__bridge id)kSecValueData];
  } else {
    NSMutableDictionary *attributes = [@{
      (__bridge id)kSecValueData : (__bridge id)boundary,
    } mutableCopy];
    mutation = self.functions.update((__bridge CFDictionaryRef)base,
                                     (__bridge CFDictionaryRef)attributes);
    [attributes removeObjectForKey:(__bridge id)kSecValueData];
  }
  CFRelease(boundary);
  AncNotifyBoundary(NO, YES);
  __block BOOL equal = NO;
  AncPrivateVaultKeychainStatus readback = [self
      consumeBytesCoreForService:service
                         vaultId:vaultId
                        recordId:recordId
                        consumer:^BOOL(const uint8_t *observed,
                                       size_t observedLen) {
                          equal = observedLen == length &&
                                  anc_pv_memcmp(observed, bytes, length) ==
                                      ANC_PV_CRYPTO_OK;
                          return YES;
                        }
                    custodyExact:custodyExact];
  if (readback == AncPrivateVaultKeychainStatusOK)
    return equal ? AncPrivateVaultKeychainStatusOK
                 : AncPrivateVaultKeychainStatusCorrupt;
  if (readback != AncPrivateVaultKeychainStatusNotFound)
    return readback;
  return mutation == errSecSuccess ? AncPrivateVaultKeychainStatusFailed
                                   : AncStatusForOSStatus(mutation);
}

- (AncPrivateVaultKeychainStatus)addBytes:(const uint8_t *)bytes
                                   length:(size_t)length
                               forService:(NSString *)service
                                  vaultId:(NSString *)vaultId
                                 recordId:(NSString *)recordId {
  if (AncCustodyExactBoundaryActive() || AncIsCustodyService(service))
    return AncPrivateVaultKeychainStatusInvalid;
  return [self writeBytesCore:bytes
                       length:length
                   forService:service
                      vaultId:vaultId
                     recordId:recordId
                          add:YES
                 custodyExact:NO];
}

- (AncPrivateVaultKeychainStatus)updateBytes:(const uint8_t *)bytes
                                      length:(size_t)length
                                  forService:(NSString *)service
                                     vaultId:(NSString *)vaultId
                                    recordId:(NSString *)recordId {
  if (AncCustodyExactBoundaryActive() || AncIsCustodyService(service))
    return AncPrivateVaultKeychainStatusInvalid;
  return [self writeBytesCore:bytes
                       length:length
                   forService:service
                      vaultId:vaultId
                     recordId:recordId
                          add:NO
                 custodyExact:NO];
}

- (AncPrivateVaultKeychainStatus)
    consumeCustodyRecordForService:(NSString *)service
                           vaultId:(NSString *)vaultId
                          recordId:(NSString *)recordId
                          consumer:
                              (AncPrivateVaultKeychainCustodyRecordConsumer)
                                  consumer {
  if (!AncIsCustodyService(service) || consumer == nil)
    return AncPrivateVaultKeychainStatusInvalid;
  return AncRunCustodyExactBoundary(^AncPrivateVaultKeychainStatus {
    return [self
        consumeBytesCoreForService:service
                           vaultId:vaultId
                          recordId:recordId
                          consumer:^BOOL(const uint8_t *bytes, size_t length) {
                            return length == ANC_PV_CUSTODY_RECORD_BYTES &&
                                   consumer(bytes);
                          }
                      custodyExact:YES];
  });
}

- (AncPrivateVaultKeychainStatus)addCustodyRecord:(const uint8_t *)record
                                           length:(size_t)length
                                       forService:(NSString *)service
                                          vaultId:(NSString *)vaultId
                                         recordId:(NSString *)recordId {
  if (!AncIsCustodyService(service) || record == NULL ||
      length != ANC_PV_CUSTODY_RECORD_BYTES)
    return AncPrivateVaultKeychainStatusInvalid;
  return AncRunCustodyExactBoundary(^AncPrivateVaultKeychainStatus {
    return [self writeBytesCore:record
                         length:ANC_PV_CUSTODY_RECORD_BYTES
                     forService:service
                        vaultId:vaultId
                       recordId:recordId
                            add:YES
                   custodyExact:YES];
  });
}

- (AncPrivateVaultKeychainStatus)updateCustodyRecord:(const uint8_t *)record
                                              length:(size_t)length
                                          forService:(NSString *)service
                                             vaultId:(NSString *)vaultId
                                            recordId:(NSString *)recordId {
  if (!AncIsCustodyService(service) || record == NULL ||
      length != ANC_PV_CUSTODY_RECORD_BYTES)
    return AncPrivateVaultKeychainStatusInvalid;
  return AncRunCustodyExactBoundary(^AncPrivateVaultKeychainStatus {
    return [self writeBytesCore:record
                         length:ANC_PV_CUSTODY_RECORD_BYTES
                     forService:service
                        vaultId:vaultId
                       recordId:recordId
                            add:NO
                   custodyExact:YES];
  });
}

- (AncPrivateVaultKeychainStatus)
    deleteCustodyRecordForService:(NSString *)service
                          vaultId:(NSString *)vaultId
                         recordId:(NSString *)recordId {
  if (!AncIsCustodyService(service))
    return AncPrivateVaultKeychainStatusInvalid;
  return AncRunCustodyExactBoundary(^AncPrivateVaultKeychainStatus {
    return [self deleteDataCoreForService:service
                                  vaultId:vaultId
                                 recordId:recordId
                             custodyExact:YES];
  });
}

- (AncPrivateVaultKeychainStatus)
    consumeGenesisPreparationRecordForService:(NSString *)service
                                      vaultId:(NSString *)vaultId
                                     recordId:(NSString *)recordId
                                     consumer:
                                         (AncPrivateVaultKeychainGenesisPreparationRecordConsumer)
                                             consumer {
  if (!AncIsGenesisPreparationService(service) || consumer == nil)
    return AncPrivateVaultKeychainStatusInvalid;
  return [self
      consumeBytesForService:service
                     vaultId:vaultId
                    recordId:recordId
                    consumer:^BOOL(const uint8_t *bytes, size_t length) {
                      return length ==
                                 ANC_PV_GENESIS_PREPARATION_RECORD_BYTES &&
                             consumer(bytes);
                    }];
}

- (AncPrivateVaultKeychainStatus)
    addGenesisPreparationRecord:(const uint8_t *)record
                         length:(size_t)length
                     forService:(NSString *)service
                        vaultId:(NSString *)vaultId
                       recordId:(NSString *)recordId {
  if (!AncIsGenesisPreparationService(service) ||
      length != ANC_PV_GENESIS_PREPARATION_RECORD_BYTES)
    return AncPrivateVaultKeychainStatusInvalid;
  return [self addBytes:record
                 length:length
             forService:service
                vaultId:vaultId
               recordId:recordId];
}

- (AncPrivateVaultKeychainStatus)
    updateGenesisPreparationRecord:(const uint8_t *)record
                            length:(size_t)length
                        forService:(NSString *)service
                           vaultId:(NSString *)vaultId
                          recordId:(NSString *)recordId {
  if (!AncIsGenesisPreparationService(service) ||
      length != ANC_PV_GENESIS_PREPARATION_RECORD_BYTES)
    return AncPrivateVaultKeychainStatusInvalid;
  return [self updateBytes:record
                    length:length
                forService:service
                   vaultId:vaultId
                  recordId:recordId];
}

- (AncPrivateVaultKeychainStatus)
    deleteGenesisPreparationStageVaultId:(NSString *)vaultId
                                recordId:(NSString *)recordId {
  return [self
      deleteDataCoreForService:AncPrivateVaultGenesisPreparationStageService
                       vaultId:vaultId
                      recordId:recordId
                  custodyExact:NO];
}

- (AncPrivateVaultKeychainStatus)addData:(NSData *)data
                              forService:(NSString *)service
                                 vaultId:(NSString *)vaultId
                                recordId:(NSString *)recordId {
  if (AncCustodyExactBoundaryActive() || AncIsCustodyService(service) ||
      AncIsRotationPreparationService(service) ||
      AncIsGenesisPreparationService(service))
    return AncPrivateVaultKeychainStatusInvalid;
  NSDictionary *base = [self baseQueryForService:service
                                         vaultId:vaultId
                                        recordId:recordId];
  if (base == nil || !AncRecordLengthAllowed(service, data.length))
    return AncPrivateVaultKeychainStatusInvalid;
  NSMutableDictionary *attributes = [base mutableCopy];
  attributes[(__bridge id)kSecAttrAccessible] =
      (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
  attributes[(__bridge id)kSecValueData] = data;
  OSStatus mutation =
      self.functions.add((__bridge CFDictionaryRef)attributes, NULL);
  __block BOOL equal = NO;
  AncPrivateVaultKeychainStatus readback =
      [self consumeBytesForService:service
                           vaultId:vaultId
                          recordId:recordId
                          consumer:^BOOL(const uint8_t *bytes, size_t length) {
                            equal = length == data.length &&
                                    anc_pv_memcmp(bytes, data.bytes, length) ==
                                        ANC_PV_CRYPTO_OK;
                            return YES;
                          }];
  if (readback == AncPrivateVaultKeychainStatusOK)
    return equal ? AncPrivateVaultKeychainStatusOK
                 : AncPrivateVaultKeychainStatusCorrupt;
  if (readback != AncPrivateVaultKeychainStatusNotFound)
    return readback;
  return mutation == errSecSuccess ? AncPrivateVaultKeychainStatusFailed
                                   : AncStatusForOSStatus(mutation);
}

- (AncPrivateVaultKeychainStatus)updateData:(NSData *)data
                                 forService:(NSString *)service
                                    vaultId:(NSString *)vaultId
                                   recordId:(NSString *)recordId {
  if (AncCustodyExactBoundaryActive() || AncIsCustodyService(service) ||
      AncIsRotationPreparationService(service) ||
      AncIsGenesisPreparationService(service))
    return AncPrivateVaultKeychainStatusInvalid;
  NSDictionary *query = [self baseQueryForService:service
                                          vaultId:vaultId
                                         recordId:recordId];
  if (query == nil || !AncRecordLengthAllowed(service, data.length))
    return AncPrivateVaultKeychainStatusInvalid;
  NSDictionary *attributes = @{(__bridge id)kSecValueData : data};
  OSStatus mutation = self.functions.update(
      (__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)attributes);
  __block BOOL equal = NO;
  AncPrivateVaultKeychainStatus readback =
      [self consumeBytesForService:service
                           vaultId:vaultId
                          recordId:recordId
                          consumer:^BOOL(const uint8_t *bytes, size_t length) {
                            equal = length == data.length &&
                                    anc_pv_memcmp(bytes, data.bytes, length) ==
                                        ANC_PV_CRYPTO_OK;
                            return YES;
                          }];
  if (readback == AncPrivateVaultKeychainStatusOK)
    return equal ? AncPrivateVaultKeychainStatusOK
                 : AncPrivateVaultKeychainStatusCorrupt;
  if (readback != AncPrivateVaultKeychainStatusNotFound)
    return readback;
  return mutation == errSecSuccess ? AncPrivateVaultKeychainStatusFailed
                                   : AncStatusForOSStatus(mutation);
}

- (AncPrivateVaultKeychainStatus)deleteDataForService:(NSString *)service
                                              vaultId:(NSString *)vaultId
                                             recordId:(NSString *)recordId {
  if (AncCustodyExactBoundaryActive() || AncIsCustodyService(service) ||
      AncIsGenesisPreparationService(service))
    return AncPrivateVaultKeychainStatusInvalid;
  return [self deleteDataCoreForService:service
                                vaultId:vaultId
                               recordId:recordId
                           custodyExact:NO];
}

- (AncPrivateVaultKeychainStatus)deleteDataCoreForService:(NSString *)service
                                                  vaultId:(NSString *)vaultId
                                                 recordId:(NSString *)recordId
                                             custodyExact:(BOOL)custodyExact {
  const BOOL active = AncCustodyExactBoundaryActive();
  if (active != custodyExact ||
      (custodyExact && !AncIsCustodyService(service)) ||
      (!custodyExact && AncIsCustodyService(service)))
    return AncPrivateVaultKeychainStatusInvalid;
  NSDictionary *query = [self baseQueryForService:service
                                          vaultId:vaultId
                                         recordId:recordId];
  if (query == nil)
    return AncPrivateVaultKeychainStatusInvalid;
  OSStatus mutation =
      self.functions.deleteItem((__bridge CFDictionaryRef)query);
  AncPrivateVaultKeychainStatus readback = [self
      consumeBytesCoreForService:service
                         vaultId:vaultId
                        recordId:recordId
                        consumer:^BOOL(const uint8_t *bytes, size_t length) {
                          (void)bytes;
                          (void)length;
                          return YES;
                        }
                    custodyExact:custodyExact];
  if (readback == AncPrivateVaultKeychainStatusNotFound)
    return AncPrivateVaultKeychainStatusOK;
  if (readback == AncPrivateVaultKeychainStatusOK)
    return AncPrivateVaultKeychainStatusFailed;
  AncPrivateVaultKeychainStatus mapped = AncStatusForOSStatus(mutation);
  return readback == AncPrivateVaultKeychainStatusFailed ? mapped : readback;
}

@end
