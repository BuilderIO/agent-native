#import "PrivateVaultTrustedTimeStore.h"

#import "PrivateVaultCrypto.h"

#import <objc/runtime.h>

static NSString *const kTrustedTimeVaultId = @"device";
static NSString *const kTrustedTimeRecordId = @"unix-milliseconds-floor";
static const uint8_t kTrustedTimeMagic[8] = {'A', 'N', 'P', 'V', 'T', 'M', '0',
                                             '1'};
static const uint8_t kTrustedTimeVersion = 1;
static const uint64_t kMaximumSafeInteger = UINT64_C(9007199254740991);
static const uint8_t kTrustedTimeDigestDomain[] =
    "anc/v1/private-vault/trusted-time-floor";

typedef NS_ENUM(uint8_t, AncTrustedTimeFrameState) {
  AncTrustedTimeFrameStatePending = 1,
  AncTrustedTimeFrameStateStable = 2,
};

typedef struct AncTrustedTimeFrame {
  AncTrustedTimeFrameState state;
  uint64_t generation;
  uint64_t floorMilliseconds;
} AncTrustedTimeFrame;

typedef struct AncTrustedTimePair {
  BOOL absent;
  BOOL liveAbsent;
  AncTrustedTimeFrame live;
  AncTrustedTimeFrame high;
} AncTrustedTimePair;

@interface AncPrivateVaultTrustedTimeStore ()
@property(nonatomic) AncPrivateVaultKeychain *keychain;
@property(nonatomic) dispatch_queue_t queue;
@end

static dispatch_queue_t AncTrustedTimeQueue(void) {
  static dispatch_queue_t queue;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    queue = dispatch_queue_create(
        "com.agentnative.private-vault.trusted-time", DISPATCH_QUEUE_SERIAL);
  });
  return queue;
}

static NSData *AncTrustedTimeEncode(AncTrustedTimeFrameState state,
                                    uint64_t generation, uint64_t floorMs) {
  if ((state != AncTrustedTimeFrameStatePending &&
       state != AncTrustedTimeFrameStateStable) ||
      generation == 0 || floorMs == 0 || floorMs > kMaximumSafeInteger)
    return nil;
  uint8_t bytes[60] = {0};
  memcpy(bytes, kTrustedTimeMagic, sizeof kTrustedTimeMagic);
  bytes[8] = kTrustedTimeVersion;
  bytes[9] = state;
  uint64_t encoded = CFSwapInt64HostToBig(generation);
  memcpy(bytes + 12, &encoded, 8);
  encoded = CFSwapInt64HostToBig(floorMs);
  memcpy(bytes + 20, &encoded, 8);
  uint8_t digest[32] = {0};
  BOOL valid = anc_pv_blake2b_256_two_part(
                   digest, kTrustedTimeDigestDomain,
                   sizeof kTrustedTimeDigestDomain, bytes, 28) ==
               ANC_PV_CRYPTO_OK;
  if (valid)
    memcpy(bytes + 28, digest, sizeof digest);
  anc_pv_zeroize(digest, sizeof digest);
  NSData *frame = valid ? [NSData dataWithBytes:bytes length:sizeof bytes] : nil;
  anc_pv_zeroize(bytes, sizeof bytes);
  return frame;
}

