#import <Foundation/Foundation.h>
#import <assert.h>

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultObjectRevision.h"

static NSData *Pattern(uint8_t value, NSUInteger length) {
  NSMutableData *data = [NSMutableData dataWithLength:length];
  memset(data.mutableBytes, value, length);
  return data;
}

static AncPrivateVaultGuardedMemory *Secret(NSData *value) {
  AncPrivateVaultGuardedMemoryStatus status;
  AncPrivateVaultGuardedMemory *memory =
      [AncPrivateVaultGuardedMemory memoryWithLength:value.length status:&status];
  assert(memory != nil && status == AncPrivateVaultGuardedMemoryStatusOK);
  assert([memory borrow:^BOOL(uint8_t *bytes, size_t length) {
           assert(length == value.length);
           memcpy(bytes, value.bytes, length);
           return YES;
         }] == AncPrivateVaultGuardedMemoryStatusOK);
  return memory;
}

static NSString *Hex(NSData *value) {
  const uint8_t *bytes = value.bytes;
  NSMutableString *hex = [NSMutableString stringWithCapacity:value.length * 2];
  for (NSUInteger index = 0; index < value.length; index++)
    [hex appendFormat:@"%02x", bytes[index]];
  return hex;
}

static NSData *DataFromHex(NSString *hex) {
  assert([hex isKindOfClass:NSString.class] && hex.length % 2 == 0);
  NSMutableData *result = [NSMutableData dataWithLength:hex.length / 2];
  uint8_t *bytes = result.mutableBytes;
  for (NSUInteger index = 0; index < result.length; index++) {
    unsigned value = 0;
    NSString *pair = [hex substringWithRange:NSMakeRange(index * 2, 2)];
    NSScanner *scanner = [NSScanner scannerWithString:pair];
    assert([scanner scanHexInt:&value] && scanner.isAtEnd);
    bytes[index] = (uint8_t)value;
  }
  return result;
}

static NSData *ReframeLegacyFixture(NSData *legacy) {
  AncPrivateVaultCanonicalStatus status;
  AncPrivateVaultCanonicalValue *value =
      AncPrivateVaultCanonicalDecode(legacy, 1024 * 1024 + 64 * 1024, &status);
  NSArray *parts = value.type == AncPrivateVaultCanonicalTypeArray
                       ? value.arrayValue
                       : nil;
  assert(parts.count == 3);
  AncPrivateVaultCanonicalValue *bundle = [AncPrivateVaultCanonicalValue map:@{
    @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1-object-bundle"],
    @2 : parts[0],
    @3 : parts[1],
    @4 : parts[2],
  }];
  NSData *encoded = AncPrivateVaultCanonicalEncode(bundle, &status);
  assert(encoded != nil && status == AncPrivateVaultCanonicalStatusOK);
  return encoded;
}

