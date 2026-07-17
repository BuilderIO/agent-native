#import "PrivateVaultGuardedMemory.h"

#import <sodium.h>

static void *AncPrivateVaultSodiumMalloc(size_t size) {
  return sodium_malloc(size);
}

static int AncPrivateVaultSodiumMLock(void *memory, size_t size) {
  return sodium_mlock(memory, size);
}

static int AncPrivateVaultSodiumNoAccess(void *memory, __unused size_t size) {
  return sodium_mprotect_noaccess(memory);
}

static int AncPrivateVaultSodiumReadWrite(void *memory, __unused size_t size) {
  return sodium_mprotect_readwrite(memory);
}

static void AncPrivateVaultSodiumMemzero(void *memory, size_t size) {
  sodium_memzero(memory, size);
}

static void AncPrivateVaultSodiumFree(void *memory) { sodium_free(memory); }

@implementation AncPrivateVaultGuardedMemory {
  NSLock *_lock;
  void *_memory;
  size_t _length;
  BOOL _closed;
  AncPrivateVaultGuardedMemoryFunctions _functions;
}

+ (instancetype)memoryWithLength:(size_t)length
                          status:(AncPrivateVaultGuardedMemoryStatus *)status {
  if (sodium_init() < 0) {
    if (status != NULL)
      *status = AncPrivateVaultGuardedMemoryStatusAllocationFailed;
    return nil;
  }
  const AncPrivateVaultGuardedMemoryFunctions functions = {
      .malloc_fn = AncPrivateVaultSodiumMalloc,
      .mlock_fn = AncPrivateVaultSodiumMLock,
      .mprotect_noaccess_fn = AncPrivateVaultSodiumNoAccess,
      .mprotect_readwrite_fn = AncPrivateVaultSodiumReadWrite,
      .memzero_fn = AncPrivateVaultSodiumMemzero,
      .free_fn = AncPrivateVaultSodiumFree,
  };
  return [self memoryWithLength:length functions:&functions status:status];
}

+ (instancetype)
    memoryWithLength:(size_t)length
           functions:(const AncPrivateVaultGuardedMemoryFunctions *)functions
              status:(AncPrivateVaultGuardedMemoryStatus *)status {
  if (status != NULL) *status = AncPrivateVaultGuardedMemoryStatusInvalid;
  if (length == 0 || functions == NULL || functions->malloc_fn == NULL ||
      functions->mlock_fn == NULL ||
      functions->mprotect_noaccess_fn == NULL ||
      functions->mprotect_readwrite_fn == NULL ||
      functions->memzero_fn == NULL || functions->free_fn == NULL) {
    return nil;
  }
  void *memory = functions->malloc_fn(length);
  if (memory == NULL) {
    if (status != NULL)
      *status = AncPrivateVaultGuardedMemoryStatusAllocationFailed;
    return nil;
  }
  if (functions->mlock_fn(memory, length) != 0) {
    functions->memzero_fn(memory, length);
    functions->free_fn(memory);
    if (status != NULL)
      *status = AncPrivateVaultGuardedMemoryStatusProtectionFailed;
    return nil;
  }
  if (functions->mprotect_noaccess_fn(memory, length) != 0) {
    functions->free_fn(memory);
    if (status != NULL)
      *status = AncPrivateVaultGuardedMemoryStatusProtectionFailed;
    return nil;
  }
  AncPrivateVaultGuardedMemory *result = [[self alloc] init];
  result->_lock = [[NSLock alloc] init];
  result->_memory = memory;
  result->_length = length;
  result->_closed = NO;
  result->_functions = *functions;
  if (status != NULL) *status = AncPrivateVaultGuardedMemoryStatusOK;
  return result;
}

- (void)dealloc { [self close]; }

- (size_t)length {
  [_lock lock];
  const size_t value = _length;
  [_lock unlock];
  return value;
}

- (BOOL)isClosed {
  [_lock lock];
  const BOOL value = _closed;
  [_lock unlock];
  return value;
}

- (AncPrivateVaultGuardedMemoryStatus)
    borrow:(AncPrivateVaultGuardedMemoryBorrowBlock)block {
  if (block == nil) return AncPrivateVaultGuardedMemoryStatusInvalid;
  [_lock lock];
  if (_closed) {
    [_lock unlock];
    return AncPrivateVaultGuardedMemoryStatusClosed;
  }
  if (_functions.mprotect_readwrite_fn(_memory, _length) != 0) {
    _functions.free_fn(_memory);
    _memory = NULL;
    _length = 0;
    _closed = YES;
    [_lock unlock];
    return AncPrivateVaultGuardedMemoryStatusProtectionFailed;
  }
  BOOL callback_succeeded = NO;
  @try {
    callback_succeeded = block(_memory, _length);
  } @catch (__unused NSException *exception) {
    callback_succeeded = NO;
  }
  if (_functions.mprotect_noaccess_fn(_memory, _length) != 0) {
    if (_functions.mprotect_readwrite_fn(_memory, _length) == 0) {
      _functions.memzero_fn(_memory, _length);
    }
    _functions.free_fn(_memory);
    _memory = NULL;
    _length = 0;
    _closed = YES;
    [_lock unlock];
    return AncPrivateVaultGuardedMemoryStatusProtectionFailed;
  }
  [_lock unlock];
  return callback_succeeded ? AncPrivateVaultGuardedMemoryStatusOK
                            : AncPrivateVaultGuardedMemoryStatusCallbackFailed;
}

- (AncPrivateVaultGuardedMemoryStatus)close {
  [_lock lock];
  if (_closed) {
    [_lock unlock];
    return AncPrivateVaultGuardedMemoryStatusOK;
  }
  if (_functions.mprotect_readwrite_fn(_memory, _length) != 0) {
    _functions.free_fn(_memory);
    _memory = NULL;
    _length = 0;
    _closed = YES;
    [_lock unlock];
    return AncPrivateVaultGuardedMemoryStatusProtectionFailed;
  }
  _functions.memzero_fn(_memory, _length);
  _functions.free_fn(_memory);
  _memory = NULL;
  _length = 0;
  _closed = YES;
  [_lock unlock];
  return AncPrivateVaultGuardedMemoryStatusOK;
}

@end