static BOOL AncTrustedTimeDecode(NSData *data, AncTrustedTimeFrame *frame) {
  if (data.length != 60 || frame == NULL)
    return NO;
  const uint8_t *bytes = data.bytes;
  if (memcmp(bytes, kTrustedTimeMagic, sizeof kTrustedTimeMagic) != 0 ||
      bytes[8] != kTrustedTimeVersion ||
      (bytes[9] != AncTrustedTimeFrameStatePending &&
       bytes[9] != AncTrustedTimeFrameStateStable) ||
      bytes[10] != 0 || bytes[11] != 0)
    return NO;
  uint8_t digest[32] = {0};
  BOOL valid = anc_pv_blake2b_256_two_part(
                   digest, kTrustedTimeDigestDomain,
                   sizeof kTrustedTimeDigestDomain, bytes, 28) ==
                   ANC_PV_CRYPTO_OK &&
               anc_pv_memcmp(digest, bytes + 28, sizeof digest) ==
                   ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(digest, sizeof digest);
  if (!valid)
    return NO;
  uint64_t encoded = 0;
  memcpy(&encoded, bytes + 12, 8);
  frame->generation = CFSwapInt64BigToHost(encoded);
  memcpy(&encoded, bytes + 20, 8);
  frame->floorMilliseconds = CFSwapInt64BigToHost(encoded);
  frame->state = (AncTrustedTimeFrameState)bytes[9];
  return frame->generation != 0 && frame->floorMilliseconds != 0 &&
         frame->floorMilliseconds <= kMaximumSafeInteger;
}

static AncPrivateVaultTrustedTimeStatus AncTrustedTimeKeychainStatus(
    AncPrivateVaultKeychainStatus status) {
  switch (status) {
  case AncPrivateVaultKeychainStatusOK:
    return AncPrivateVaultTrustedTimeStatusOK;
  case AncPrivateVaultKeychainStatusCorrupt:
    return AncPrivateVaultTrustedTimeStatusCorrupt;
  case AncPrivateVaultKeychainStatusInaccessible:
    return AncPrivateVaultTrustedTimeStatusInaccessible;
  case AncPrivateVaultKeychainStatusInvalid:
    return AncPrivateVaultTrustedTimeStatusInvalid;
  default:
    return AncPrivateVaultTrustedTimeStatusFailed;
  }
}

@implementation AncPrivateVaultTrustedTimeStore

- (instancetype)init {
  return [self initWithKeychain:[AncPrivateVaultKeychain new]];
}

- (instancetype)initWithKeychain:(AncPrivateVaultKeychain *)keychain {
  self = [super init];
  if (self == nil ||
      object_getClass(keychain) != AncPrivateVaultKeychain.class)
    return nil;
  _keychain = keychain;
  _queue = AncTrustedTimeQueue();
  return self;
}

- (AncPrivateVaultTrustedTimeStatus)readPair:(AncTrustedTimePair *)pair {
  memset(pair, 0, sizeof *pair);
  NSData *liveData = nil;
  NSData *highData = nil;
  AncPrivateVaultKeychainStatus liveStatus =
      [self.keychain copyDataForService:AncPrivateVaultTrustedTimeService
                                vaultId:kTrustedTimeVaultId
                               recordId:kTrustedTimeRecordId
                                   data:&liveData];
  AncPrivateVaultKeychainStatus highStatus =
      [self.keychain
          copyDataForService:AncPrivateVaultTrustedTimeHighWaterService
                     vaultId:kTrustedTimeVaultId
                    recordId:kTrustedTimeRecordId
                        data:&highData];
  if (liveStatus == AncPrivateVaultKeychainStatusNotFound &&
      highStatus == AncPrivateVaultKeychainStatusNotFound) {
    pair->absent = YES;
    return AncPrivateVaultTrustedTimeStatusOK;
  }
  if (highStatus != AncPrivateVaultKeychainStatusOK)
    return highStatus == AncPrivateVaultKeychainStatusNotFound
               ? AncPrivateVaultTrustedTimeStatusRollbackDetected
               : AncTrustedTimeKeychainStatus(highStatus);
  if (!AncTrustedTimeDecode(highData, &pair->high))
    return AncPrivateVaultTrustedTimeStatusCorrupt;
  if (liveStatus == AncPrivateVaultKeychainStatusNotFound) {
    pair->liveAbsent = YES;
    return pair->high.state == AncTrustedTimeFrameStatePending &&
                   pair->high.generation == 1
               ? AncPrivateVaultTrustedTimeStatusOK
               : AncPrivateVaultTrustedTimeStatusRollbackDetected;
  }
  if (liveStatus != AncPrivateVaultKeychainStatusOK)
    return AncTrustedTimeKeychainStatus(liveStatus);
  if (!AncTrustedTimeDecode(liveData, &pair->live))
    return AncPrivateVaultTrustedTimeStatusCorrupt;
  BOOL same = pair->live.generation == pair->high.generation &&
              pair->live.floorMilliseconds == pair->high.floorMilliseconds;
  if (same && pair->live.state == pair->high.state)
    return AncPrivateVaultTrustedTimeStatusOK;
  BOOL recoverableAdvance =
      pair->live.state == AncTrustedTimeFrameStateStable &&
      pair->high.state == AncTrustedTimeFrameStatePending &&
      pair->live.generation != UINT64_MAX &&
      pair->high.generation == pair->live.generation + 1 &&
      pair->high.floorMilliseconds > pair->live.floorMilliseconds;
  BOOL recoverableFinalize =
      pair->live.state == AncTrustedTimeFrameStateStable &&
      pair->high.state == AncTrustedTimeFrameStatePending &&
      pair->live.generation == pair->high.generation &&
      pair->live.floorMilliseconds == pair->high.floorMilliseconds;
  return recoverableAdvance || recoverableFinalize
             ? AncPrivateVaultTrustedTimeStatusOK
             : AncPrivateVaultTrustedTimeStatusRollbackDetected;
}

