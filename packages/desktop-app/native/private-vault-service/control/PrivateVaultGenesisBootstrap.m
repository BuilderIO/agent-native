#import "PrivateVaultGenesisBootstrap.h"

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"

#import <objc/runtime.h>

static const NSUInteger kTranscriptMaximumBytes = 4 * 1024;
static const NSUInteger kConfirmationMaximumBytes = 64 * 1024;
static const uint64_t kMaximumSafeInteger = UINT64_C(9007199254740991);
static const uint8_t kTranscriptDomain[] =
    "anc/v1/genesis-bootstrap-transcript";
static const uint8_t kConfirmationDomain[] =
    "anc/v1/genesis-recovery-confirmation";

@interface AncPrivateVaultGenesisRecoveryConfirmation ()
- (instancetype)initPrivateWithVaultId:(NSData *)vaultId
                            ceremonyId:(NSData *)ceremonyId
                            endpointId:(NSData *)endpointId
                            recoveryId:(NSData *)recoveryId
              recoverySigningPublicKey:(NSData *)recoverySigningPublicKey
         recoveryKeyAgreementPublicKey:(NSData *)recoveryKeyAgreementPublicKey
                      recoveryWrapHash:(NSData *)recoveryWrapHash
                           confirmedAt:(uint64_t)confirmedAt
                    recoveryGeneration:(uint64_t)recoveryGeneration;
@end
@implementation AncPrivateVaultGenesisRecoveryConfirmation
@synthesize vaultId = _vaultId;
@synthesize ceremonyId = _ceremonyId;
@synthesize endpointId = _endpointId;
@synthesize recoveryId = _recoveryId;
@synthesize recoverySigningPublicKey = _recoverySigningPublicKey;
@synthesize recoveryKeyAgreementPublicKey = _recoveryKeyAgreementPublicKey;
@synthesize recoveryWrapHash = _recoveryWrapHash;
@synthesize confirmedAt = _confirmedAt;
@synthesize recoveryGeneration = _recoveryGeneration;
+ (BOOL)accessInstanceVariablesDirectly {
  return NO;
}
- (instancetype)initPrivateWithVaultId:(NSData *)vaultId
                            ceremonyId:(NSData *)ceremonyId
                            endpointId:(NSData *)endpointId
                            recoveryId:(NSData *)recoveryId
              recoverySigningPublicKey:(NSData *)recoverySigningPublicKey
         recoveryKeyAgreementPublicKey:(NSData *)recoveryKeyAgreementPublicKey
                      recoveryWrapHash:(NSData *)recoveryWrapHash
                           confirmedAt:(uint64_t)confirmedAt
                    recoveryGeneration:(uint64_t)recoveryGeneration {
  self = [super init];
  if (self != nil) {
    _vaultId = [vaultId copy];
    _ceremonyId = [ceremonyId copy];
    _endpointId = [endpointId copy];
    _recoveryId = [recoveryId copy];
    _recoverySigningPublicKey = [recoverySigningPublicKey copy];
    _recoveryKeyAgreementPublicKey = [recoveryKeyAgreementPublicKey copy];
    _recoveryWrapHash = [recoveryWrapHash copy];
    _confirmedAt = confirmedAt;
    _recoveryGeneration = recoveryGeneration;
  }
  return self;
}
@end

@interface AncPrivateVaultGenesisBootstrapTranscript ()
- (instancetype)initPrivateWithVaultId:(NSData *)vaultId
                            ceremonyId:(NSData *)ceremonyId
                            endpointId:(NSData *)endpointId
              endpointSigningPublicKey:(NSData *)endpointSigningPublicKey
         endpointKeyAgreementPublicKey:(NSData *)endpointKeyAgreementPublicKey
                         enrollmentRef:(NSData *)enrollmentRef
                            recoveryId:(NSData *)recoveryId
              recoverySigningPublicKey:(NSData *)recoverySigningPublicKey
         recoveryKeyAgreementPublicKey:(NSData *)recoveryKeyAgreementPublicKey
                    recoveryGeneration:(uint64_t)recoveryGeneration
                                 epoch:(uint64_t)epoch
                      recoveryWrapHash:(NSData *)recoveryWrapHash
              recoveryConfirmationHash:(NSData *)recoveryConfirmationHash;
