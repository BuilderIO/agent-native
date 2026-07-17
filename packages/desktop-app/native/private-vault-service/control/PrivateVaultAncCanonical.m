#import "PrivateVaultAncCanonical.h"

#include <string.h>

static const uint64_t kAncMaximumSafeInteger = UINT64_C(9007199254740991);
static const NSUInteger kAncMaximumDepth = 32;

static BOOL AncCanonicalMapKey(NSNumber *key, uint64_t *value) {
  if (![key isKindOfClass:[NSNumber class]] ||
      CFGetTypeID((__bridge CFTypeRef)key) == CFBooleanGetTypeID())
    return NO;
  const char *type = key.objCType;
  if (strcmp(type, @encode(char)) == 0 || strcmp(type, @encode(short)) == 0 ||
      strcmp(type, @encode(int)) == 0 || strcmp(type, @encode(long)) == 0 ||
      strcmp(type, @encode(long long)) == 0) {
    long long signedValue = key.longLongValue;
    if (signedValue < 0 || (uint64_t)signedValue > kAncMaximumSafeInteger) return NO;
    if (value != NULL) *value = (uint64_t)signedValue;
    return YES;
  }
  if (strcmp(type, @encode(unsigned char)) == 0 ||
      strcmp(type, @encode(unsigned short)) == 0 ||
      strcmp(type, @encode(unsigned int)) == 0 ||
      strcmp(type, @encode(unsigned long)) == 0 ||
      strcmp(type, @encode(unsigned long long)) == 0) {
    unsigned long long unsignedValue = key.unsignedLongLongValue;
    if (unsignedValue > kAncMaximumSafeInteger) return NO;
    if (value != NULL) *value = (uint64_t)unsignedValue;
    return YES;
  }
  return NO;
}

@interface AncPrivateVaultCanonicalValue ()
@property(nonatomic, readwrite) AncPrivateVaultCanonicalType type;
@property(nonatomic, readwrite) BOOL booleanValue;
@property(nonatomic, readwrite) int64_t integerValue;
@property(nonatomic, readwrite, nullable) NSString *textValue;
@property(nonatomic, readwrite, nullable) NSData *bytesValue;
@property(nonatomic, readwrite, nullable)
    NSArray<AncPrivateVaultCanonicalValue *> *arrayValue;
@property(nonatomic, readwrite, nullable)
    NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *mapValue;
@end

@implementation AncPrivateVaultCanonicalValue

+ (instancetype)nullValue {
  AncPrivateVaultCanonicalValue *value = [[self alloc] init];
  value.type = AncPrivateVaultCanonicalTypeNull;
  return value;
}

+ (instancetype)boolean:(BOOL)input {
  AncPrivateVaultCanonicalValue *value = [[self alloc] init];
  value.type = AncPrivateVaultCanonicalTypeBoolean;
  value.booleanValue = input;
  return value;
}

+ (instancetype)integer:(int64_t)input {
  if (input > (int64_t)kAncMaximumSafeInteger ||
      input < -(int64_t)kAncMaximumSafeInteger)
    return nil;
  AncPrivateVaultCanonicalValue *value = [[self alloc] init];
  value.type = AncPrivateVaultCanonicalTypeInteger;
  value.integerValue = input;
  return value;
}

+ (instancetype)text:(NSString *)input {
  AncPrivateVaultCanonicalValue *value = [[self alloc] init];
  value.type = AncPrivateVaultCanonicalTypeText;
  value.textValue = [input copy];
  return value;
}

+ (instancetype)bytes:(NSData *)input {
  AncPrivateVaultCanonicalValue *value = [[self alloc] init];
  value.type = AncPrivateVaultCanonicalTypeBytes;
  value.bytesValue = [input copy];
  return value;
}

+ (instancetype)array:(NSArray<AncPrivateVaultCanonicalValue *> *)input {
  AncPrivateVaultCanonicalValue *value = [[self alloc] init];
  value.type = AncPrivateVaultCanonicalTypeArray;
  value.arrayValue = [input copy];
  return value;
}

+ (instancetype)
    map:(NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *)input {
  for (NSNumber *key in input) {
    if (!AncCanonicalMapKey(key, NULL)) return nil;
  }
  AncPrivateVaultCanonicalValue *value = [[self alloc] init];
  value.type = AncPrivateVaultCanonicalTypeMap;
  value.mapValue = [input copy];
  return value;
}

@end

typedef struct AncCanonicalCursor {
  const uint8_t *bytes;
  NSUInteger length;
  NSUInteger offset;
  AncPrivateVaultCanonicalStatus status;
} AncCanonicalCursor;

static BOOL AncReadBytes(AncCanonicalCursor *cursor, NSUInteger count,
                         const uint8_t **bytes) {
  if (count > cursor->length - cursor->offset) {
    cursor->status = AncPrivateVaultCanonicalStatusInvalid;
    return NO;
  }
  *bytes = cursor->bytes + cursor->offset;
  cursor->offset += count;
  return YES;
}