- (AncPrivateVaultTrustedTimeStatus)writeFrame:(NSData *)frame
                                        service:(NSString *)service
                                            add:(BOOL)add {
  AncPrivateVaultKeychainStatus status =
      add ? [self.keychain addData:frame
                        forService:service
                           vaultId:kTrustedTimeVaultId
                          recordId:kTrustedTimeRecordId]
          : [self.keychain updateData:frame
                           forService:service
                              vaultId:kTrustedTimeVaultId
                             recordId:kTrustedTimeRecordId];
  if (status == AncPrivateVaultKeychainStatusOK)
    return AncPrivateVaultTrustedTimeStatusOK;
  NSData *observed = nil;
  AncPrivateVaultKeychainStatus reread =
      [self.keychain copyDataForService:service
                                vaultId:kTrustedTimeVaultId
                               recordId:kTrustedTimeRecordId
                                   data:&observed];
  if (reread == AncPrivateVaultKeychainStatusOK &&
      [observed isEqualToData:frame])
    return AncPrivateVaultTrustedTimeStatusOK;
  return reread == AncPrivateVaultKeychainStatusOK
             ? AncPrivateVaultTrustedTimeStatusRollbackDetected
             : AncTrustedTimeKeychainStatus(status);
}

- (AncPrivateVaultTrustedTimeStatus)
    stabilizeGeneration:(uint64_t)generation
                   floor:(uint64_t)floor
                    pair:(AncTrustedTimePair *)pair {
  NSData *pending =
      AncTrustedTimeEncode(AncTrustedTimeFrameStatePending, generation, floor);
  NSData *stable =
      AncTrustedTimeEncode(AncTrustedTimeFrameStateStable, generation, floor);
  if (pending == nil || stable == nil)
    return AncPrivateVaultTrustedTimeStatusInvalid;
  BOOL initialize = pair->absent || pair->liveAbsent;
  AncPrivateVaultTrustedTimeStatus status = AncPrivateVaultTrustedTimeStatusOK;
  if (pair->absent) {
    status = [self writeFrame:pending
                      service:AncPrivateVaultTrustedTimeHighWaterService
                          add:YES];
    if (status != AncPrivateVaultTrustedTimeStatusOK)
      return status;
  }
  if (initialize) {
    status = [self writeFrame:pending
                      service:AncPrivateVaultTrustedTimeService
                          add:YES];
    if (status != AncPrivateVaultTrustedTimeStatusOK)
      return status;
  } else if (!(pair->live.state == AncTrustedTimeFrameStatePending &&
               pair->live.generation == generation &&
               pair->live.floorMilliseconds == floor)) {
    status = [self writeFrame:pending
                      service:AncPrivateVaultTrustedTimeService
                          add:NO];
    if (status != AncPrivateVaultTrustedTimeStatusOK)
      return status;
  }
  status = [self writeFrame:stable
                    service:AncPrivateVaultTrustedTimeService
                        add:NO];
  if (status != AncPrivateVaultTrustedTimeStatusOK)
    return status;
  return [self writeFrame:stable
                  service:AncPrivateVaultTrustedTimeHighWaterService
                      add:NO];
}