static AncPrivateVaultControlLogState *State(NSData *vaultId,
                                              NSData *writerId,
                                              NSData *signingPublic) {
  AncPrivateVaultControlLogMember *member = [AncPrivateVaultControlLogMember new];
  [member setValue:Hex(writerId) forKey:@"endpointId"];
  [member setValue:@"broker" forKey:@"role"];
  [member setValue:@YES forKey:@"unattended"];
  [member setValue:signingPublic forKey:@"signingPublicKey"];
  [member setValue:Pattern(0x42, 32) forKey:@"keyAgreementPublicKey"];
  [member setValue:Hex(Pattern(0x43, 16)) forKey:@"enrollmentRef"];
  AncPrivateVaultControlLogState *state = [AncPrivateVaultControlLogState new];
  [state setValue:Hex(vaultId) forKey:@"vaultId"];
  [state setValue:@7 forKey:@"epoch"];
  [state setValue:@[member] forKey:@"activeMembers"];
  return state;
}

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    NSData *vaultId = Pattern(0x11, 16);
    NSData *objectId = Pattern(0x22, 16);
    NSData *writerId = Pattern(0x33, 16);
    NSData *signingSeedBytes = Pattern(0x44, 32);
    NSData *epochBytes = Pattern(0x55, 32);
    uint8_t signingPublic[32] = {0}, signingPrivate[64] = {0};
    assert(anc_pv_ed25519_seed_keypair(signingPublic, signingPrivate,
                                       signingSeedBytes.bytes) ==
           ANC_PV_CRYPTO_OK);
    anc_pv_zeroize(signingPrivate, sizeof signingPrivate);
    NSData *signingPublicData =
        [NSData dataWithBytes:signingPublic length:sizeof signingPublic];
    anc_pv_zeroize(signingPublic, sizeof signingPublic);
    AncPrivateVaultControlLogState *state =
        State(vaultId, writerId, signingPublicData);
    NSData *plaintext = [@"{\"content\":\"a private little thought\",\"title\":\"Moon\"}"
        dataUsingEncoding:NSUTF8StringEncoding];
    AncPrivateVaultGuardedMemory *signing = Secret(signingSeedBytes);
    AncPrivateVaultGuardedMemory *epoch = Secret(epochBytes);
    AncPrivateVaultObjectRevisionStatus status;
    AncPrivateVaultSealedObjectRevision *sealed =
        AncPrivateVaultSealObjectRevision(
            vaultId, objectId, writerId, 3, 7,
            @"application/vnd.agent-native.content-document+json", plaintext,
            1721300000, Pattern(0x61, 16), Pattern(0x62, 16),
            Pattern(0x63, 16), Pattern(0x64, 24), state, signing, epoch,
            &status);
    assert(sealed != nil && status == AncPrivateVaultObjectRevisionStatusOK &&
           sealed.revisionId.length == 32 && sealed.revision == 3 &&
           sealed.epoch == 7 &&
           [sealed.encodedRevision rangeOfData:plaintext
                                        options:0
                                          range:NSMakeRange(
                                                    0,
                                                    sealed.encodedRevision.length)]
                   .location == NSNotFound);
    AncPrivateVaultOpenedObjectRevision *opened =
        AncPrivateVaultOpenObjectRevision(sealed.encodedRevision, vaultId,
                                          objectId, state, epoch, &status);
    assert(opened != nil && status == AncPrivateVaultObjectRevisionStatusOK &&
           [opened.plaintext isEqualToData:plaintext] &&
           [opened.revisionId isEqualToData:sealed.revisionId] &&
           [opened.writerEndpointId isEqualToData:writerId]);

    NSMutableData *tampered = [sealed.encodedRevision mutableCopy];
    ((uint8_t *)tampered.mutableBytes)[tampered.length - 1] ^= 1;
    assert(AncPrivateVaultOpenObjectRevision(tampered, vaultId, objectId,
                                             state, epoch, &status) == nil &&
           status != AncPrivateVaultObjectRevisionStatusOK);
    AncPrivateVaultGuardedMemory *wrongEpoch = Secret(Pattern(0x56, 32));
    assert(AncPrivateVaultOpenObjectRevision(
               sealed.encodedRevision, vaultId, objectId, state, wrongEpoch,
               &status) == nil &&
           status == AncPrivateVaultObjectRevisionStatusCrypto);
    assert([wrongEpoch close] == AncPrivateVaultGuardedMemoryStatusOK);
    assert(AncPrivateVaultOpenObjectRevision(
               sealed.encodedRevision, vaultId, Pattern(0x23, 16), state,
               epoch, &status) == nil &&
           status == AncPrivateVaultObjectRevisionStatusBinding);
    AncPrivateVaultControlLogState *wrongWriterState =
        State(vaultId, writerId, Pattern(0x66, 32));
    assert(AncPrivateVaultSealObjectRevision(
               vaultId, objectId, writerId, 4, 7,
               @"application/vnd.agent-native.content-document+json",
               plaintext, 1721300001, Pattern(0x71, 16), Pattern(0x72, 16),
               Pattern(0x73, 16), Pattern(0x74, 24), wrongWriterState,
               signing, epoch, &status) == nil &&
           status == AncPrivateVaultObjectRevisionStatusBinding);
    AncPrivateVaultControlLogState *wrongEpochState =
        State(vaultId, writerId, signingPublicData);
    [wrongEpochState setValue:@8 forKey:@"epoch"];
    assert(AncPrivateVaultSealObjectRevision(
               vaultId, objectId, writerId, 4, 7,
               @"application/vnd.agent-native.content-document+json",
               plaintext, 1721300001, Pattern(0x71, 16), Pattern(0x72, 16),
               Pattern(0x73, 16), Pattern(0x74, 24), wrongEpochState, signing,
               epoch, &status) == nil &&
           status == AncPrivateVaultObjectRevisionStatusInvalid);

    NSData *fixtureBytes = [NSData dataWithContentsOfFile:
        @ANC_PV_OBJECT_REVISION_VECTOR_PATH];
    assert(fixtureBytes != nil);
    NSDictionary *fixture = [NSJSONSerialization JSONObjectWithData:fixtureBytes
                                                            options:0
                                                              error:nil];
    assert([fixture[@"schema"]
        isEqualToString:@"anc/v1-object-revision-vectors@1"]);
    NSData *fixtureVault = DataFromHex(fixture[@"vaultIdHex"]);
    NSData *fixtureObject = DataFromHex(fixture[@"objectIdHex"]);
    NSData *fixtureWriter = DataFromHex(fixture[@"writerEndpointIdHex"]);
    NSData *fixturePublic = DataFromHex(fixture[@"writerSigningPublicKeyHex"]);
    // The checked-in fixture freezes the independently generated native inner
    // envelopes. Reframe those exact bytes under the explicit bundle map that
    // was added before the production XPC surface opened.
    NSData *fixtureBundle =
        ReframeLegacyFixture(DataFromHex(fixture[@"bundleHex"]));
    AncPrivateVaultGuardedMemory *fixtureEpoch =
        Secret(DataFromHex(fixture[@"epochKeyHex"]));
    AncPrivateVaultOpenedObjectRevision *fixtureOpened =
        AncPrivateVaultOpenObjectRevision(
            fixtureBundle, fixtureVault, fixtureObject,
            State(fixtureVault, fixtureWriter, fixturePublic), fixtureEpoch,
            &status);
    assert(fixtureOpened != nil &&
           status == AncPrivateVaultObjectRevisionStatusOK &&
           [fixtureOpened.plaintext isEqualToData:
               [fixture[@"plaintextUtf8"] dataUsingEncoding:NSUTF8StringEncoding]] &&
           [Hex(fixtureOpened.revisionId)
               isEqualToString:fixture[@"revisionIdHex"]]);
    assert([fixtureEpoch close] == AncPrivateVaultGuardedMemoryStatusOK);
    assert([signing close] == AncPrivateVaultGuardedMemoryStatusOK);
    assert([epoch close] == AncPrivateVaultGuardedMemoryStatusOK);
    fprintf(stdout, "private-vault object revision passed\n");
  }
  return 0;
}
