#import "PrivateVaultGenesisLock.h"

static NSString *AncPrivateVaultCanonicalGenesisVaultId(NSString *vaultId) {
  if (vaultId == nil)
    return nil;
  @try {
    NSData *encoded =
        [vaultId dataUsingEncoding:NSASCIIStringEncoding
              allowLossyConversion:NO];
    if (encoded.length != 32)
      return nil;
    const uint8_t *bytes = encoded.bytes;
    for (NSUInteger index = 0; index < encoded.length; index++) {
      const uint8_t character = bytes[index];
      if (!((character >= '0' && character <= '9') ||
            (character >= 'a' && character <= 'f')))
        return nil;
    }
    return [[NSString alloc] initWithBytes:bytes
                                    length:encoded.length
                                  encoding:NSASCIIStringEncoding];
  } @catch (__unused NSException *exception) {
    return nil;
  }
}

NSRecursiveLock *AncPrivateVaultGenesisLockForVaultId(NSString *vaultId) {
  NSString *canonicalVaultId =
      AncPrivateVaultCanonicalGenesisVaultId(vaultId);
  if (canonicalVaultId == nil)
    return nil;

  static NSMapTable<NSString *, NSRecursiveLock *> *locks;
  static dispatch_queue_t registryQueue;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    /* The caller keeps the returned lock alive for the whole critical
     * section. Weak values prevent attacker-chosen, otherwise valid vault ids
     * from turning this process-wide registry into an unbounded memory sink. */
    locks = [NSMapTable strongToWeakObjectsMapTable];
    registryQueue = dispatch_queue_create(
        "com.agentnative.private-vault.genesis-lock-registry",
        DISPATCH_QUEUE_SERIAL);
  });

  __block NSRecursiveLock *lock = nil;
  dispatch_sync(registryQueue, ^{
    lock = [locks objectForKey:canonicalVaultId];
    if (lock == nil) {
      lock = [NSRecursiveLock new];
      lock.name = [@"com.agentnative.private-vault.genesis."
          stringByAppendingString:canonicalVaultId];
      [locks setObject:lock forKey:canonicalVaultId];
    }
  });
  return lock;
}