- (AncPrivateVaultTrustedTimeStatus)
    observeSystemMilliseconds:(uint64_t)systemMilliseconds
         trustedMilliseconds:(uint64_t *)trustedMilliseconds {
  if (trustedMilliseconds != NULL)
    *trustedMilliseconds = 0;
  if (systemMilliseconds == 0 || systemMilliseconds > kMaximumSafeInteger ||
      trustedMilliseconds == NULL)
    return AncPrivateVaultTrustedTimeStatusInvalid;
  __block AncPrivateVaultTrustedTimeStatus status;
  dispatch_sync(self.queue, ^{
    AncTrustedTimePair pair;
    status = [self readPair:&pair];
    if (status != AncPrivateVaultTrustedTimeStatusOK)
      return;
    if (pair.absent || pair.liveAbsent ||
        pair.live.state == AncTrustedTimeFrameStatePending ||
        pair.high.state == AncTrustedTimeFrameStatePending) {
      uint64_t generation = pair.absent ? 1 : pair.high.generation;
      uint64_t floor = pair.absent ? systemMilliseconds
                                   : pair.high.floorMilliseconds;
      status = [self stabilizeGeneration:generation floor:floor pair:&pair];
      if (status != AncPrivateVaultTrustedTimeStatusOK)
        return;
      memset(&pair, 0, sizeof pair);
      status = [self readPair:&pair];
      if (status != AncPrivateVaultTrustedTimeStatusOK)
        return;
    }
    if (pair.live.state != AncTrustedTimeFrameStateStable ||
        pair.high.state != AncTrustedTimeFrameStateStable ||
        pair.live.generation != pair.high.generation ||
        pair.live.floorMilliseconds != pair.high.floorMilliseconds) {
      status = AncPrivateVaultTrustedTimeStatusRollbackDetected;
      return;
    }
    if (systemMilliseconds < pair.live.floorMilliseconds) {
      status = AncPrivateVaultTrustedTimeStatusRollbackDetected;
      return;
    }
    if (systemMilliseconds > pair.live.floorMilliseconds) {
      if (pair.live.generation == UINT64_MAX) {
        status = AncPrivateVaultTrustedTimeStatusFailed;
        return;
      }
      NSData *pending = AncTrustedTimeEncode(
          AncTrustedTimeFrameStatePending, pair.live.generation + 1,
          systemMilliseconds);
      status = pending == nil
                   ? AncPrivateVaultTrustedTimeStatusInvalid
                   : [self writeFrame:pending
                               service:
                                   AncPrivateVaultTrustedTimeHighWaterService
                                   add:NO];
      if (status != AncPrivateVaultTrustedTimeStatusOK)
        return;
      AncTrustedTimePair advancing = pair;
      advancing.high.state = AncTrustedTimeFrameStatePending;
      advancing.high.generation = pair.live.generation + 1;
      advancing.high.floorMilliseconds = systemMilliseconds;
      status = [self stabilizeGeneration:advancing.high.generation
                                   floor:systemMilliseconds
                                    pair:&advancing];
      if (status != AncPrivateVaultTrustedTimeStatusOK)
        return;
    }
    *trustedMilliseconds = systemMilliseconds;
  });
  return status;
}

@end
