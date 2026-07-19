#import <Foundation/Foundation.h>

#import "PrivateVaultGrantIndex.h"
#import "PrivateVaultJobProcessor.h"
#import "PrivateVaultResultSpool.h"
#import "PrivateVaultAncCanonical.h"

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
  if (self != nil) {
    memset(_bytes, 0x44, 32);
    memset(_bytes + 32, 0x33, 32);
    memset(_bytes + 64, 0x61, 96);
  }
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
  snapshot->role = ANC_PV_CUSTODY_ROLE_BROKER;
  snapshot->custody_generation = 2;
  snapshot->active_epoch = 1;
  NSData *vault = [vaultId dataUsingEncoding:NSUTF8StringEncoding];
  memcpy(snapshot->vault_id, vault.bytes, vault.length);
  snapshot->vault_id_length = vault.length;
  NSData *endpoint = [@"0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b"
      dataUsingEncoding:NSUTF8StringEncoding];
  memcpy(snapshot->endpoint_id, endpoint.bytes, endpoint.length);
  snapshot->endpoint_id_length = endpoint.length;
  uint8_t seed[32] = {0};
  uint8_t privateKey[32] = {0};
  memset(seed, 0x33, sizeof seed);
  assert(anc_pv_box_seed_keypair(snapshot->box_public_key, privateKey,
                                 seed) ==
         ANC_PV_CRYPTO_OK);
  anc_pv_zeroize(seed, sizeof seed);
  anc_pv_zeroize(privateKey, sizeof privateKey);
  uint8_t signingSeed[32] = {0};
  uint8_t signingPrivate[64] = {0};
  memset(signingSeed, 0x44, sizeof signingSeed);
  assert(anc_pv_ed25519_seed_keypair(snapshot->signing_public_key,
                                     signingPrivate, signingSeed) ==
         ANC_PV_CRYPTO_OK);
  anc_pv_zeroize(signingSeed, sizeof signingSeed);
  anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
  *handle = self.handle;
  return 0;
}
@end

@interface TestAuthorityMember : NSObject
@property(nonatomic) NSString *endpointId;
@property(nonatomic) NSString *role;
@property(nonatomic) BOOL unattended;
@property(nonatomic) NSData *signingPublicKey;
@property(nonatomic) NSData *keyAgreementPublicKey;
@end
@implementation TestAuthorityMember
@end

@interface TestAuthoritySnapshot : NSObject
@property(nonatomic) uint64_t verifiedAtMs;
@property(nonatomic) NSArray *activeMembers;
@end
@implementation TestAuthoritySnapshot
@end

@interface TestAuthorityCheckpoint : NSObject
@property(nonatomic) TestAuthoritySnapshot *snapshot;
@end
@implementation TestAuthorityCheckpoint
@end

