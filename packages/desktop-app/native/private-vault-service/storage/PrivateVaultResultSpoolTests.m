#import <Foundation/Foundation.h>

#import "PrivateVaultResultSpool.h"

#include <assert.h>
#include <sys/stat.h>
#include <unistd.h>

static NSData *Pattern(uint8_t byte, NSUInteger length) {
  NSMutableData *data = [NSMutableData dataWithLength:length];
  memset(data.mutableBytes, byte, length);
  return data;
}

static NSString *BaseName(NSData *vaultId, NSData *jobId) {
  NSMutableString *name = [NSMutableString stringWithCapacity:64];
  for (NSData *part in @[ vaultId, jobId ]) {
    const uint8_t *bytes = part.bytes;
    for (NSUInteger index = 0; index < part.length; index += 1)
      [name appendFormat:@"%02x", bytes[index]];
  }
  return name;
}

int main(void) {
  @autoreleasepool {
    NSString *root = [NSTemporaryDirectory()
        stringByAppendingPathComponent:NSUUID.UUID.UUIDString];
    assert([[NSFileManager defaultManager] createDirectoryAtPath:root
                                      withIntermediateDirectories:NO
                                                       attributes:@{
                                                         NSFilePosixPermissions:
                                                             @0700
                                                       }
                                                            error:nil]);
    NSURL *rootURL = [NSURL fileURLWithPath:root];
    NSData *vaultId = Pattern(0x01, 16);
    NSData *jobId = Pattern(0x02, 16);
    NSData *envelope = Pattern(0x03, 4096);
    AncPrivateVaultResultSpool *spool =
        [[AncPrivateVaultResultSpool alloc] initWithStateRootURL:rootURL];
    assert([spool storeEnvelope:envelope vaultId:vaultId jobId:jobId] ==
           AncPrivateVaultResultSpoolStatusOK);
    NSData *loaded = nil;
    assert([spool loadEnvelopeForVaultId:vaultId jobId:jobId result:&loaded] ==
               AncPrivateVaultResultSpoolStatusOK &&
           [loaded isEqualToData:envelope]);
    assert([spool storeEnvelope:envelope vaultId:vaultId jobId:jobId] ==
           AncPrivateVaultResultSpoolStatusOK);
    assert([spool storeEnvelope:Pattern(0x04, 4096)
                        vaultId:vaultId jobId:jobId] ==
           AncPrivateVaultResultSpoolStatusConflict);
    assert([spool deleteEnvelope:Pattern(0x04, 4096)
                         vaultId:vaultId jobId:jobId] ==
           AncPrivateVaultResultSpoolStatusConflict);
    assert([spool deleteEnvelope:envelope vaultId:vaultId jobId:jobId] ==
           AncPrivateVaultResultSpoolStatusOK);
    assert([spool loadEnvelopeForVaultId:vaultId jobId:jobId result:&loaded] ==
           AncPrivateVaultResultSpoolStatusNotFound);

    NSString *directory = [root stringByAppendingPathComponent:@"state/result-spool"];
    NSString *base = BaseName(vaultId, jobId);
    NSString *stage = [directory stringByAppendingPathComponent:
        [base stringByAppendingString:@".result.stage"]];
    assert([envelope writeToFile:stage atomically:NO]);
    assert(chmod(stage.fileSystemRepresentation, 0600) == 0);
    AncPrivateVaultResultSpool *restarted =
        [[AncPrivateVaultResultSpool alloc] initWithStateRootURL:rootURL];
    assert([restarted loadEnvelopeForVaultId:vaultId jobId:jobId
                                      result:&loaded] ==
               AncPrivateVaultResultSpoolStatusOK &&
           [loaded isEqualToData:envelope] &&
           ![[NSFileManager defaultManager] fileExistsAtPath:stage]);
    NSString *live = [directory stringByAppendingPathComponent:
        [base stringByAppendingString:@".result"]];
    assert(chmod(live.fileSystemRepresentation, 0644) == 0);
    assert([restarted loadEnvelopeForVaultId:vaultId jobId:jobId
                                      result:&loaded] ==
           AncPrivateVaultResultSpoolStatusStorageFailed);
    assert(chmod(live.fileSystemRepresentation, 0600) == 0);
    assert([[NSFileManager defaultManager] removeItemAtPath:live error:nil]);
    assert(symlink("/dev/null", live.fileSystemRepresentation) == 0);
    assert([restarted loadEnvelopeForVaultId:vaultId jobId:jobId
                                      result:&loaded] ==
           AncPrivateVaultResultSpoolStatusStorageFailed);
    assert([[NSFileManager defaultManager] removeItemAtPath:root error:nil]);
  }
  return 0;
}
