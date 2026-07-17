#import <Foundation/Foundation.h>

#import "PrivateVaultAncCanonical.h"

#include <assert.h>
#include <math.h>

static NSData *Hex(NSString *hex) {
  NSMutableData *data = [NSMutableData data];
  for (NSUInteger index = 0; index < hex.length; index += 2) {
    unsigned value = 0;
    [[NSScanner scannerWithString:[hex substringWithRange:NSMakeRange(index, 2)]]
        scanHexInt:&value];
    uint8_t byte = (uint8_t)value;
    [data appendBytes:&byte length:1];
  }
  return data;
}

static void Reject(NSString *hex) {
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *value =
      AncPrivateVaultCanonicalDecode(Hex(hex), 64 * 1024, &status);
  if (value != nil || status == AncPrivateVaultCanonicalStatusOK)
    fprintf(stderr, "bad rejection state %ld: %s\n", (long)status, hex.UTF8String);
  assert(value == nil);
  assert(status != AncPrivateVaultCanonicalStatusOK);
}

static void TestRoundTrip(void) {
  AncPrivateVaultCanonicalValue *value = [AncPrivateVaultCanonicalValue map:@{
    @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
    @2 : [AncPrivateVaultCanonicalValue bytes:Hex(@"001122")],
    @24 : [AncPrivateVaultCanonicalValue array:@[
      [AncPrivateVaultCanonicalValue boolean:YES],
      [AncPrivateVaultCanonicalValue nullValue],
      [AncPrivateVaultCanonicalValue integer:-9007199254740991LL],
    ]],
  }];
  AncPrivateVaultCanonicalStatus status;
  NSData *encoded = AncPrivateVaultCanonicalEncode(value, &status);
  assert(encoded != nil && status == AncPrivateVaultCanonicalStatusOK);
  AncPrivateVaultCanonicalValue *decoded =
      AncPrivateVaultCanonicalDecode(encoded, 64 * 1024, &status);
  assert(decoded.type == AncPrivateVaultCanonicalTypeMap);
  assert([AncPrivateVaultCanonicalEncode(decoded, &status) isEqualToData:encoded]);
  assert([AncPrivateVaultCanonicalValue integer:9007199254740992LL] == nil);
}

static void TestRejectsForbiddenAndNonCanonical(void) {
  Reject(@"1817");
  Reject(@"1900ff");
  Reject(@"9ff6ff");
  Reject(@"bf01f6ff");
  Reject(@"f90000");
  Reject(@"fa00000000");
  Reject(@"f7");
  Reject(@"c100");
  Reject(@"a201000101");
  Reject(@"a21818000100");
  Reject(@"a1616100");
  Reject(@"61ff");
  Reject(@"f6f6");
  Reject(@"1b0020000000000000");
  Reject(@"3b001fffffffffffff");

  NSMutableData *deep = [NSMutableData data];
  uint8_t array = 0x81;
  for (NSUInteger index = 0; index < 33; index += 1)
    [deep appendBytes:&array length:1];
  uint8_t nullValue = 0xf6;
  [deep appendBytes:&nullValue length:1];
  AncPrivateVaultCanonicalStatus status;
  assert(AncPrivateVaultCanonicalDecode(deep, 64 * 1024, &status) == nil);

  NSMutableData *large = [NSMutableData dataWithLength:65 * 1024];
  assert(AncPrivateVaultCanonicalDecode(large, 64 * 1024, &status) == nil);
  assert(status == AncPrivateVaultCanonicalStatusTooLarge);
}

static void TestRejectsAmbiguousMapKeys(void) {
  NSArray<NSNumber *> *invalidKeys = @[@1.5, @(-1), @(UINT64_C(9007199254740992)),
                                       @(NAN), @YES];
  for (NSNumber *key in invalidKeys) {
    NSDictionary *candidate = @{key : [AncPrivateVaultCanonicalValue nullValue]};
    assert([AncPrivateVaultCanonicalValue map:candidate] == nil);

    AncPrivateVaultCanonicalValue *defensive = [AncPrivateVaultCanonicalValue map:@{
      @1 : [AncPrivateVaultCanonicalValue nullValue],
    }];
    [defensive setValue:candidate forKey:@"mapValue"];
    AncPrivateVaultCanonicalStatus status = AncPrivateVaultCanonicalStatusOK;
    assert(AncPrivateVaultCanonicalEncode(defensive, &status) == nil);
    assert(status == AncPrivateVaultCanonicalStatusInvalid);
  }
}

int main(void) {
  @autoreleasepool {
    TestRoundTrip();
    TestRejectsForbiddenAndNonCanonical();
    TestRejectsAmbiguousMapKeys();
    puts("private-vault strict anc canonical tests passed");
  }
  return 0;
}
