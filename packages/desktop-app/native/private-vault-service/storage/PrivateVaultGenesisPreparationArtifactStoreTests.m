#import <Foundation/Foundation.h>

#import "PrivateVaultGenesisPreparationArtifactStore.h"

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#define CHECK(condition, message)                                              \
  do {                                                                         \
    if (!(condition)) {                                                        \
      fprintf(stderr, "FAIL: %s\n", message);                                 \
      exit(1);                                                                 \
    }                                                                          \
  } while (0)

@interface AncThrowingData : NSObject
@end
@implementation AncThrowingData
- (NSUInteger)length { return 1; }
- (void)getBytes:(void *)buffer length:(NSUInteger)length {
  (void)buffer;
  (void)length;
  @throw [NSException exceptionWithName:@"hostile" reason:nil userInfo:nil];
}
@end

@interface AncChangingLengthData : NSObject
@property(nonatomic) NSUInteger reads;
@end
@implementation AncChangingLengthData
- (NSUInteger)length { return ++self.reads == 1 ? 1 : 2; }
- (void)getBytes:(void *)buffer length:(NSUInteger)length {
  memset(buffer, 'x', length);
}
@end

static NSURL *SecureRoot(void) {
  NSString *path = [NSTemporaryDirectory()
      stringByAppendingPathComponent:[NSString
                                         stringWithFormat:@"anc-genesis-%@",
                                                          NSUUID.UUID.UUIDString]];
  CHECK(mkdir(path.fileSystemRepresentation, 0700) == 0, "create test root");
  return [NSURL fileURLWithPath:path isDirectory:YES];
}

static NSString *Hex(const uint8_t lookup[16]) {
  static const char digits[] = "0123456789abcdef";
  char output[33] = {0};
  for (size_t index = 0; index < 16; index++) {
    output[index * 2] = digits[lookup[index] >> 4];
    output[index * 2 + 1] = digits[lookup[index] & 15];
  }
  return @(output);
}

static NSString *ArtifactDirectory(NSURL *root) {
  return [root.path stringByAppendingPathComponent:
                        @"genesis-preparation-artifacts"];
}

static AncPrivateVaultGenesisPreparationArtifactStatus Stage(
    AncPrivateVaultGenesisPreparationArtifactStore *store,
    const uint8_t lookup[16], uint8_t digest[32], NSData *wrap) {
  uint8_t vault[16];
  uint8_t ceremony[16];
  memset(vault, 2, sizeof(vault));
  memset(ceremony, 3, sizeof(ceremony));
  return [store stageLookupId:lookup
                      vaultId:vault
                   ceremonyId:ceremony
                   generation:2
                 recoveryWrap:wrap
                 confirmation:[@"confirmation" dataUsingEncoding:NSUTF8StringEncoding]
                    bootstrap:[@"bootstrap" dataUsingEncoding:NSUTF8StringEncoding]
                authorization:[@"authorization" dataUsingEncoding:NSUTF8StringEncoding]
                       digest:digest];
}