@interface TestAuthorityStore : NSObject
@property(nonatomic) TestAuthorityCheckpoint *checkpoint;
@end
@implementation TestAuthorityStore
- (AncPrivateVaultAuthorityStoreStatus)
    loadVaultId:(NSString *)vaultId checkpoint:(id *)checkpoint
          error:(NSError **)error {
  (void)vaultId;
  (void)error;
  *checkpoint = self.checkpoint;
  return AncPrivateVaultAuthorityStoreStatusOK;
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
    assert(snapshot.generation == 0 && snapshot.grantCount == 0 &&
           snapshot.pendingRevocationCount == 0);
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

    uint8_t contentGrantSeed[32];
    memset(contentGrantSeed, 0x11, sizeof contentGrantSeed);
    uint8_t contentGrantPublicKey[32] = {0};
    uint8_t contentGrantPrivateKey[64] = {0};
    assert(anc_pv_ed25519_seed_keypair(contentGrantPublicKey,
                                       contentGrantPrivateKey,
                                       contentGrantSeed) ==
           ANC_PV_CRYPTO_OK);
    AncPrivateVaultGrantCodecStatus contentGrantStatus =
        AncPrivateVaultGrantCodecStatusInvalid;
    NSData *contentVaultGrant = AncPrivateVaultSealGrantEnvelope(
        Pattern(0x01, 16), Pattern(0xa1, 16), 1721111111,
        Pattern(0xa2, 16), Pattern(0x02, 16), Pattern(0xa3, 16),
        Pattern(0x03, 16), nil, @[Pattern(0x01, 16)],
        @[@"get-document"], @[@"content"], 1721111111, 1721114711,
        Pattern(0xa4, 16), contentGrantSeed, &contentGrantStatus);
    AncPrivateVaultVerifiedGrant *verifiedContentVaultGrant =
        AncPrivateVaultVerifyGrantEnvelope(
            contentVaultGrant, Pattern(0x01, 16), 1721111112,
            Pattern(0x02, 16), contentGrantPublicKey, &contentGrantStatus);
    assert(contentGrantStatus == AncPrivateVaultGrantCodecStatusOK &&
           verifiedContentVaultGrant != nil);
    NSData *contentGrantSigningKey =
        [NSData dataWithBytes:contentGrantPublicKey length:32];
    assert([index storeGrantEnvelope:contentVaultGrant vaultId:kVaultId
                          nowSeconds:1721111112
                    issuerEndpointId:Pattern(0x02, 16)
             issuerControlEndpointId:@"endpoint:index-owner"
              issuerSigningPublicKey:contentGrantSigningKey] ==
           AncPrivateVaultGrantIndexStatusOK);
    assert([index authorizeGrantRef:verifiedContentVaultGrant.grantRef
                             vaultId:kVaultId nowSeconds:1721111112
                    subjectAccountId:Pattern(0xa3, 16)
                   subjectEndpointId:Pattern(0x03, 16)
                      subjectAgentId:nil resourceId:Pattern(0x77, 16)
                           operation:@"get-document" provider:@"content"] ==
           AncPrivateVaultGrantIndexStatusOK);
    assert([index authorizeGrantRef:verifiedContentVaultGrant.grantRef
                             vaultId:kVaultId nowSeconds:1721111112
                    subjectAccountId:Pattern(0xa3, 16)
                   subjectEndpointId:Pattern(0x03, 16)
                      subjectAgentId:nil resourceId:Pattern(0x77, 16)
                           operation:@"publish-document"
                            provider:@"content"] ==
           AncPrivateVaultGrantIndexStatusUnauthorized);
    assert([index authorizeGrantRef:verifiedContentVaultGrant.grantRef
                             vaultId:kVaultId nowSeconds:1721111112
                    subjectAccountId:Pattern(0xa3, 16)
                   subjectEndpointId:Pattern(0x03, 16)
                      subjectAgentId:nil resourceId:Pattern(0x77, 16)
                           operation:@"get-document"
                            provider:@"mail"] ==
           AncPrivateVaultGrantIndexStatusUnauthorized);
    anc_pv_zeroize(contentGrantSeed, sizeof contentGrantSeed);
    anc_pv_zeroize(contentGrantPrivateKey, sizeof contentGrantPrivateKey);
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
                       provider:@"synthetic-provider"
                    hostedEpoch:1 hostedRetryCount:0
               hostedAlgorithmId:@"anc-v1-job"] ==
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
                       provider:@"synthetic-provider"
                    hostedEpoch:1 hostedRetryCount:0
               hostedAlgorithmId:@"anc-v1-job"] ==
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
    assert([index acknowledgeResultHash:resultHash state:@"completed"
                                   jobId:jobId jobHash:jobHash
                                  vaultId:kVaultId] ==
           AncPrivateVaultGrantIndexStatusOK);
    assert([index claimJobId:Pattern(0x16, 16) jobHash:Pattern(0x17, 32)
                       grantRef:grantRef vaultId:kVaultId
                     nowSeconds:1721111112 expiresAtSeconds:1721111200
               subjectAccountId:Pattern(0x07, 16)
              subjectEndpointId:Pattern(0x03, 16)
                 subjectAgentId:Pattern(0x08, 16)
      requesterSigningPublicKey:Pattern(0x21, 32)
          requesterBoxPublicKey:Pattern(0x22, 32)
                     resourceId:Pattern(0x04, 16) operation:@"read"
                       provider:@"wrong-provider"
                    hostedEpoch:1 hostedRetryCount:0
               hostedAlgorithmId:@"anc-v1-job"] ==
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
                       provider:@"synthetic-provider"
                    hostedEpoch:1 hostedRetryCount:0
               hostedAlgorithmId:@"anc-v1-job"] ==
           AncPrivateVaultGrantIndexStatusOK);

    NSData *semanticGrant = Hex(@"b10166616e632f763102500101010101010101010101010101010103656772616e74041a66961247055016161616161616161616161616161616183c5005050505050505050505050505050505183d5002020202020202020202020202020202183e5007070707070707070707070707070707183f5003030303030303030303030303030303184050080808080808080808080808080808081841815009090909090909090909090909090909184281647265616418438167636f6e74656e7418441a6696124718451a669620571846500a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a1847584058e6cfd36566a7fd1db086d9150ce14ba1c2e11308e26478bdeb8f03a2d6ab82b6f220ea52753ae854af89a5e8e384d8ae3e5abfe003bfd457596231dd7c9504");
    NSData *semanticJob = Hex(@"ac0166616e632f763102500101010101010101010101010101010103636a6f62041a66961247055018181818181818181818181818181818185a5006060606060606060606060606060606185b5820535eab190d7b022ff384ead22836dde8267255a28faa9886624b83c4fd806914185c1a66961247185d1a6696149f185e500b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b185f5887393939393939393939393939393939393939393939393939aef8dbddc3e7001b87b8db52c376f2f5ad0da4d05165c06e8a6fecc427ba6465244e38ceed648836a2a10a9d58cd08f2c6878b6ed6f14d3ca020b9bd8f51a8bcb5e7fb3e331d435913c6a3133e4a2ae19064714a5b14bd48ace63c64643f27da472670173b5bb671edae4aecf0230b1860584068e61eddabc6269503e2d07de576f116088f6eb832390e0e881dfa4150184d535f5e11d5cfd1c3c2f60706f7b78025e3bb6626b3f5c0fa8088f27cd430830a0a");
    NSData *requesterSigning = Hex(@"d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737");
    NSData *requesterBox = Hex(@"9d8d78b9c9e6661e552f2f1af02095ee2f8743fa2e6183f41bb7077ef51b5379");
    NSData *brokerBox = Hex(@"4eb4fafee2bd3018a24e310de8106333c2b364eaed029a7f05d7b45ccc77683a");
    assert([index storeGrantEnvelope:semanticGrant vaultId:kVaultId
                          nowSeconds:1721111200
                    issuerEndpointId:Pattern(0x02, 16)
             issuerControlEndpointId:@"endpoint:index-owner"
              issuerSigningPublicKey:requesterSigning] ==
           AncPrivateVaultGrantIndexStatusOK);
    TestAuthorityMember *requester = [TestAuthorityMember new];
    requester.endpointId = @"03030303030303030303030303030303";
    requester.role = @"endpoint";
    requester.unattended = NO;
    requester.signingPublicKey = requesterSigning;
    requester.keyAgreementPublicKey = requesterBox;
    TestAuthorityMember *broker = [TestAuthorityMember new];
    broker.endpointId = @"0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b";
    broker.role = @"broker";
    broker.unattended = YES;
    uint8_t brokerSigningSeed[32] = {0}, brokerSigningPublic[32] = {0};
    uint8_t brokerSigningPrivate[64] = {0};
    memset(brokerSigningSeed, 0x44, sizeof brokerSigningSeed);
    assert(anc_pv_ed25519_seed_keypair(brokerSigningPublic,
                                       brokerSigningPrivate,
                                       brokerSigningSeed) == ANC_PV_CRYPTO_OK);
    broker.signingPublicKey = [NSData dataWithBytes:brokerSigningPublic
                                             length:sizeof brokerSigningPublic];
    anc_pv_zeroize(brokerSigningSeed, sizeof brokerSigningSeed);
    anc_pv_zeroize(brokerSigningPublic, sizeof brokerSigningPublic);
    anc_pv_zeroize(brokerSigningPrivate, sizeof brokerSigningPrivate);
    broker.keyAgreementPublicKey = brokerBox;
    TestAuthoritySnapshot *authoritySnapshot = [TestAuthoritySnapshot new];
    authoritySnapshot.verifiedAtMs = 1721111200ULL * 1000;
    authoritySnapshot.activeMembers = @[requester, broker];
    TestAuthorityCheckpoint *authorityCheckpoint =
        [TestAuthorityCheckpoint new];
    authorityCheckpoint.snapshot = authoritySnapshot;
    TestAuthorityStore *authorityStore = [TestAuthorityStore new];
    authorityStore.checkpoint = authorityCheckpoint;
    AncPrivateVaultResultSpool *resultSpool =
        [[AncPrivateVaultResultSpool alloc]
            initWithStateRootURL:[NSURL fileURLWithPath:temporary]];
    AncPrivateVaultJobProcessor *processor = [[AncPrivateVaultJobProcessor alloc]
        initWithSession:session
          authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
              grantIndex:index
             resultSpool:resultSpool];
    AncPrivateVaultAuthorizedJob *authorizedJob = nil;
    assert([processor openJobEnvelope:semanticJob vaultId:kVaultId
                                jobId:Pattern(0x06, 16)
                           hostedEpoch:1 hostedRetryCount:0
                      hostedAlgorithmId:@"anc-v1-job"
                           nowSeconds:1721111200 result:&authorizedJob] ==
           AncPrivateVaultJobProcessorStatusOK);
    assert([authorizedJob.body isEqualToData:
        [@"{\"action\":\"get-document\"}"
            dataUsingEncoding:NSUTF8StringEncoding]] &&
           authorizedJob.jobHash.length == 32 &&
           [authorizedJob.resourceId isEqualToData:Pattern(0x09, 16)] &&
           [authorizedJob.operation isEqualToString:@"read"]);
    AncPrivateVaultCanonicalStatus proofStatus;
    NSData *unsignedProof = AncPrivateVaultCanonicalEncode(
        [AncPrivateVaultCanonicalValue map:@{
          @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
          @2 : [AncPrivateVaultCanonicalValue integer:1],
          @3 : [AncPrivateVaultCanonicalValue text:@"endpoint_request"],
          @4 : [AncPrivateVaultCanonicalValue text:kVaultId],
          @5 : [AncPrivateVaultCanonicalValue
              text:@"0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b"],
          @6 : [AncPrivateVaultCanonicalValue text:@"POST"],
          @7 : [AncPrivateVaultCanonicalValue
              text:@"/api/private-vault/jobs/broker/claim"],
          @8 : [AncPrivateVaultCanonicalValue bytes:Pattern(0x55, 32)],
          @9 : [AncPrivateVaultCanonicalValue
              text:@"2024-07-16T00:00:00.000Z"],
          @10 : [AncPrivateVaultCanonicalValue
              text:@"66666666666666666666666666666666"],
        }],
        &proofStatus);
    NSData *endpointSignature = nil;
    assert(proofStatus == AncPrivateVaultCanonicalStatusOK &&
           [processor signEndpointRequestProof:unsignedProof
                                     nowSeconds:1721111200
                                         result:&endpointSignature] ==
               AncPrivateVaultJobProcessorStatusOK &&
           endpointSignature.length == 64);
    static const uint8_t proofDomain[] = "anc/v1/endpoint-request";
    NSMutableData *proofMessage = [NSMutableData
        dataWithCapacity:sizeof proofDomain + unsignedProof.length];
    [proofMessage appendBytes:proofDomain length:sizeof proofDomain];
    [proofMessage appendData:unsignedProof];
    assert(anc_pv_ed25519_verify(endpointSignature.bytes, proofMessage.bytes,
                                 proofMessage.length,
                                 broker.signingPublicKey.bytes) ==
           ANC_PV_CRYPTO_OK);
    NSData *authorizedJobHash = [authorizedJob.jobHash copy];
    assert([processor openJobEnvelope:semanticJob vaultId:kVaultId
                                jobId:Pattern(0x06, 16)
                           hostedEpoch:1 hostedRetryCount:0
                      hostedAlgorithmId:@"anc-v1-job"
                           nowSeconds:1721111200 result:&authorizedJob] ==
           AncPrivateVaultJobProcessorStatusReplay);
    NSData *resultEnvelope = nil;
    AncPrivateVaultJobProcessorSetAfterSpoolFaultHookForTesting(^BOOL{
      return YES;
    });
    AncPrivateVaultJobProcessorStatus resultStatus =
        [processor sealResultPayload:
                  [@"{\"title\":\"Private\"}"
                      dataUsingEncoding:NSUTF8StringEncoding]
                                  state:@"completed" vaultId:kVaultId
                                  jobId:Pattern(0x06, 16)
                                 jobHash:authorizedJobHash
                              nowSeconds:1721111201 result:&resultEnvelope];
    assert(resultStatus == AncPrivateVaultJobProcessorStatusStorageFailed &&
           resultEnvelope == nil);
    AncPrivateVaultJobContext *jobBeforeRecovery = nil;
    assert([index resolveJobId:Pattern(0x06, 16)
                          jobHash:authorizedJobHash vaultId:kVaultId
                          context:&jobBeforeRecovery] ==
           AncPrivateVaultGrantIndexStatusOK &&
           !jobBeforeRecovery.resultRecorded &&
           [jobBeforeRecovery.resourceId isEqualToData:Pattern(0x09, 16)] &&
           [jobBeforeRecovery.operation isEqualToString:@"read"] &&
           [jobBeforeRecovery.provider isEqualToString:@"content"] &&
           [jobBeforeRecovery.status isEqualToString:@"claimed"] &&
           jobBeforeRecovery.expiresAt > 1721111200);
    NSData *orphanedResultEnvelope = nil;
    assert([resultSpool loadEnvelopeForVaultId:Pattern(0x01, 16)
                                          jobId:Pattern(0x06, 16)
                                         result:&orphanedResultEnvelope] ==
               AncPrivateVaultResultSpoolStatusOK &&
           orphanedResultEnvelope.length > 0);
    AncPrivateVaultJobProcessorSetAfterSpoolFaultHookForTesting(nil);
    resultStatus = [processor sealResultPayload:
        [@"ignored recovery payload" dataUsingEncoding:NSUTF8StringEncoding]
                                             state:@"completed" vaultId:kVaultId
                                             jobId:Pattern(0x06, 16)
                                            jobHash:authorizedJobHash
                                         nowSeconds:1721111202
                                             result:&resultEnvelope];
    assert(resultStatus == AncPrivateVaultJobProcessorStatusOK &&
           [resultEnvelope isEqualToData:orphanedResultEnvelope]);
    NSData *retriedResultEnvelope = nil;
    assert([processor sealResultPayload:
               [@"ignored retry payload"
                   dataUsingEncoding:NSUTF8StringEncoding]
                                  state:@"completed" vaultId:kVaultId
                                  jobId:Pattern(0x06, 16)
                                 jobHash:authorizedJobHash
                              nowSeconds:1721111203
                                  result:&retriedResultEnvelope] ==
               AncPrivateVaultJobProcessorStatusOK &&
           [retriedResultEnvelope isEqualToData:resultEnvelope]);
    AncPrivateVaultJobContext *jobContext = nil;
    assert([index resolveJobId:Pattern(0x06, 16)
                          jobHash:authorizedJobHash vaultId:kVaultId
                          context:&jobContext] ==
               AncPrivateVaultGrantIndexStatusOK &&
           jobContext.resultRecorded &&
           [jobContext.resultState isEqualToString:@"completed"] &&
           jobContext.resultHash.length == 32);
    AncPrivateVaultPendingResult *pendingResult = nil;
    assert([processor recoverPendingHostedResultForVaultId:kVaultId
                                                    result:&pendingResult] ==
               AncPrivateVaultJobProcessorStatusOK &&
           [pendingResult.jobId isEqualToData:Pattern(0x06, 16)] &&
           [pendingResult.jobHash isEqualToData:authorizedJobHash] &&
           [pendingResult.state isEqualToString:@"completed"] &&
           pendingResult.epoch == 1 && pendingResult.retryCount == 0 &&
           [pendingResult.algorithmId isEqualToString:@"anc-v1-job"] &&
           [pendingResult.resultEnvelope isEqualToData:resultEnvelope]);
    assert([processor acknowledgeHostedResultForVaultId:kVaultId
                                                   jobId:Pattern(0x06, 16)
                                                  jobHash:authorizedJobHash
                                                     state:@"failed"] ==
           AncPrivateVaultJobProcessorStatusUnauthorized);
    assert([resultSpool loadEnvelopeForVaultId:Pattern(0x01, 16)
                                          jobId:Pattern(0x06, 16)
                                         result:&retriedResultEnvelope] ==
           AncPrivateVaultResultSpoolStatusOK);
    assert([processor acknowledgeHostedResultForVaultId:kVaultId
                                                   jobId:Pattern(0x06, 16)
                                                  jobHash:authorizedJobHash
                                                     state:@"completed"] ==
           AncPrivateVaultJobProcessorStatusOK);
    pendingResult = nil;
    assert([processor recoverPendingHostedResultForVaultId:kVaultId
                                                    result:&pendingResult] ==
               AncPrivateVaultJobProcessorStatusOK &&
           pendingResult == nil);
    assert([index resolveJobId:Pattern(0x06, 16)
                          jobHash:authorizedJobHash vaultId:kVaultId
                          context:&jobContext] ==
               AncPrivateVaultGrantIndexStatusOK &&
           jobContext.resultRecorded && jobContext.receiptAcknowledged);
    assert([resultSpool loadEnvelopeForVaultId:Pattern(0x01, 16)
                                          jobId:Pattern(0x06, 16)
                                         result:&retriedResultEnvelope] ==
           AncPrivateVaultResultSpoolStatusNotFound);
    assert([processor acknowledgeHostedResultForVaultId:kVaultId
                                                   jobId:Pattern(0x06, 16)
                                                  jobHash:authorizedJobHash
                                                     state:@"completed"] ==
           AncPrivateVaultJobProcessorStatusOK);
    AncPrivateVaultRevocableGrantContext *revocable = nil;
    assert([index resolveGrantForRevocationRef:grantRef vaultId:kVaultId
                                       context:&revocable] ==
               AncPrivateVaultGrantIndexStatusOK &&
           [revocable.grant.grantRef isEqualToData:grantRef] &&
           [revocable.issuerControlEndpointId
               isEqualToString:@"endpoint:index-owner"] &&
           [revocable.issuerSigningPublicKey isEqualToData:publicKey]);
    NSData *pendingSignedEntry = Pattern(0xa5, 512);
    assert([index stagePendingRevocationSignedEntry:pendingSignedEntry
                                revocationEnvelope:revocation
                                           vaultId:kVaultId] ==
           AncPrivateVaultGrantIndexStatusOK);
    assert([index stagePendingRevocationSignedEntry:pendingSignedEntry
                                revocationEnvelope:revocation
                                           vaultId:kVaultId] ==
           AncPrivateVaultGrantIndexStatusOK);
    assert([index stagePendingRevocationSignedEntry:Pattern(0xa6, 512)
                                revocationEnvelope:revocation
                                           vaultId:kVaultId] ==
           AncPrivateVaultGrantIndexStatusConflict);
    AncPrivateVaultGrantIndex *pendingRestart =
        [[AncPrivateVaultGrantIndex alloc]
            initWithStateRootURL:[NSURL fileURLWithPath:temporary]
                         session:session
                        keychain:keychain];
    AncPrivateVaultPendingGrantRevocation *pendingRevocation = nil;
    assert([pendingRestart pendingRevocationForVaultId:kVaultId
                                               context:&pendingRevocation] ==
               AncPrivateVaultGrantIndexStatusOK &&
           [pendingRevocation.grantRef isEqualToData:grantRef] &&
           [pendingRevocation.signedEntry isEqualToData:pendingSignedEntry] &&
           [pendingRevocation.revocationEnvelope isEqualToData:revocation]);
    assert([pendingRestart clearPendingRevocationSignedEntry:Pattern(0xa6, 512)
                                                    vaultId:kVaultId] ==
           AncPrivateVaultGrantIndexStatusConflict);
    assert([pendingRestart clearPendingRevocationSignedEntry:pendingSignedEntry
                                                    vaultId:kVaultId] ==
           AncPrivateVaultGrantIndexStatusOK);
    assert([pendingRestart pendingRevocationForVaultId:kVaultId
                                               context:&pendingRevocation] ==
               AncPrivateVaultGrantIndexStatusNotFound &&
           pendingRevocation == nil);
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
    assert(snapshot.generation == 13 && snapshot.grantCount == 3 &&
           snapshot.revocationCount == 1 &&
           snapshot.pendingRevocationCount == 0 && snapshot.jobCount == 2);
    AncPrivateVaultJobProcessor *restartedProcessor =
        [[AncPrivateVaultJobProcessor alloc]
            initWithSession:session
             authorityStore:(AncPrivateVaultAuthorityStore *)authorityStore
                 grantIndex:restarted
                resultSpool:[[AncPrivateVaultResultSpool alloc]
                    initWithStateRootURL:[NSURL fileURLWithPath:temporary]]];
    NSData *restartResultEnvelope = nil;
    assert([restartedProcessor sealResultPayload:
               [@"another ignored retry payload"
                   dataUsingEncoding:NSUTF8StringEncoding]
                                         state:@"completed" vaultId:kVaultId
                                         jobId:Pattern(0x06, 16)
                                        jobHash:authorizedJobHash
                                     nowSeconds:1721111204
                                         result:&restartResultEnvelope] ==
               AncPrivateVaultJobProcessorStatusStorageFailed &&
           restartResultEnvelope == nil);
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