@end
@implementation AncPrivateVaultGenesisBootstrapTranscript
@synthesize vaultId = _vaultId;
@synthesize ceremonyId = _ceremonyId;
@synthesize endpointId = _endpointId;
@synthesize endpointSigningPublicKey = _endpointSigningPublicKey;
@synthesize endpointKeyAgreementPublicKey = _endpointKeyAgreementPublicKey;
@synthesize enrollmentRef = _enrollmentRef;
@synthesize recoveryId = _recoveryId;
@synthesize recoverySigningPublicKey = _recoverySigningPublicKey;
@synthesize recoveryKeyAgreementPublicKey = _recoveryKeyAgreementPublicKey;
@synthesize recoveryGeneration = _recoveryGeneration;
@synthesize epoch = _epoch;
@synthesize recoveryWrapHash = _recoveryWrapHash;
@synthesize recoveryConfirmationHash = _recoveryConfirmationHash;
+ (BOOL)accessInstanceVariablesDirectly {
  return NO;
}
- (instancetype)initPrivateWithVaultId:(NSData *)vaultId
                            ceremonyId:(NSData *)ceremonyId
                            endpointId:(NSData *)endpointId
              endpointSigningPublicKey:(NSData *)endpointSigningPublicKey
         endpointKeyAgreementPublicKey:(NSData *)endpointKeyAgreementPublicKey
                         enrollmentRef:(NSData *)enrollmentRef
                            recoveryId:(NSData *)recoveryId
              recoverySigningPublicKey:(NSData *)recoverySigningPublicKey
         recoveryKeyAgreementPublicKey:(NSData *)recoveryKeyAgreementPublicKey
                    recoveryGeneration:(uint64_t)recoveryGeneration
                                 epoch:(uint64_t)epoch
                      recoveryWrapHash:(NSData *)recoveryWrapHash
              recoveryConfirmationHash:(NSData *)recoveryConfirmationHash {
  self = [super init];
  if (self != nil) {
    _vaultId = [vaultId copy];
    _ceremonyId = [ceremonyId copy];
    _endpointId = [endpointId copy];
    _endpointSigningPublicKey = [endpointSigningPublicKey copy];
    _endpointKeyAgreementPublicKey = [endpointKeyAgreementPublicKey copy];
    _enrollmentRef = [enrollmentRef copy];
    _recoveryId = [recoveryId copy];
    _recoverySigningPublicKey = [recoverySigningPublicKey copy];
    _recoveryKeyAgreementPublicKey = [recoveryKeyAgreementPublicKey copy];
    _recoveryGeneration = recoveryGeneration;
    _epoch = epoch;
    _recoveryWrapHash = [recoveryWrapHash copy];
    _recoveryConfirmationHash = [recoveryConfirmationHash copy];
  }
  return self;
}
@end

@interface AncPrivateVaultGenesisBootstrapResult ()
- (instancetype)initPrivateWithTranscript:
                    (AncPrivateVaultGenesisBootstrapTranscript *)transcript
                                   digest:(NSData *)digest;
@end
@implementation AncPrivateVaultGenesisBootstrapResult
@synthesize transcript = _transcript;
@synthesize digest = _digest;
+ (BOOL)accessInstanceVariablesDirectly {
  return NO;
}
- (instancetype)initPrivateWithTranscript:
                    (AncPrivateVaultGenesisBootstrapTranscript *)transcript
                                   digest:(NSData *)digest {
  self = [super init];
  if (self != nil) {
    _transcript = transcript;
    _digest = [digest copy];
  }
  return self;
}
@end

static void SetStatus(AncPrivateVaultGenesisBootstrapStatus *status,
                      AncPrivateVaultGenesisBootstrapStatus value) {
  if (status != NULL)
    *status = value;
}

static BOOL Equal(NSData *left, NSData *right) {
  return left.length == right.length && [left isEqualToData:right];
}