static BOOL AncReadArgument(AncCanonicalCursor *cursor, uint8_t info,
                            uint64_t *argument) {
  const uint8_t *bytes = NULL;
  if (info < 24) {
    *argument = info;
    return YES;
  }
  NSUInteger count = info == 24 ? 1 : info == 25 ? 2 : info == 26 ? 4 :
                                                      info == 27 ? 8 : 0;
  if (count == 0) {
    cursor->status = AncPrivateVaultCanonicalStatusInvalid;
    return NO;
  }
  if (!AncReadBytes(cursor, count, &bytes)) return NO;
  uint64_t value = 0;
  for (NSUInteger index = 0; index < count; index += 1)
    value = (value << 8) | bytes[index];
  uint64_t minimum = count == 1 ? 24 : count == 2 ? 256 :
                                      count == 4 ? UINT64_C(65536) :
                                                   UINT64_C(4294967296);
  if (value < minimum) {
    cursor->status = AncPrivateVaultCanonicalStatusNonCanonical;
    return NO;
  }
  *argument = value;
  return YES;
}

static AncPrivateVaultCanonicalValue *_Nullable AncParseValue(
    AncCanonicalCursor *cursor, NSUInteger depth) {
  if (depth > kAncMaximumDepth || cursor->offset >= cursor->length) {
    cursor->status = AncPrivateVaultCanonicalStatusInvalid;
    return nil;
  }
  uint8_t initial = cursor->bytes[cursor->offset++];
  uint8_t major = initial >> 5;
  uint8_t info = initial & 0x1f;
  if (major == 7) {
    if (info == 20) return [AncPrivateVaultCanonicalValue boolean:NO];
    if (info == 21) return [AncPrivateVaultCanonicalValue boolean:YES];
    if (info == 22) return [AncPrivateVaultCanonicalValue nullValue];
    cursor->status = AncPrivateVaultCanonicalStatusInvalid;
    return nil;
  }
  uint64_t argument = 0;
  if (!AncReadArgument(cursor, info, &argument)) return nil;
  if (major == 0 || major == 1) {
    if ((major == 0 && argument > kAncMaximumSafeInteger) ||
        (major == 1 && argument >= kAncMaximumSafeInteger)) {
      cursor->status = AncPrivateVaultCanonicalStatusInvalid;
      return nil;
    }
    int64_t integer = major == 0 ? (int64_t)argument : -1 - (int64_t)argument;
    return [AncPrivateVaultCanonicalValue integer:integer];
  }
  if (major == 2 || major == 3) {
    if (argument > NSUIntegerMax) {
      cursor->status = AncPrivateVaultCanonicalStatusInvalid;
      return nil;
    }
    const uint8_t *bytes = NULL;
    if (!AncReadBytes(cursor, (NSUInteger)argument, &bytes)) return nil;
    NSData *data = [NSData dataWithBytes:bytes length:(NSUInteger)argument];
    if (major == 2) return [AncPrivateVaultCanonicalValue bytes:data];
    NSString *text = [[NSString alloc] initWithData:data
                                           encoding:NSUTF8StringEncoding];
    if (text == nil ||
        ![[text dataUsingEncoding:NSUTF8StringEncoding] isEqualToData:data]) {
      cursor->status = AncPrivateVaultCanonicalStatusInvalid;
      return nil;
    }
    return [AncPrivateVaultCanonicalValue text:text];
  }
  if (major == 4) {
    if (argument > cursor->length - cursor->offset) {
      cursor->status = AncPrivateVaultCanonicalStatusInvalid;
      return nil;
    }
    NSMutableArray *values = [NSMutableArray arrayWithCapacity:(NSUInteger)argument];
    for (uint64_t index = 0; index < argument; index += 1) {
      AncPrivateVaultCanonicalValue *value = AncParseValue(cursor, depth + 1);
      if (value == nil) return nil;
      [values addObject:value];
    }
    return [AncPrivateVaultCanonicalValue array:values];
  }
  if (major == 5) {
    if (argument > (cursor->length - cursor->offset) / 2) {
      cursor->status = AncPrivateVaultCanonicalStatusInvalid;
      return nil;
    }
    NSMutableDictionary *values = [NSMutableDictionary dictionaryWithCapacity:(NSUInteger)argument];
    for (uint64_t index = 0; index < argument; index += 1) {
      AncPrivateVaultCanonicalValue *key = AncParseValue(cursor, depth + 1);
      if (key.type != AncPrivateVaultCanonicalTypeInteger ||
          key.integerValue < 0) {
        cursor->status = AncPrivateVaultCanonicalStatusInvalid;
        return nil;
      }
      NSNumber *number = @(key.integerValue);
      if (values[number] != nil) {
        cursor->status = AncPrivateVaultCanonicalStatusInvalid;
        return nil;
      }
      AncPrivateVaultCanonicalValue *value = AncParseValue(cursor, depth + 1);
      if (value == nil) return nil;
      values[number] = value;
    }
    return [AncPrivateVaultCanonicalValue map:values];
  }
  cursor->status = AncPrivateVaultCanonicalStatusInvalid;
  return nil;
}

