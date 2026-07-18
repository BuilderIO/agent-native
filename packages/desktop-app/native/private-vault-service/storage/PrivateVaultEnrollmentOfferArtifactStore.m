#import "PrivateVaultEnrollmentOfferArtifactStore.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultEnrollmentOffer.h"

#import <objc/runtime.h>

@interface AncPrivateVaultEnrollmentOfferArtifact ()
@property(nonatomic, readwrite) NSData *vaultId;
@property(nonatomic, readwrite) NSData *endpointId;
@property(nonatomic, readwrite) NSData *ceremonyId;
@property(nonatomic, readwrite) NSString *membershipRole;
@property(nonatomic, readwrite) NSData *signingPublicKey;
@property(nonatomic, readwrite) NSData *keyAgreementPublicKey;
@property(nonatomic, readwrite) NSData *encodedOffer;
@property(nonatomic, readwrite) NSData *offerHash;
@property(nonatomic, readwrite) NSData *candidateKeyProof;
@end
@implementation AncPrivateVaultEnrollmentOfferArtifact
@end

@interface AncPrivateVaultEnrollmentOfferArtifactStore ()
@property(nonatomic) AncPrivateVaultKeychain *keychain;
@property(nonatomic) NSString *recordId;
@end

static NSString *Hex(NSData *data) {
  if (![data isKindOfClass:NSData.class] || data.length != 16)
    return nil;
  const uint8_t *bytes = data.bytes;
  NSMutableString *value = [NSMutableString stringWithCapacity:32];
  for (NSUInteger index = 0; index < 16; index += 1)
    [value appendFormat:@"%02x", bytes[index]];
  return value;
}

static AncPrivateVaultEnrollmentOfferArtifactStatus MapStatus(
    AncPrivateVaultKeychainStatus status) {
  switch (status) {
  case AncPrivateVaultKeychainStatusOK:
    return AncPrivateVaultEnrollmentOfferArtifactStatusOK;
  case AncPrivateVaultKeychainStatusNotFound:
    return AncPrivateVaultEnrollmentOfferArtifactStatusNotFound;
  case AncPrivateVaultKeychainStatusDuplicate:
    return AncPrivateVaultEnrollmentOfferArtifactStatusConflict;
  case AncPrivateVaultKeychainStatusCorrupt:
    return AncPrivateVaultEnrollmentOfferArtifactStatusCorrupt;
  case AncPrivateVaultKeychainStatusInaccessible:
    return AncPrivateVaultEnrollmentOfferArtifactStatusInaccessible;
  case AncPrivateVaultKeychainStatusInvalid:
    return AncPrivateVaultEnrollmentOfferArtifactStatusInvalid;
  case AncPrivateVaultKeychainStatusFailed:
    return AncPrivateVaultEnrollmentOfferArtifactStatusFailed;
  }
}

static AncPrivateVaultCanonicalValue *Field(
    NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map,
    NSNumber *key, AncPrivateVaultCanonicalType type) {
  AncPrivateVaultCanonicalValue *value = map[key];
  return value.type == type ? value : nil;
}

static BOOL ExactKeys(NSDictionary<NSNumber *, id> *map,
                      NSArray<NSNumber *> *keys) {
  return map.count == keys.count &&
         [[NSSet setWithArray:map.allKeys]
             isEqualToSet:[NSSet setWithArray:keys]];
}

static AncPrivateVaultEnrollmentOfferArtifact *DecodeArtifact(
    NSData *encoded, NSData *expectedVaultId) {
  if (encoded.length == 0 || encoded.length > 2048 ||
      expectedVaultId.length != 16)
    return nil;
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *root =
      AncPrivateVaultCanonicalDecode(encoded, 2048, &status);
  NSDictionary *artifactMap = root.mapValue;
  NSArray *artifactKeys = @[ @1, @2, @3, @600, @601, @602 ];
  NSData *vault = Field(artifactMap, @2, AncPrivateVaultCanonicalTypeBytes)
                      .bytesValue;
  NSData *offer = Field(artifactMap, @600, AncPrivateVaultCanonicalTypeBytes)
                      .bytesValue;
  NSData *hash = Field(artifactMap, @601, AncPrivateVaultCanonicalTypeBytes)
                     .bytesValue;
  NSData *proof = Field(artifactMap, @602, AncPrivateVaultCanonicalTypeBytes)
                      .bytesValue;
  if (root.type != AncPrivateVaultCanonicalTypeMap ||
      !ExactKeys(artifactMap, artifactKeys) ||
      ![Field(artifactMap, @1, AncPrivateVaultCanonicalTypeText).textValue
          isEqualToString:@"anc/v1"] ||
      ![Field(artifactMap, @3, AncPrivateVaultCanonicalTypeText).textValue
          isEqualToString:@"enrollment-offer-artifact"] ||
      ![vault isEqualToData:expectedVaultId] || offer.length == 0 ||
      offer.length > 1024 || hash.length != 32 || proof.length != 64)
    return nil;
  AncPrivateVaultEnrollmentOfferStatus offerStatus;
  AncPrivateVaultEnrollmentOfferResult *verified =
      AncPrivateVaultEnrollmentOfferVerify(offer, proof, expectedVaultId,
                                           &offerStatus);
  if (verified == nil || ![verified.offerHash isEqualToData:hash])
    return nil;
  AncPrivateVaultEnrollmentOfferArtifact *result =
      class_createInstance(AncPrivateVaultEnrollmentOfferArtifact.class, 0);
  result.vaultId = [vault copy];
  result.endpointId = [verified.endpointId copy];
  result.ceremonyId = [verified.ceremonyId copy];
  result.membershipRole = [verified.membershipRole copy];
  result.signingPublicKey = [verified.signingPublicKey copy];
  result.keyAgreementPublicKey = [verified.keyAgreementPublicKey copy];
  result.encodedOffer = [offer copy];
  result.offerHash = [hash copy];
  result.candidateKeyProof = [proof copy];
  return result;
}