static BOOL HasExactKeys(NSDictionary<NSNumber *, id> *map,
                         NSArray<NSNumber *> *allowed,
                         AncPrivateVaultGenesisBootstrapStatus *status) {
  NSSet<NSNumber *> *allowedSet = [NSSet setWithArray:allowed];
  for (NSNumber *key in map) {
    if (![allowedSet containsObject:key]) {
      SetStatus(status, AncPrivateVaultGenesisBootstrapStatusUnknownField);
      return NO;
    }
  }
  if (map.count != allowed.count) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusMissingField);
    return NO;
  }
  for (NSNumber *key in allowed) {
    if (map[key] == nil) {
      SetStatus(status, AncPrivateVaultGenesisBootstrapStatusMissingField);
      return NO;
    }
  }
  return YES;
}

static NSData *ReadBytes(AncPrivateVaultCanonicalValue *value,
                         NSUInteger length,
                         AncPrivateVaultGenesisBootstrapStatus *status) {
  if (value.type != AncPrivateVaultCanonicalTypeBytes) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusWrongType);
    return nil;
  }
  if (value.bytesValue.length != length) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusWrongLength);
    return nil;
  }
  return [value.bytesValue copy];
}

static BOOL ReadLiteral(AncPrivateVaultCanonicalValue *value, NSString *literal,
                        AncPrivateVaultGenesisBootstrapStatus *status) {
  if (value.type != AncPrivateVaultCanonicalTypeText) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusWrongType);
    return NO;
  }
  if (![value.textValue isEqualToString:literal]) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusWrongLiteral);
    return NO;
  }
  return YES;
}

static BOOL ReadInteger(AncPrivateVaultCanonicalValue *value, uint64_t minimum,
                        uint64_t *output,
                        AncPrivateVaultGenesisBootstrapStatus *status) {
  if (value.type != AncPrivateVaultCanonicalTypeInteger) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusWrongType);
    return NO;
  }
  if (value.integerValue < 0 || (uint64_t)value.integerValue < minimum ||
      (uint64_t)value.integerValue > kMaximumSafeInteger) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusOutOfRange);
    return NO;
  }
  *output = (uint64_t)value.integerValue;
  return YES;
}

static NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *
DecodeMap(NSData *encoded, NSUInteger maximum,
          AncPrivateVaultGenesisBootstrapStatus oversizedStatus,
          AncPrivateVaultGenesisBootstrapStatus *status) {
  if (encoded.length == 0 || encoded.length > maximum) {
    SetStatus(status, oversizedStatus);
    return nil;
  }
  AncPrivateVaultCanonicalStatus canonicalStatus;
  AncPrivateVaultCanonicalValue *root =
      AncPrivateVaultCanonicalDecode(encoded, maximum, &canonicalStatus);
  if (root == nil) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusInvalidCanonical);
    return nil;
  }
  if (root.type != AncPrivateVaultCanonicalTypeMap) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusWrongType);
    return nil;
  }
  return root.mapValue;
}

static NSData *DomainHash(const uint8_t *domain, size_t domainLength,
                          NSData *encoded) {
  NSMutableData *message = [NSMutableData dataWithBytes:domain
                                                 length:domainLength];
  [message appendData:encoded];
  uint8_t digest[32] = {0};
  BOOL okay = anc_pv_blake2b_256(digest, message.bytes, message.length) ==
              ANC_PV_CRYPTO_OK;
  anc_pv_zeroize(message.mutableBytes, message.length);
  NSData *result =
      okay ? [NSData dataWithBytes:digest length:sizeof digest] : nil;
  anc_pv_zeroize(digest, sizeof digest);
  return result;
}

static NSData *
EncodeMap(NSDictionary<NSNumber *, AncPrivateVaultCanonicalValue *> *map,
          AncPrivateVaultGenesisBootstrapStatus *status) {
  AncPrivateVaultCanonicalStatus canonicalStatus;
  NSData *encoded = AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:map], &canonicalStatus);
  SetStatus(status, encoded == nil
                        ? AncPrivateVaultGenesisBootstrapStatusWrongType
                        : AncPrivateVaultGenesisBootstrapStatusOK);
  return encoded;
}