static void AncAppendArgument(NSMutableData *output, uint8_t major,
                              uint64_t argument) {
  uint8_t bytes[9];
  NSUInteger count = 1;
  if (argument < 24) {
    bytes[0] = (uint8_t)((major << 5) | argument);
  } else {
    NSUInteger width = argument <= UINT8_MAX ? 1 : argument <= UINT16_MAX ? 2 :
                       argument <= UINT32_MAX ? 4 : 8;
    bytes[0] = (uint8_t)((major << 5) |
                         (width == 1 ? 24 : width == 2 ? 25 :
                                           width == 4 ? 26 : 27));
    count += width;
    for (NSUInteger index = 0; index < width; index += 1)
      bytes[width - index] = (uint8_t)(argument >> (index * 8));
  }
  [output appendBytes:bytes length:count];
}

static BOOL AncEncodeValue(AncPrivateVaultCanonicalValue *value,
                           NSMutableData *output, NSUInteger depth) {
  if (value == nil || depth > kAncMaximumDepth) return NO;
  switch (value.type) {
    case AncPrivateVaultCanonicalTypeNull: {
      uint8_t byte = 0xf6;
      [output appendBytes:&byte length:1];
      return YES;
    }
    case AncPrivateVaultCanonicalTypeBoolean: {
      uint8_t byte = value.booleanValue ? 0xf5 : 0xf4;
      [output appendBytes:&byte length:1];
      return YES;
    }
    case AncPrivateVaultCanonicalTypeInteger:
      if (value.integerValue >= 0)
        AncAppendArgument(output, 0, (uint64_t)value.integerValue);
      else
        AncAppendArgument(output, 1, (uint64_t)(-1 - value.integerValue));
      return YES;
    case AncPrivateVaultCanonicalTypeText: {
      NSData *data = [value.textValue dataUsingEncoding:NSUTF8StringEncoding];
      if (data == nil) return NO;
      AncAppendArgument(output, 3, data.length);
      [output appendData:data];
      return YES;
    }
    case AncPrivateVaultCanonicalTypeBytes:
      AncAppendArgument(output, 2, value.bytesValue.length);
      [output appendData:value.bytesValue];
      return YES;
    case AncPrivateVaultCanonicalTypeArray:
      AncAppendArgument(output, 4, value.arrayValue.count);
      for (AncPrivateVaultCanonicalValue *item in value.arrayValue)
        if (!AncEncodeValue(item, output, depth + 1)) return NO;
      return YES;
    case AncPrivateVaultCanonicalTypeMap: {
      for (NSNumber *key in value.mapValue)
        if (!AncCanonicalMapKey(key, NULL)) return NO;
      NSArray<NSNumber *> *keys = [value.mapValue.allKeys
          sortedArrayUsingComparator:^NSComparisonResult(NSNumber *left,
                                                         NSNumber *right) {
            return [left compare:right];
          }];
      AncAppendArgument(output, 5, keys.count);
      for (NSNumber *key in keys) {
        uint64_t integer = 0;
        if (!AncCanonicalMapKey(key, &integer)) return NO;
        AncAppendArgument(output, 0, integer);
        if (!AncEncodeValue(value.mapValue[key], output, depth + 1)) return NO;
      }
      return YES;
    }
  }
}

NSData *AncPrivateVaultCanonicalEncode(AncPrivateVaultCanonicalValue *value,
                                       AncPrivateVaultCanonicalStatus *status) {
  if (status != NULL) *status = AncPrivateVaultCanonicalStatusInvalid;
  NSMutableData *output = [NSMutableData data];
  if (!AncEncodeValue(value, output, 0)) return nil;
  if (status != NULL) *status = AncPrivateVaultCanonicalStatusOK;
  return output;
}

AncPrivateVaultCanonicalValue *AncPrivateVaultCanonicalDecode(
    NSData *data, NSUInteger maximumBytes,
    AncPrivateVaultCanonicalStatus *status) {
  if (status != NULL) *status = AncPrivateVaultCanonicalStatusInvalid;
  if (data.length == 0) return nil;
  if (data.length > maximumBytes) {
    if (status != NULL) *status = AncPrivateVaultCanonicalStatusTooLarge;
    return nil;
  }
  AncCanonicalCursor cursor = {.bytes = data.bytes,
                               .length = data.length,
                               .offset = 0,
                               .status = AncPrivateVaultCanonicalStatusOK};
  AncPrivateVaultCanonicalValue *value = AncParseValue(&cursor, 0);
  if (value == nil || cursor.offset != cursor.length) {
    if (status != NULL)
      *status = value == nil ? cursor.status
                             : AncPrivateVaultCanonicalStatusInvalid;
    return nil;
  }
  AncPrivateVaultCanonicalStatus encodedStatus;
  NSData *encoded = AncPrivateVaultCanonicalEncode(value, &encodedStatus);
  if (encoded == nil || ![encoded isEqualToData:data]) {
    if (status != NULL) *status = AncPrivateVaultCanonicalStatusNonCanonical;
    return nil;
  }
  if (status != NULL) *status = AncPrivateVaultCanonicalStatusOK;
  return value;
}
