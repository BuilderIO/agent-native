#import <Foundation/Foundation.h>

#import "PrivateVaultGrantIndex.h"

#include <assert.h>
#include <sys/stat.h>

static NSString *const kVaultId = @"01010101010101010101010101010101";

static NSData *Hex(NSString *value) {
  assert(value.length % 2 == 0);
  NSMutableData *data = [NSMutableData dataWithLength:value.length / 2];
  for (NSUInteger index = 0; index < data.length; index += 1) {
    unsigned int byte = 0;
    NSScanner *scanner = [NSScanner scannerWithString:
        [value substringWithRange:NSMakeRange(index * 2, 2)]];
    assert([scanner scanHexInt:&byte] && scanner.isAtEnd);
    ((uint8_t *)data.mutableBytes)[index] = (uint8_t)byte;
  }
  return data;
}

static NSData *Pattern(uint8_t byte, NSUInteger length) {
  NSMutableData *data = [NSMutableData dataWithLength:length];
  memset(data.mutableBytes, byte, length);
  return data;
}

@interface TestHandle : NSObject <AncPrivateVaultSessionCustodyHandle> {
  uint8_t _bytes[160];
}
@property(nonatomic, getter=isClosed) BOOL closed;
@end
@implementation TestHandle
- (instancetype)init {
  self = [super init];
  if (self != nil) memset(_bytes, 0x61, sizeof _bytes);
  return self;
}
- (NSInteger)borrow:(BOOL (^)(const AncPrivateVaultCustodySecretInputs *))block {
  AncPrivateVaultCustodySecretInputs secrets = {
      .signing_seed = _bytes,
      .box_seed = _bytes + 32,
      .local_state_key = _bytes + 64,
      .active_epoch_key = _bytes + 96,
      .pending_epoch_key = _bytes + 128,
  };
  return !_closed && block != nil && block(&secrets) ? 0 : 7;
}
- (NSInteger)close {
  anc_pv_zeroize(_bytes, sizeof _bytes);
  _closed = YES;
  return 0;
}
@end

@interface TestRepository : NSObject <AncPrivateVaultSessionCustodyRepository>
@property(nonatomic) TestHandle *handle;
@end
@implementation TestRepository
- (NSInteger)readVaultId:(NSString *)vaultId
                snapshot:(AncPrivateVaultCustodySnapshot *)snapshot
                  handle:(id<AncPrivateVaultSessionCustodyHandle> *)handle {
  anc_pv_custody_snapshot_zero(snapshot);
  snapshot->record_version = ANC_PV_CUSTODY_VERSION;
  snapshot->authority_anchor_present = 1;
  snapshot->lifecycle = ANC_PV_CUSTODY_LIFECYCLE_ACTIVE;
  snapshot->role = ANC_PV_CUSTODY_ROLE_ENDPOINT;
  snapshot->custody_generation = 2;
  snapshot->active_epoch = 1;
  NSData *vault = [vaultId dataUsingEncoding:NSUTF8StringEncoding];
  memcpy(snapshot->vault_id, vault.bytes, vault.length);
  snapshot->vault_id_length = vault.length;
  NSData *endpoint = [@"endpoint:index-owner" dataUsingEncoding:NSUTF8StringEncoding];
  memcpy(snapshot->endpoint_id, endpoint.bytes, endpoint.length);
  snapshot->endpoint_id_length = endpoint.length;
  *handle = self.handle;
  return 0;
}
@end