AncPrivateVaultGenesisRecoveryConfirmation *
AncPrivateVaultGenesisRecoveryConfirmationDecode(
    NSData *encoded, NSData *expectedVaultId,
    AncPrivateVaultGenesisBootstrapStatus *status) {
  SetStatus(status, AncPrivateVaultGenesisBootstrapStatusInvalidCanonical);
  NSData *encodedSnapshot = [encoded copy];
  NSData *vaultSnapshot = [expectedVaultId copy];
  if (vaultSnapshot.length != 16) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusWrongLength);
    return nil;
  }
  NSDictionary *map =
      DecodeMap(encodedSnapshot, kConfirmationMaximumBytes,
                AncPrivateVaultGenesisBootstrapStatusInvalidCanonical, status);
  NSArray *keys =
      @[ @1, @2, @3, @360, @361, @362, @363, @364, @365, @366, @367 ];
  if (map == nil || !HasExactKeys(map, keys, status))
    return nil;
  if (!ReadLiteral(map[@1], @"anc/v1", status) ||
      !ReadLiteral(map[@3], @"genesis-recovery-confirmation", status))
    return nil;
  NSData *vaultId = ReadBytes(map[@2], 16, status);
  NSData *ceremonyId = ReadBytes(map[@360], 16, status);
  NSData *endpointId = ReadBytes(map[@361], 16, status);
  NSData *recoveryId = ReadBytes(map[@362], 16, status);
  NSData *recoverySigningPublicKey = ReadBytes(map[@363], 32, status);
  NSData *recoveryKeyAgreementPublicKey = ReadBytes(map[@364], 32, status);
  NSData *recoveryWrapHash = ReadBytes(map[@365], 32, status);
  if (vaultId == nil || ceremonyId == nil || endpointId == nil ||
      recoveryId == nil || recoverySigningPublicKey == nil ||
      recoveryKeyAgreementPublicKey == nil || recoveryWrapHash == nil)
    return nil;
  if (!Equal(vaultId, vaultSnapshot)) {
    SetStatus(status,
              AncPrivateVaultGenesisBootstrapStatusConfirmationVaultBinding);
    return nil;
  }
  uint64_t confirmedAt = 0;
  uint64_t generation = 0;
  if (!ReadInteger(map[@366], 1, &confirmedAt, status) ||
      !ReadInteger(map[@367], 1, &generation, status))
    return nil;
  if (generation != 1) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusOutOfRange);
    return nil;
  }
  AncPrivateVaultGenesisRecoveryConfirmation *confirmation =
      [[AncPrivateVaultGenesisRecoveryConfirmation alloc]
                 initPrivateWithVaultId:vaultId
                             ceremonyId:ceremonyId
                             endpointId:endpointId
                             recoveryId:recoveryId
               recoverySigningPublicKey:recoverySigningPublicKey
          recoveryKeyAgreementPublicKey:recoveryKeyAgreementPublicKey
                       recoveryWrapHash:recoveryWrapHash
                            confirmedAt:confirmedAt
                     recoveryGeneration:generation];
  SetStatus(status, AncPrivateVaultGenesisBootstrapStatusOK);
  return confirmation;
}