@implementation AncPrivateVaultEnrollmentOfferArtifactStore
- (instancetype)initWithKeychain:(AncPrivateVaultKeychain *)keychain
                         recordId:(NSString *)recordId {
  self = [super init];
  if (self == nil || keychain == nil || recordId.length == 0)
    return nil;
  _keychain = keychain;
  _recordId = [recordId copy];
  return self;
}

- (AncPrivateVaultEnrollmentOfferArtifactStatus)
    storeVaultId:(NSData *)vaultId
     encodedOffer:(NSData *)encodedOffer
         offerHash:(NSData *)offerHash
  candidateKeyProof:(NSData *)candidateKeyProof {
  NSString *vault = Hex(vaultId);
  if (vault == nil || encodedOffer.length == 0 || encodedOffer.length > 1024 ||
      offerHash.length != 32 || candidateKeyProof.length != 64)
    return AncPrivateVaultEnrollmentOfferArtifactStatusInvalid;
  AncPrivateVaultCanonicalValue *root = [AncPrivateVaultCanonicalValue map:@{
    @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
    @2 : [AncPrivateVaultCanonicalValue bytes:vaultId],
    @3 : [AncPrivateVaultCanonicalValue text:@"enrollment-offer-artifact"],
    @600 : [AncPrivateVaultCanonicalValue bytes:encodedOffer],
    @601 : [AncPrivateVaultCanonicalValue bytes:offerHash],
    @602 : [AncPrivateVaultCanonicalValue bytes:candidateKeyProof],
  }];
  AncPrivateVaultCanonicalStatus canonicalStatus;
  NSData *encoded = root == nil
                        ? nil
                        : AncPrivateVaultCanonicalEncode(root, &canonicalStatus);
  if (encoded == nil || DecodeArtifact(encoded, vaultId) == nil)
    return AncPrivateVaultEnrollmentOfferArtifactStatusInvalid;
  AncPrivateVaultKeychainStatus stored =
      [self.keychain addData:encoded
                  forService:AncPrivateVaultEnrollmentOfferService
                     vaultId:vault
                    recordId:self.recordId];
  if (stored != AncPrivateVaultKeychainStatusDuplicate)
    return MapStatus(stored);
  NSData *existing = nil;
  AncPrivateVaultKeychainStatus read =
      [self.keychain copyDataForService:AncPrivateVaultEnrollmentOfferService
                               vaultId:vault
                              recordId:self.recordId
                                  data:&existing];
  if (read != AncPrivateVaultKeychainStatusOK)
    return MapStatus(read);
  return [existing isEqualToData:encoded]
             ? AncPrivateVaultEnrollmentOfferArtifactStatusOK
             : AncPrivateVaultEnrollmentOfferArtifactStatusConflict;
}

- (AncPrivateVaultEnrollmentOfferArtifactStatus)
    readVaultId:(NSData *)vaultId
       artifact:(AncPrivateVaultEnrollmentOfferArtifact **)artifact {
  if (artifact == NULL)
    return AncPrivateVaultEnrollmentOfferArtifactStatusInvalid;
  *artifact = nil;
  NSString *vault = Hex(vaultId);
  if (vault == nil)
    return AncPrivateVaultEnrollmentOfferArtifactStatusInvalid;
  NSData *encoded = nil;
  AncPrivateVaultKeychainStatus read =
      [self.keychain copyDataForService:AncPrivateVaultEnrollmentOfferService
                               vaultId:vault
                              recordId:self.recordId
                                  data:&encoded];
  if (read != AncPrivateVaultKeychainStatusOK)
    return MapStatus(read);
  AncPrivateVaultEnrollmentOfferArtifact *decoded =
      DecodeArtifact(encoded, vaultId);
  if (decoded == nil)
    return AncPrivateVaultEnrollmentOfferArtifactStatusCorrupt;
  *artifact = decoded;
  return AncPrivateVaultEnrollmentOfferArtifactStatusOK;
}

- (AncPrivateVaultEnrollmentOfferArtifactStatus)
    deleteVaultId:(NSData *)vaultId expectedOfferHash:(NSData *)offerHash {
  AncPrivateVaultEnrollmentOfferArtifact *artifact = nil;
  AncPrivateVaultEnrollmentOfferArtifactStatus read =
      [self readVaultId:vaultId artifact:&artifact];
  if (read != AncPrivateVaultEnrollmentOfferArtifactStatusOK)
    return read;
  if (offerHash.length != 32 || ![artifact.offerHash isEqualToData:offerHash])
    return AncPrivateVaultEnrollmentOfferArtifactStatusConflict;
  return MapStatus(
      [self.keychain deleteDataForService:AncPrivateVaultEnrollmentOfferService
                                  vaultId:Hex(vaultId)
                                 recordId:self.recordId]);
}
@end
