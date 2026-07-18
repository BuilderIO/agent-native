#import "PrivateVaultBootstrapFrame.h"

#include <stdio.h>

#define CHECK(condition) do { if (!(condition)) { fprintf(stderr, "CHECK failed at %s:%d: %s\n", __FILE__, __LINE__, #condition); abort(); } } while (0)

static NSData *Frame(NSMutableDictionary *metadata, NSArray<NSData *> *parts) {
  NSError *error = nil;
  NSData *control = [NSJSONSerialization dataWithJSONObject:metadata options:0 error:&error];
  CHECK(error == nil && control.length > 0);
  uint32_t length = (uint32_t)control.length;
  uint8_t prefix[4] = {(uint8_t)(length >> 24), (uint8_t)(length >> 16),
                       (uint8_t)(length >> 8), (uint8_t)length};
  NSMutableData *result = [NSMutableData dataWithBytes:prefix length:4];
  [result appendData:control];
  for (NSData *part in parts) [result appendData:part];
  return result;
}

static NSMutableDictionary *Metadata(void) {
  return [@{
    @"version" : @1,
    @"suite" : @"anc/v1",
    @"type" : @"vault-bootstrap-response",
    @"vaultId" : @"11111111111111111111111111111111",
    @"afterSequence" : @(-1),
    @"throughSequence" : @0,
    @"head" : [@{@"sequence" : @0, @"hash" : [@"ab" stringByPaddingToLength:64 withString:@"ab" startingAtIndex:0]} mutableCopy],
    @"complete" : @YES,
    @"entryByteLengths" : [@[@3] mutableCopy],
    @"entryRecoveryWrapByteLengths" : [@[@2] mutableCopy],
    @"entryEvidenceKinds" : [@[@"genesis"] mutableCopy],
    @"entryEvidenceByteLengths" : [@[@4] mutableCopy],
    @"recoveryWrapHash" : [@"cd" stringByPaddingToLength:64 withString:@"cd" startingAtIndex:0],
    @"recoveryWrapByteLength" : @2,
  } mutableCopy];
}

int main(void) {
  @autoreleasepool {
    NSArray *parts = @[[NSData dataWithBytes:"ent" length:3],
                       [NSData dataWithBytes:"wr" length:2],
                       [NSData dataWithBytes:"evid" length:4],
                       [NSData dataWithBytes:"cw" length:2]];
    AncPrivateVaultBootstrapFrameStatus status;
    NSData *encoded = Frame(Metadata(), parts);
    AncPrivateVaultBootstrapFrame *frame =
        AncPrivateVaultBootstrapFrameDecode(encoded, &status);
    CHECK(status == AncPrivateVaultBootstrapFrameStatusOK && frame != nil);
    CHECK(frame.afterSequence == -1 && frame.throughSequence == 0 &&
          frame.headSequence == 0 && frame.complete);
    CHECK(frame.entries.count == 1 && [frame.entries[0] isEqual:parts[0]]);
    CHECK([frame.entryRecoveryWraps[0] isEqual:parts[1]] &&
          [frame.entryEvidenceKinds[0] isEqual:@"genesis"] &&
          [frame.entryEvidence[0] isEqual:parts[2]] &&
          [frame.recoveryWrap isEqual:parts[3]]);

    CHECK(AncPrivateVaultBootstrapFrameDecode(
              [encoded subdataWithRange:NSMakeRange(0, encoded.length - 1)],
              &status) == nil && status == AncPrivateVaultBootstrapFrameStatusBounds);
    NSMutableDictionary *mismatch = Metadata();
    mismatch[@"entryEvidenceKinds"] = @[NSNull.null];
    CHECK(AncPrivateVaultBootstrapFrameDecode(Frame(mismatch, parts), &status) == nil);
    NSMutableDictionary *unknown = Metadata();
    unknown[@"surprise"] = @1;
    CHECK(AncPrivateVaultBootstrapFrameDecode(Frame(unknown, parts), &status) == nil);
    NSMutableDictionary *gap = Metadata();
    gap[@"throughSequence"] = @1;
    CHECK(AncPrivateVaultBootstrapFrameDecode(Frame(gap, parts), &status) == nil);
    puts("private-vault bootstrap frame tests passed");
  }
  return 0;
}