NSData *AncPrivateVaultGenesisRecoveryConfirmationEncode(
    AncPrivateVaultGenesisRecoveryConfirmation *confirmation,
    AncPrivateVaultGenesisBootstrapStatus *status) {
  if (confirmation == nil ||
      object_getClass(confirmation) !=
          AncPrivateVaultGenesisRecoveryConfirmation.class) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusWrongType);
    return nil;
  }
  NSData *vaultId = [confirmation.vaultId copy];
  NSData *ceremonyId = [confirmation.ceremonyId copy];
  NSData *endpointId = [confirmation.endpointId copy];
  NSData *recoveryId = [confirmation.recoveryId copy];
  NSData *recoverySigningPublicKey =
      [confirmation.recoverySigningPublicKey copy];
  NSData *recoveryKeyAgreementPublicKey =
      [confirmation.recoveryKeyAgreementPublicKey copy];
  NSData *recoveryWrapHash = [confirmation.recoveryWrapHash copy];
  uint64_t confirmedAt = confirmation.confirmedAt;
  uint64_t recoveryGeneration = confirmation.recoveryGeneration;
  if (vaultId.length != 16 || ceremonyId.length != 16 ||
      endpointId.length != 16 || recoveryId.length != 16 ||
      recoverySigningPublicKey.length != 32 ||
      recoveryKeyAgreementPublicKey.length != 32 ||
      recoveryWrapHash.length != 32) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusWrongLength);
    return nil;
  }
  if (confirmedAt < 1 || confirmedAt > kMaximumSafeInteger ||
      recoveryGeneration != 1) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusOutOfRange);
    return nil;
  }
  return EncodeMap(
      @{
        @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
        @2 : [AncPrivateVaultCanonicalValue bytes:vaultId],
        @3 : [AncPrivateVaultCanonicalValue
            text:@"genesis-recovery-confirmation"],
        @360 : [AncPrivateVaultCanonicalValue bytes:ceremonyId],
        @361 : [AncPrivateVaultCanonicalValue bytes:endpointId],
        @362 : [AncPrivateVaultCanonicalValue bytes:recoveryId],
        @363 : [AncPrivateVaultCanonicalValue bytes:recoverySigningPublicKey],
        @364 :
            [AncPrivateVaultCanonicalValue bytes:recoveryKeyAgreementPublicKey],
        @365 : [AncPrivateVaultCanonicalValue bytes:recoveryWrapHash],
        @366 : [AncPrivateVaultCanonicalValue integer:(int64_t)confirmedAt],
        @367 : [AncPrivateVaultCanonicalValue integer:1],
      },
      status);
}

NSData *AncPrivateVaultGenesisRecoveryConfirmationHash(
    NSData *encoded, NSData *expectedVaultId,
    AncPrivateVaultGenesisBootstrapStatus *status) {
  NSData *encodedSnapshot = [encoded copy];
  NSData *vaultSnapshot = [expectedVaultId copy];
  AncPrivateVaultGenesisRecoveryConfirmation *confirmation =
      AncPrivateVaultGenesisRecoveryConfirmationDecode(encodedSnapshot,
                                                       vaultSnapshot, status);
  if (confirmation == nil)
    return nil;
  NSData *roundTrip =
      AncPrivateVaultGenesisRecoveryConfirmationEncode(confirmation, status);
  if (roundTrip == nil || !Equal(roundTrip, encodedSnapshot)) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusInvalidCanonical);
    return nil;
  }
  NSData *digest = DomainHash(kConfirmationDomain, sizeof kConfirmationDomain,
                              encodedSnapshot);
  SetStatus(status, digest == nil
                        ? AncPrivateVaultGenesisBootstrapStatusCryptoDomain
                        : AncPrivateVaultGenesisBootstrapStatusOK);
  return digest;
}