int main(void) {
  @autoreleasepool {
    NSURL *root = SecureRoot();
    AncPrivateVaultGenesisPreparationArtifactStore *store =
        [[AncPrivateVaultGenesisPreparationArtifactStore alloc]
            initWithStateRootURL:root];
    CHECK(store != nil, "open hardened artifact store");
    uint8_t lookup[16];
    memset(lookup, 1, sizeof(lookup));
    uint8_t digest[32] = {0};
    NSData *wrap = [@"wrap" dataUsingEncoding:NSUTF8StringEncoding];
    CHECK(Stage(store, lookup, digest, wrap) ==
              AncPrivateVaultGenesisPreparationArtifactStatusOK,
          "stage artifact frame");
    uint8_t repeatedDigest[32] = {0};
    CHECK(Stage(store, lookup, repeatedDigest, wrap) ==
                  AncPrivateVaultGenesisPreparationArtifactStatusOK &&
              memcmp(digest, repeatedDigest, 32) == 0,
          "exact stage retry is idempotent");
    CHECK([store promoteLookupId:lookup expectedDigest:digest] ==
              AncPrivateVaultGenesisPreparationArtifactStatusOK,
          "promote artifact frame");
    CHECK([store reconcileLookupId:lookup expectedDigest:digest] ==
              AncPrivateVaultGenesisPreparationArtifactStatusOK,
          "live-only reconciliation");
    uint8_t vault[16];
    uint8_t ceremony[16];
    memset(vault, 2, sizeof(vault));
    memset(ceremony, 3, sizeof(ceremony));
    __block BOOL consumed = NO;
    CHECK([store readLiveLookupId:lookup
                         vaultId:vault
                      ceremonyId:ceremony
                      generation:2
                  expectedDigest:digest
                         consumer:^BOOL(const uint8_t *recoveryWrap,
                                        size_t recoveryWrapLength,
                                        const uint8_t *confirmation,
                                        size_t confirmationLength,
                                        const uint8_t *bootstrap,
                                        size_t bootstrapLength,
                                        const uint8_t *authorization,
                                        size_t authorizationLength) {
                           consumed = recoveryWrapLength == wrap.length &&
                                      memcmp(recoveryWrap, wrap.bytes,
                                             recoveryWrapLength) == 0 &&
                                      confirmationLength > 0 &&
                                      bootstrapLength > 0 &&
                                      authorizationLength > 0 &&
                                      confirmation != NULL && bootstrap != NULL &&
                                      authorization != NULL;
                           return YES;
                         }] ==
                  AncPrivateVaultGenesisPreparationArtifactStatusOK &&
              consumed,
          "read exact immutable generation-two artifact");
    CHECK([store readLiveLookupId:lookup
                         vaultId:vault
                      ceremonyId:ceremony
                      generation:3
                  expectedDigest:digest
                         consumer:^BOOL(const uint8_t *w, size_t wl,
                                        const uint8_t *c, size_t cl,
                                        const uint8_t *b, size_t bl,
                                        const uint8_t *a, size_t al) {
                           (void)w; (void)wl; (void)c; (void)cl;
                           (void)b; (void)bl; (void)a; (void)al;
                           return YES;
                         }] ==
              AncPrivateVaultGenesisPreparationArtifactStatusInvalid,
          "later record generation cannot replace confirmation generation");

    uint8_t hostileLookup[16];
    memset(hostileLookup, 4, sizeof(hostileLookup));
    uint8_t hostileDigest[32];
    CHECK(Stage(store, hostileLookup, hostileDigest,
                (NSData *)[[AncThrowingData alloc] init]) ==
              AncPrivateVaultGenesisPreparationArtifactStatusInvalid,
          "hostile getBytes exception rejected");
    CHECK(Stage(store, hostileLookup, hostileDigest,
                (NSData *)[[AncChangingLengthData alloc] init]) ==
              AncPrivateVaultGenesisPreparationArtifactStatusInvalid,
          "hostile changing length rejected");

    uint8_t ambiguousLookup[16];
    memset(ambiguousLookup, 5, sizeof(ambiguousLookup));
    __block BOOL faulted = NO;
    AncPrivateVaultGenesisPreparationArtifactSetFaultHookForTesting(
        ^BOOL(AncPrivateVaultGenesisPreparationArtifactFaultPoint point) {
          if (!faulted &&
              point ==
                  AncPrivateVaultGenesisPreparationArtifactFaultAfterStageRename) {
            faulted = YES;
            return YES;
          }
          return NO;
        });
    CHECK(Stage(store, ambiguousLookup, hostileDigest, wrap) ==
              AncPrivateVaultGenesisPreparationArtifactStatusStorageFailed,
          "rename-committed fault is reported ambiguous");
    AncPrivateVaultGenesisPreparationArtifactSetFaultHookForTesting(nil);
    CHECK(Stage(store, ambiguousLookup, hostileDigest, wrap) ==
              AncPrivateVaultGenesisPreparationArtifactStatusOK,
          "exact retry reconciles committed rename");

    CHECK([store createPreparationIndexLookupId:lookup
                                    preparedAtMs:1000
                                     expiresAtMs:2000] ==
              AncPrivateVaultGenesisPreparationArtifactStatusOK,
          "create preparation marker");
    CHECK([store createPreparationIndexLookupId:lookup
                                    preparedAtMs:1000
                                     expiresAtMs:2000] ==
              AncPrivateVaultGenesisPreparationArtifactStatusOK,
          "exact marker retry is idempotent");
    CHECK([store createPreparationIndexLookupId:lookup
                                    preparedAtMs:1001
                                     expiresAtMs:2000] ==
              AncPrivateVaultGenesisPreparationArtifactStatusConflict,
          "different existing marker conflicts");
    CHECK([store createPreparationIndexLookupId:hostileLookup
                                    preparedAtMs:UINT64_C(9007199254740992)
                                     expiresAtMs:UINT64_C(9007199254740993)] ==
              AncPrivateVaultGenesisPreparationArtifactStatusInvalid,
          "marker rejects unsafe integer timestamps");
    NSArray<NSData *> *listed = nil;
    CHECK([store listPreparationLookupIds:&listed] ==
                  AncPrivateVaultGenesisPreparationArtifactStatusOK &&
              listed.count == 1 &&
              [listed[0] isEqualToData:[NSData dataWithBytes:lookup length:16]],
          "strict marker discovery");

    NSString *directory = ArtifactDirectory(root);
    NSString *validTemp = [directory
        stringByAppendingPathComponent:[NSString
                                           stringWithFormat:
                                               @"%@.stage.tmp-%@", Hex(lookup),
                                               NSUUID.UUID.UUIDString.lowercaseString]];
    CHECK([[NSData dataWithBytes:"x" length:1] writeToFile:validTemp
                                                   atomically:NO],
          "write stale strict temp");
    chmod(validTemp.fileSystemRepresentation, 0600);
    store = nil;
    store = [[AncPrivateVaultGenesisPreparationArtifactStore alloc]
        initWithStateRootURL:root];
    CHECK(store != nil && ![[NSFileManager defaultManager] fileExistsAtPath:validTemp],
          "strict stale temp cleaned on startup");
    CHECK([store listPreparationLookupIds:&listed] ==
                  AncPrivateVaultGenesisPreparationArtifactStatusOK &&
              listed.count == 1 &&
              [store listPreparationLookupIds:&listed] ==
                  AncPrivateVaultGenesisPreparationArtifactStatusOK &&
              listed.count == 1,
          "repeated marker discovery uses fresh directory descriptions");

    uint8_t secondLookup[16];
    memset(secondLookup, 9, sizeof(secondLookup));
    CHECK([store createPreparationIndexLookupId:secondLookup
                                    preparedAtMs:1000
                                     expiresAtMs:2000] ==
              AncPrivateVaultGenesisPreparationArtifactStatusOK,
          "create second marker");
    NSString *firstMarker = [directory
        stringByAppendingPathComponent:[Hex(lookup)
                                           stringByAppendingString:@".prepare-index"]];
    NSString *secondMarker = [directory
        stringByAppendingPathComponent:[Hex(secondLookup)
                                           stringByAppendingString:@".prepare-index"]];
    NSData *firstBytes = [NSData dataWithContentsOfFile:firstMarker];
    CHECK([firstBytes writeToFile:secondMarker atomically:NO],
          "substitute marker frame");
    chmod(secondMarker.fileSystemRepresentation, 0600);
    CHECK([store listPreparationLookupIds:&listed] ==
              AncPrivateVaultGenesisPreparationArtifactStatusCorrupt,
          "filename-to-frame marker substitution rejected");

    NSURL *linkRoot = SecureRoot();
    AncPrivateVaultGenesisPreparationArtifactStore *linkStore =
        [[AncPrivateVaultGenesisPreparationArtifactStore alloc]
            initWithStateRootURL:linkRoot];
    uint8_t linkLookup[16];
    memset(linkLookup, 7, sizeof(linkLookup));
    uint8_t linkDigest[32] = {0};
    CHECK(Stage(linkStore, linkLookup, linkDigest, wrap) ==
              AncPrivateVaultGenesisPreparationArtifactStatusOK,
          "stage for symlink test");
    NSString *stagePath = [ArtifactDirectory(linkRoot)
        stringByAppendingPathComponent:[Hex(linkLookup)
                                           stringByAppendingString:@".stage"]];
    CHECK(unlink(stagePath.fileSystemRepresentation) == 0 &&
              symlink("/dev/null", stagePath.fileSystemRepresentation) == 0,
          "replace stage with symlink");
    CHECK([linkStore reconcileLookupId:linkLookup expectedDigest:linkDigest] ==
              AncPrivateVaultGenesisPreparationArtifactStatusCorrupt,
          "symlink rejected as corrupt");

    NSURL *hardlinkRoot = SecureRoot();
    AncPrivateVaultGenesisPreparationArtifactStore *hardlinkStore =
        [[AncPrivateVaultGenesisPreparationArtifactStore alloc]
            initWithStateRootURL:hardlinkRoot];
    uint8_t hardlinkLookup[16];
    memset(hardlinkLookup, 8, sizeof(hardlinkLookup));
    uint8_t hardlinkDigest[32] = {0};
    CHECK(Stage(hardlinkStore, hardlinkLookup, hardlinkDigest, wrap) ==
              AncPrivateVaultGenesisPreparationArtifactStatusOK,
          "stage for hardlink test");
    NSString *hardlinkStage = [ArtifactDirectory(hardlinkRoot)
        stringByAppendingPathComponent:[Hex(hardlinkLookup)
                                           stringByAppendingString:@".stage"]];
    NSString *extraLink =
        [ArtifactDirectory(hardlinkRoot) stringByAppendingPathComponent:@"extra"];
    CHECK(link(hardlinkStage.fileSystemRepresentation,
               extraLink.fileSystemRepresentation) == 0 &&
              [hardlinkStore reconcileLookupId:hardlinkLookup
                                 expectedDigest:hardlinkDigest] ==
                  AncPrivateVaultGenesisPreparationArtifactStatusCorrupt,
          "hardlink rejected as corrupt");
    unlink(extraLink.fileSystemRepresentation);
    chmod(hardlinkStage.fileSystemRepresentation, 0644);
    CHECK([hardlinkStore reconcileLookupId:hardlinkLookup
                         expectedDigest:hardlinkDigest] ==
              AncPrivateVaultGenesisPreparationArtifactStatusCorrupt,
          "unsafe mode rejected as corrupt");

    NSURL *stageDeleteRoot = SecureRoot();
    AncPrivateVaultGenesisPreparationArtifactStore *stageDeleteStore =
        [[AncPrivateVaultGenesisPreparationArtifactStore alloc]
            initWithStateRootURL:stageDeleteRoot];
    uint8_t stageDeleteLookup[16];
    memset(stageDeleteLookup, 10, sizeof(stageDeleteLookup));
    uint8_t stageDeleteDigest[32] = {0};
    CHECK(Stage(stageDeleteStore, stageDeleteLookup, stageDeleteDigest, wrap) ==
                  AncPrivateVaultGenesisPreparationArtifactStatusOK &&
              [stageDeleteStore promoteLookupId:stageDeleteLookup
                                   expectedDigest:stageDeleteDigest] ==
                  AncPrivateVaultGenesisPreparationArtifactStatusOK &&
              Stage(stageDeleteStore, stageDeleteLookup, stageDeleteDigest,
                    wrap) ==
                  AncPrivateVaultGenesisPreparationArtifactStatusOK,
          "create exact stage and live for scoped-delete test");
    NSString *stageDeleteBase = [ArtifactDirectory(stageDeleteRoot)
        stringByAppendingPathComponent:Hex(stageDeleteLookup)];
    NSString *stageDeleteLive =
        [stageDeleteBase stringByAppendingString:@".live"];
    NSString *stageDeleteStage =
        [stageDeleteBase stringByAppendingString:@".stage"];
    uint8_t wrongDigest[32];
    memset(wrongDigest, 0xee, sizeof(wrongDigest));
    CHECK([stageDeleteStore deleteStagedLookupId:stageDeleteLookup
                                  expectedDigest:wrongDigest] ==
                  AncPrivateVaultGenesisPreparationArtifactStatusBindingMismatch &&
              [[NSFileManager defaultManager]
                  fileExistsAtPath:stageDeleteStage],
          "stage deletion requires exact digest");
    CHECK([stageDeleteStore deleteStagedLookupId:stageDeleteLookup
                                  expectedDigest:stageDeleteDigest] ==
                  AncPrivateVaultGenesisPreparationArtifactStatusOK &&
              ![[NSFileManager defaultManager]
                  fileExistsAtPath:stageDeleteStage] &&
              [[NSFileManager defaultManager]
                  fileExistsAtPath:stageDeleteLive],
          "scoped stage deletion cannot remove live artifacts");

    [[NSFileManager defaultManager] removeItemAtURL:root error:nil];
    [[NSFileManager defaultManager] removeItemAtURL:linkRoot error:nil];
    [[NSFileManager defaultManager] removeItemAtURL:hardlinkRoot error:nil];
    [[NSFileManager defaultManager] removeItemAtURL:stageDeleteRoot error:nil];
  }
  fprintf(stdout, "PASS: genesis preparation artifact store tests\n");
  return 0;
}