@interface TestKeychain : AncPrivateVaultKeychain
@property(nonatomic) NSMutableDictionary<NSString *, NSData *> *values;
@end
@implementation TestKeychain
- (instancetype)init {
  self = [super init];
  if (self != nil) _values = [NSMutableDictionary dictionary];
  return self;
}
- (NSString *)key:(NSString *)service vault:(NSString *)vault record:(NSString *)record {
  return [NSString stringWithFormat:@"%@|%@|%@", service, vault, record];
}
- (AncPrivateVaultKeychainStatus)copyDataForService:(NSString *)service
                                            vaultId:(NSString *)vaultId
                                           recordId:(NSString *)recordId
                                               data:(NSData **)data {
  NSData *value = self.values[[self key:service vault:vaultId record:recordId]];
  if (value == nil) return AncPrivateVaultKeychainStatusNotFound;
  if (data != NULL) *data = [value copy];
  return AncPrivateVaultKeychainStatusOK;
}
- (AncPrivateVaultKeychainStatus)addData:(NSData *)data
                              forService:(NSString *)service
                                 vaultId:(NSString *)vaultId
                                recordId:(NSString *)recordId {
  NSString *key = [self key:service vault:vaultId record:recordId];
  if (self.values[key] != nil) return AncPrivateVaultKeychainStatusDuplicate;
  self.values[key] = [data copy];
  return AncPrivateVaultKeychainStatusOK;
}
- (AncPrivateVaultKeychainStatus)updateData:(NSData *)data
                                 forService:(NSString *)service
                                    vaultId:(NSString *)vaultId
                                   recordId:(NSString *)recordId {
  NSString *key = [self key:service vault:vaultId record:recordId];
  if (self.values[key] == nil) return AncPrivateVaultKeychainStatusNotFound;
  self.values[key] = [data copy];
  return AncPrivateVaultKeychainStatusOK;
}
- (AncPrivateVaultKeychainStatus)deleteDataForService:(NSString *)service
                                              vaultId:(NSString *)vaultId
                                             recordId:(NSString *)recordId {
  [self.values removeObjectForKey:[self key:service vault:vaultId record:recordId]];
  return AncPrivateVaultKeychainStatusOK;
}
@end

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    NSString *temporary = [NSTemporaryDirectory()
        stringByAppendingPathComponent:[[NSUUID UUID] UUIDString]];
    assert([[NSFileManager defaultManager] createDirectoryAtPath:temporary
                                      withIntermediateDirectories:NO
                                                       attributes:@{NSFilePosixPermissions : @0700}
                                                            error:nil]);
    TestRepository *repository = [TestRepository new];
    repository.handle = [TestHandle new];
    AncPrivateVaultSession *session =
        [[AncPrivateVaultSession alloc] initWithRepository:repository];
    assert([session unlockVaultId:kVaultId] == AncPrivateVaultSessionStatusOK);
    TestKeychain *keychain = [TestKeychain new];
    AncPrivateVaultGrantIndex *index = [[AncPrivateVaultGrantIndex alloc]
        initWithStateRootURL:[NSURL fileURLWithPath:temporary]
                     session:session
                    keychain:keychain];
    assert(index != nil);
    AncPrivateVaultGrantIndexSnapshot *snapshot = nil;
    assert([index loadVaultId:kVaultId snapshot:&snapshot] ==
           AncPrivateVaultGrantIndexStatusOK);
    assert(snapshot.generation == 0 && snapshot.grantCount == 0);
    NSString *stagePath = [temporary stringByAppendingPathComponent:
        [NSString stringWithFormat:@"grant-index/%@.stage", kVaultId]];
    assert([[@"uncommitted" dataUsingEncoding:NSUTF8StringEncoding]
        writeToFile:stagePath atomically:NO]);
    assert(chmod(stagePath.fileSystemRepresentation, 0600) == 0);
    assert([index loadVaultId:kVaultId snapshot:&snapshot] ==
           AncPrivateVaultGrantIndexStatusOK &&
           ![[NSFileManager defaultManager] fileExistsAtPath:stagePath]);

    NSData *grant = Hex(@"b10166616e632f763102500101010101010101010101010101010103656772616e74041a66961247055016161616161616161616161616161616183c5005050505050505050505050505050505183d5002020202020202020202020202020202183e5007070707070707070707070707070707183f500303030303030303030303030303030318405008080808080808080808080808080808184181500404040404040404040404040404040418428264726561646973756d6d6172697a651843817273796e7468657469632d70726f766964657218441a6696124718451a669620571846500909090909090909090909090909090918475840375f79aa1a33d3766de017f95a7b30dc0032d332589b3b9dbb44467e26892d2aa76f22b1e52ba7207803edac04a803c2083c8658ec27053bfe92dbf2daa30200");
    NSData *revocation = Hex(@"ab0166616e632f7631025001010101010101010101010101010101036c6772616e742d7265766f6b65041a669612490550313131313131313131313131313131311848582076841ff39e85522ccfe9eb53ed39925d615f5997cfbb8f3f71e10b22eec0f82418495009090909090909090909090909090909184a1a66961249184b6c757365725f7265766f6b6564184c5002020202020202020202020202020202184d5840cdd276cbffe853d610b445f7e6ae8875ff3c606b289a7607b37753a2630fc7a4b8153f1ae0965fe69a6badcf3dd80e02ceda4e12edc3f1bbf337f8dd41144503");
    NSData *publicKey = Hex(@"d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737");
    NSData *grantRef = Hex(@"76841ff39e85522ccfe9eb53ed39925d615f5997cfbb8f3f71e10b22eec0f824");
    assert([index storeGrantEnvelope:grant vaultId:kVaultId
                          nowSeconds:1721111112 issuerEndpointId:Pattern(0x02, 16)
             issuerControlEndpointId:@"endpoint:index-owner"
              issuerSigningPublicKey:publicKey] ==
           AncPrivateVaultGrantIndexStatusOK);
    assert([index authorizeGrantRef:grantRef vaultId:kVaultId
                         nowSeconds:1721111112 subjectAccountId:Pattern(0x07, 16)
                  subjectEndpointId:Pattern(0x03, 16)
                     subjectAgentId:Pattern(0x08, 16)
                         resourceId:Pattern(0x04, 16) operation:@"read"
                           provider:@"synthetic-provider"] ==
           AncPrivateVaultGrantIndexStatusOK);
    assert([index authorizeGrantRef:grantRef vaultId:kVaultId
                         nowSeconds:1721111112 subjectAccountId:Pattern(0xff, 16)
                  subjectEndpointId:Pattern(0x03, 16)
                     subjectAgentId:Pattern(0x08, 16)
                         resourceId:Pattern(0x04, 16) operation:@"read"
                           provider:@"synthetic-provider"] ==
           AncPrivateVaultGrantIndexStatusUnauthorized);
    NSData *jobId = Pattern(0x12, 16);
    NSData *jobHash = Pattern(0x13, 32);
    NSData *resultHash = Pattern(0x14, 32);
    assert([index claimJobId:jobId jobHash:jobHash grantRef:grantRef
                       vaultId:kVaultId nowSeconds:1721111112
              expiresAtSeconds:1721111200
               subjectAccountId:Pattern(0x07, 16)
              subjectEndpointId:Pattern(0x03, 16)
                 subjectAgentId:Pattern(0x08, 16)
      requesterSigningPublicKey:Pattern(0x21, 32)
          requesterBoxPublicKey:Pattern(0x22, 32)
                     resourceId:Pattern(0x04, 16)
                      operation:@"read"
                       provider:@"synthetic-provider"] ==
           AncPrivateVaultGrantIndexStatusOK);
    assert([index claimJobId:jobId jobHash:jobHash grantRef:grantRef
                       vaultId:kVaultId nowSeconds:1721111112
              expiresAtSeconds:1721111200
               subjectAccountId:Pattern(0x07, 16)
              subjectEndpointId:Pattern(0x03, 16)
                 subjectAgentId:Pattern(0x08, 16)
      requesterSigningPublicKey:Pattern(0x21, 32)
          requesterBoxPublicKey:Pattern(0x22, 32)
                     resourceId:Pattern(0x04, 16)
                      operation:@"read"
                       provider:@"synthetic-provider"] ==
           AncPrivateVaultGrantIndexStatusReplay);
    assert([index recordResultHash:resultHash state:@"completed" jobId:jobId
                            jobHash:jobHash vaultId:kVaultId] ==
           AncPrivateVaultGrantIndexStatusOK);
    assert([index recordResultHash:resultHash state:@"completed" jobId:jobId
                            jobHash:jobHash vaultId:kVaultId] ==
           AncPrivateVaultGrantIndexStatusOK);
    assert([index recordResultHash:Pattern(0x15, 32) state:@"completed"
                              jobId:jobId jobHash:jobHash vaultId:kVaultId] ==
           AncPrivateVaultGrantIndexStatusConflict);
    assert([index claimJobId:Pattern(0x16, 16) jobHash:Pattern(0x17, 32)
                       grantRef:grantRef vaultId:kVaultId
                     nowSeconds:1721111112 expiresAtSeconds:1721111200
               subjectAccountId:Pattern(0x07, 16)
              subjectEndpointId:Pattern(0x03, 16)
                 subjectAgentId:Pattern(0x08, 16)
      requesterSigningPublicKey:Pattern(0x21, 32)
          requesterBoxPublicKey:Pattern(0x22, 32)
                     resourceId:Pattern(0x04, 16) operation:@"read"
                       provider:@"wrong-provider"] ==
           AncPrivateVaultGrantIndexStatusUnauthorized);
    assert([index claimJobId:Pattern(0x18, 16) jobHash:Pattern(0x19, 32)
                       grantRef:grantRef vaultId:kVaultId
                     nowSeconds:1721111300 expiresAtSeconds:1721111400
               subjectAccountId:Pattern(0x07, 16)
              subjectEndpointId:Pattern(0x03, 16)
                 subjectAgentId:Pattern(0x08, 16)
      requesterSigningPublicKey:Pattern(0x21, 32)
          requesterBoxPublicKey:Pattern(0x22, 32)
                     resourceId:Pattern(0x04, 16) operation:@"read"
                       provider:@"synthetic-provider"] ==
           AncPrivateVaultGrantIndexStatusOK);
    assert([index applyRevocationEnvelope:revocation vaultId:kVaultId
                  signerControlEndpointId:@"endpoint:index-owner"
                   signerSigningPublicKey:publicKey] ==
           AncPrivateVaultGrantIndexStatusOK);
    assert([index authorizeGrantRef:grantRef vaultId:kVaultId
                         nowSeconds:1721111114 subjectAccountId:Pattern(0x07, 16)
                  subjectEndpointId:Pattern(0x03, 16)
                     subjectAgentId:Pattern(0x08, 16)
                         resourceId:Pattern(0x04, 16) operation:@"read"
                           provider:@"synthetic-provider"] ==
           AncPrivateVaultGrantIndexStatusUnauthorized);

    AncPrivateVaultGrantIndex *restarted = [[AncPrivateVaultGrantIndex alloc]
        initWithStateRootURL:[NSURL fileURLWithPath:temporary]
                     session:session
                    keychain:keychain];
    assert([restarted loadVaultId:kVaultId snapshot:&snapshot] ==
           AncPrivateVaultGrantIndexStatusOK);
    assert(snapshot.generation == 5 && snapshot.grantCount == 1 &&
           snapshot.revocationCount == 1 && snapshot.jobCount == 1);
    NSString *livePath = [temporary stringByAppendingPathComponent:
        [NSString stringWithFormat:@"grant-index/%@.live", kVaultId]];
    NSData *frame = [NSData dataWithContentsOfFile:livePath];
    assert([frame rangeOfData:grant options:0 range:NSMakeRange(0, frame.length)].location == NSNotFound);
    assert([frame writeToFile:stagePath atomically:NO]);
    assert(chmod(stagePath.fileSystemRepresentation, 0600) == 0);
    assert([restarted loadVaultId:kVaultId snapshot:&snapshot] ==
           AncPrivateVaultGrantIndexStatusOK &&
           ![[NSFileManager defaultManager] fileExistsAtPath:stagePath]);
    NSMutableData *tampered = [frame mutableCopy];
    ((uint8_t *)tampered.mutableBytes)[tampered.length - 1] ^= 1;
    assert([tampered writeToFile:livePath atomically:NO]);
    assert([restarted loadVaultId:kVaultId snapshot:&snapshot] ==
           AncPrivateVaultGrantIndexStatusRollbackDetected);

    assert([session lock] == AncPrivateVaultSessionStatusOK);
    [[NSFileManager defaultManager] removeItemAtPath:temporary error:nil];
  }
  puts("private-vault encrypted grant index tests passed");
  return 0;
}