AncPrivateVaultGenesisBootstrapTranscript *
AncPrivateVaultGenesisBootstrapDecode(
    NSData *encoded, NSData *expectedVaultId,
    AncPrivateVaultGenesisBootstrapStatus *status) {
  SetStatus(status, AncPrivateVaultGenesisBootstrapStatusInvalidCanonical);
  NSData *encodedSnapshot = [encoded copy];
  NSData *vaultSnapshot = [expectedVaultId copy];
  if (vaultSnapshot != nil && vaultSnapshot.length != 16) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusWrongLength);
    return nil;
  }
  NSDictionary *map = DecodeMap(
      encodedSnapshot, kTranscriptMaximumBytes,
      AncPrivateVaultGenesisBootstrapStatusTranscriptTooLarge, status);
  NSArray *keys = @[
    @1, @2, @3, @380, @381, @382, @383, @384, @385, @386, @387, @388, @389,
    @390, @391
  ];
  if (map == nil || !HasExactKeys(map, keys, status))
    return nil;
  if (!ReadLiteral(map[@1], @"anc/v1", status) ||
      !ReadLiteral(map[@3], @"genesis-bootstrap-transcript", status))
    return nil;
  NSData *vaultId = ReadBytes(map[@2], 16, status);
  NSData *ceremonyId = ReadBytes(map[@380], 16, status);
  NSData *endpointId = ReadBytes(map[@381], 16, status);
  NSData *endpointSigningPublicKey = ReadBytes(map[@382], 32, status);
  NSData *endpointKeyAgreementPublicKey = ReadBytes(map[@383], 32, status);
  NSData *enrollmentRef = ReadBytes(map[@384], 16, status);
  NSData *recoveryId = ReadBytes(map[@385], 16, status);
  NSData *recoverySigningPublicKey = ReadBytes(map[@386], 32, status);
  NSData *recoveryKeyAgreementPublicKey = ReadBytes(map[@387], 32, status);
  NSData *recoveryWrapHash = ReadBytes(map[@390], 32, status);
  NSData *recoveryConfirmationHash = ReadBytes(map[@391], 32, status);
  if (vaultId == nil || ceremonyId == nil || endpointId == nil ||
      endpointSigningPublicKey == nil || endpointKeyAgreementPublicKey == nil ||
      enrollmentRef == nil || recoveryId == nil ||
      recoverySigningPublicKey == nil || recoveryKeyAgreementPublicKey == nil ||
      recoveryWrapHash == nil || recoveryConfirmationHash == nil)
    return nil;
  uint64_t generation = 0;
  uint64_t epoch = 0;
  if (!ReadInteger(map[@388], 1, &generation, status) ||
      !ReadInteger(map[@389], 1, &epoch, status))
    return nil;
  if (generation != 1 || epoch != 1) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusOutOfRange);
    return nil;
  }
  if (vaultSnapshot != nil && !Equal(vaultId, vaultSnapshot)) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusVaultBinding);
    return nil;
  }
  AncPrivateVaultGenesisBootstrapTranscript *transcript =
      [[AncPrivateVaultGenesisBootstrapTranscript alloc]
                 initPrivateWithVaultId:vaultId
                             ceremonyId:ceremonyId
                             endpointId:endpointId
               endpointSigningPublicKey:endpointSigningPublicKey
          endpointKeyAgreementPublicKey:endpointKeyAgreementPublicKey
                          enrollmentRef:enrollmentRef
                             recoveryId:recoveryId
               recoverySigningPublicKey:recoverySigningPublicKey
          recoveryKeyAgreementPublicKey:recoveryKeyAgreementPublicKey
                     recoveryGeneration:generation
                                  epoch:epoch
                       recoveryWrapHash:recoveryWrapHash
               recoveryConfirmationHash:recoveryConfirmationHash];
  SetStatus(status, AncPrivateVaultGenesisBootstrapStatusOK);
  return transcript;
}

NSData *AncPrivateVaultGenesisBootstrapEncode(
    AncPrivateVaultGenesisBootstrapTranscript *transcript,
    AncPrivateVaultGenesisBootstrapStatus *status) {
  if (transcript == nil ||
      object_getClass(transcript) !=
          AncPrivateVaultGenesisBootstrapTranscript.class) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusWrongType);
    return nil;
  }
  NSData *vaultId = [transcript.vaultId copy];
  NSData *ceremonyId = [transcript.ceremonyId copy];
  NSData *endpointId = [transcript.endpointId copy];
  NSData *endpointSigningPublicKey = [transcript.endpointSigningPublicKey copy];
  NSData *endpointKeyAgreementPublicKey =
      [transcript.endpointKeyAgreementPublicKey copy];
  NSData *enrollmentRef = [transcript.enrollmentRef copy];
  NSData *recoveryId = [transcript.recoveryId copy];
  NSData *recoverySigningPublicKey = [transcript.recoverySigningPublicKey copy];
  NSData *recoveryKeyAgreementPublicKey =
      [transcript.recoveryKeyAgreementPublicKey copy];
  uint64_t recoveryGeneration = transcript.recoveryGeneration;
  uint64_t epoch = transcript.epoch;
  NSData *recoveryWrapHash = [transcript.recoveryWrapHash copy];
  NSData *recoveryConfirmationHash = [transcript.recoveryConfirmationHash copy];
  if (vaultId.length != 16 || ceremonyId.length != 16 ||
      endpointId.length != 16 || endpointSigningPublicKey.length != 32 ||
      endpointKeyAgreementPublicKey.length != 32 ||
      enrollmentRef.length != 16 || recoveryId.length != 16 ||
      recoverySigningPublicKey.length != 32 ||
      recoveryKeyAgreementPublicKey.length != 32 ||
      recoveryWrapHash.length != 32 || recoveryConfirmationHash.length != 32) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusWrongLength);
    return nil;
  }
  if (recoveryGeneration != 1 || epoch != 1) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusOutOfRange);
    return nil;
  }
  return EncodeMap(
      @{
        @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
        @2 : [AncPrivateVaultCanonicalValue bytes:vaultId],
        @3 : [AncPrivateVaultCanonicalValue
            text:@"genesis-bootstrap-transcript"],
        @380 : [AncPrivateVaultCanonicalValue bytes:ceremonyId],
        @381 : [AncPrivateVaultCanonicalValue bytes:endpointId],
        @382 : [AncPrivateVaultCanonicalValue bytes:endpointSigningPublicKey],
        @383 :
            [AncPrivateVaultCanonicalValue bytes:endpointKeyAgreementPublicKey],
        @384 : [AncPrivateVaultCanonicalValue bytes:enrollmentRef],
        @385 : [AncPrivateVaultCanonicalValue bytes:recoveryId],
        @386 : [AncPrivateVaultCanonicalValue bytes:recoverySigningPublicKey],
        @387 :
            [AncPrivateVaultCanonicalValue bytes:recoveryKeyAgreementPublicKey],
        @388 : [AncPrivateVaultCanonicalValue integer:1],
        @389 : [AncPrivateVaultCanonicalValue integer:1],
        @390 : [AncPrivateVaultCanonicalValue bytes:recoveryWrapHash],
        @391 : [AncPrivateVaultCanonicalValue bytes:recoveryConfirmationHash],
      },
      status);
}

NSData *AncPrivateVaultGenesisBootstrapHash(
    NSData *encoded, NSData *expectedVaultId,
    AncPrivateVaultGenesisBootstrapStatus *status) {
  NSData *encodedSnapshot = [encoded copy];
  NSData *vaultSnapshot = [expectedVaultId copy];
  AncPrivateVaultGenesisBootstrapTranscript *transcript =
      AncPrivateVaultGenesisBootstrapDecode(encodedSnapshot, vaultSnapshot,
                                            status);
  if (transcript == nil)
    return nil;
  NSData *roundTrip = AncPrivateVaultGenesisBootstrapEncode(transcript, status);
  if (roundTrip == nil || !Equal(roundTrip, encodedSnapshot)) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusInvalidCanonical);
    return nil;
  }
  NSData *digest =
      DomainHash(kTranscriptDomain, sizeof kTranscriptDomain, encodedSnapshot);
  SetStatus(status, digest == nil
                        ? AncPrivateVaultGenesisBootstrapStatusCryptoDomain
                        : AncPrivateVaultGenesisBootstrapStatusOK);
  return digest;
}

AncPrivateVaultGenesisBootstrapResult *AncPrivateVaultGenesisBootstrapVerify(
    NSData *encoded, NSData *recoveryConfirmation, NSData *expectedVaultId,
    AncPrivateVaultGenesisBootstrapStatus *status) {
  NSData *encodedSnapshot = [encoded copy];
  NSData *confirmationSnapshot = [recoveryConfirmation copy];
  NSData *vaultSnapshot = [expectedVaultId copy];
  AncPrivateVaultGenesisBootstrapTranscript *transcript =
      AncPrivateVaultGenesisBootstrapDecode(encodedSnapshot, vaultSnapshot,
                                            status);
  if (transcript == nil)
    return nil;
  AncPrivateVaultGenesisRecoveryConfirmation *confirmation =
      AncPrivateVaultGenesisRecoveryConfirmationDecode(
          confirmationSnapshot, transcript.vaultId, status);
  if (confirmation == nil)
    return nil;
  if (!Equal(confirmation.ceremonyId, transcript.ceremonyId)) {
    SetStatus(status,
              AncPrivateVaultGenesisBootstrapStatusConfirmationCeremonyBinding);
    return nil;
  }
  if (!Equal(confirmation.endpointId, transcript.endpointId)) {
    SetStatus(status,
              AncPrivateVaultGenesisBootstrapStatusConfirmationEndpointBinding);
    return nil;
  }
  if (!Equal(confirmation.recoveryId, transcript.recoveryId) ||
      !Equal(confirmation.recoverySigningPublicKey,
             transcript.recoverySigningPublicKey) ||
      !Equal(confirmation.recoveryKeyAgreementPublicKey,
             transcript.recoveryKeyAgreementPublicKey) ||
      confirmation.recoveryGeneration != transcript.recoveryGeneration ||
      !Equal(confirmation.recoveryWrapHash, transcript.recoveryWrapHash)) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusConfirmationBinding);
    return nil;
  }
  NSData *confirmationHash = AncPrivateVaultGenesisRecoveryConfirmationHash(
      confirmationSnapshot, transcript.vaultId, status);
  if (confirmationHash == nil)
    return nil;
  if (!Equal(confirmationHash, transcript.recoveryConfirmationHash)) {
    SetStatus(status,
              AncPrivateVaultGenesisBootstrapStatusConfirmationHashBinding);
    return nil;
  }
  NSData *digest = AncPrivateVaultGenesisBootstrapHash(encodedSnapshot,
                                                       vaultSnapshot, status);
  if (digest == nil)
    return nil;
  AncPrivateVaultGenesisBootstrapResult *result =
      [[AncPrivateVaultGenesisBootstrapResult alloc]
          initPrivateWithTranscript:transcript
                             digest:digest];
  SetStatus(status, AncPrivateVaultGenesisBootstrapStatusOK);
  return result;
}

NSData *AncPrivateVaultGenesisBootstrapVerifyDigest(
    NSData *encoded, NSData *expectedVaultId, NSData *expectedDigest,
    AncPrivateVaultGenesisBootstrapStatus *status) {
  NSData *encodedSnapshot = [encoded copy];
  NSData *vaultSnapshot = [expectedVaultId copy];
  NSData *digestSnapshot = [expectedDigest copy];
  if (digestSnapshot.length != 32) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusWrongLength);
    return nil;
  }
  NSData *digest = AncPrivateVaultGenesisBootstrapHash(encodedSnapshot,
                                                       vaultSnapshot, status);
  if (digest == nil)
    return nil;
  if (!Equal(digest, digestSnapshot)) {
    SetStatus(status, AncPrivateVaultGenesisBootstrapStatusCryptoDomain);
    return nil;
  }
  SetStatus(status, AncPrivateVaultGenesisBootstrapStatusOK);
  return digest;
}

NSString *AncPrivateVaultGenesisBootstrapCategory(
    AncPrivateVaultGenesisBootstrapStatus status) {
  switch (status) {
  case AncPrivateVaultGenesisBootstrapStatusOK:
    return @"ok";
  case AncPrivateVaultGenesisBootstrapStatusInvalidCanonical:
    return @"wire.invalid_canonical";
  case AncPrivateVaultGenesisBootstrapStatusMissingField:
    return @"wire.missing_field";
  case AncPrivateVaultGenesisBootstrapStatusUnknownField:
    return @"wire.unknown_field";
  case AncPrivateVaultGenesisBootstrapStatusWrongType:
    return @"wire.wrong_type";
  case AncPrivateVaultGenesisBootstrapStatusWrongLiteral:
    return @"wire.wrong_literal";
  case AncPrivateVaultGenesisBootstrapStatusWrongLength:
    return @"wire.length";
  case AncPrivateVaultGenesisBootstrapStatusOutOfRange:
    return @"wire.range";
  case AncPrivateVaultGenesisBootstrapStatusTranscriptTooLarge:
    return @"limits.transcript";
  case AncPrivateVaultGenesisBootstrapStatusVaultBinding:
    return @"binding.vault";
  case AncPrivateVaultGenesisBootstrapStatusConfirmationVaultBinding:
    return @"binding.confirmation_vault";
  case AncPrivateVaultGenesisBootstrapStatusConfirmationCeremonyBinding:
    return @"binding.confirmation_ceremony";
  case AncPrivateVaultGenesisBootstrapStatusConfirmationEndpointBinding:
    return @"binding.confirmation_endpoint";
  case AncPrivateVaultGenesisBootstrapStatusConfirmationBinding:
    return @"binding.confirmation";
  case AncPrivateVaultGenesisBootstrapStatusConfirmationHashBinding:
    return @"binding.confirmation_hash";
  case AncPrivateVaultGenesisBootstrapStatusCryptoDomain:
    return @"crypto.domain";
  }
}
