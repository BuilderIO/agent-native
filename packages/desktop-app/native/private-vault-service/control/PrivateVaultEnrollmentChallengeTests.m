#import <Foundation/Foundation.h>

#import "PrivateVaultAncCanonical.h"
#import "PrivateVaultCrypto.h"
#import "PrivateVaultEnrollmentChallenge.h"
#import "PrivateVaultEnrollmentChallengeInternal.h"
#import "PrivateVaultEnrollmentOffer.h"

#import <objc/runtime.h>

#include <assert.h>

@interface AncPrivateVaultControlLogMember (EnrollmentChallengeTests)
@property(nonatomic, readwrite) NSString *endpointId;
@property(nonatomic, readwrite) NSString *role;
@property(nonatomic, readwrite) BOOL unattended;
@property(nonatomic, readwrite) NSData *signingPublicKey;
@property(nonatomic, readwrite) NSData *keyAgreementPublicKey;
@property(nonatomic, readwrite) NSString *enrollmentRef;
@end
@interface AncPrivateVaultControlLogState (EnrollmentChallengeTests)
@property(nonatomic, readwrite) NSString *vaultId;
@property(nonatomic, readwrite) uint64_t sequence;
@property(nonatomic, readwrite) NSData *headHash;
@property(nonatomic, readwrite) NSData *membershipHash;
@property(nonatomic, readwrite) NSString *signedAt;
@property(nonatomic, readwrite)
    NSArray<AncPrivateVaultControlLogMember *> *activeMembers;
@property(nonatomic, readwrite) NSArray<NSString *> *removedEndpointIds;
@property(nonatomic, readwrite) uint64_t epoch;
@property(nonatomic, readwrite) uint64_t recoveryGeneration;
@property(nonatomic, readwrite) NSString *recoveryId;
@property(nonatomic, readwrite) NSData *recoverySigningPublicKey;
@property(nonatomic, readwrite) NSData *recoveryKeyAgreementPublicKey;
@property(nonatomic, readwrite) NSData *recoveryWrapHash;
@property(nonatomic, readwrite) NSString *freshnessMode;
@end

static NSData *Hex(NSString *hex) {
  NSMutableData *data = [NSMutableData dataWithLength:hex.length / 2];
  uint8_t *bytes = data.mutableBytes;
  for (NSUInteger index = 0; index < data.length; index += 1) {
    unsigned value = 0;
    assert(
        sscanf([[hex substringWithRange:NSMakeRange(index * 2, 2)] UTF8String],
               "%2x", &value) == 1);
    bytes[index] = (uint8_t)value;
  }
  return data;
}

static NSData *Repeated(uint8_t byte, NSUInteger length) {
  NSMutableData *data = [NSMutableData dataWithLength:length];
  memset(data.mutableBytes, byte, length);
  return data;
}

static NSData *Offer(void) {
  AncPrivateVaultCanonicalStatus status;
  return AncPrivateVaultCanonicalEncode(
      [AncPrivateVaultCanonicalValue map:@{
        @1 : [AncPrivateVaultCanonicalValue text:@"anc/v1"],
        @2 : [AncPrivateVaultCanonicalValue bytes:Repeated(0x01, 16)],
        @3 : [AncPrivateVaultCanonicalValue text:@"enrollment-offer"],
        @4 : [AncPrivateVaultCanonicalValue integer:1721111111],
        @5 : [AncPrivateVaultCanonicalValue bytes:Repeated(0x0e, 16)],
        @160 : [AncPrivateVaultCanonicalValue bytes:Repeated(0x03, 16)],
        @161 : [AncPrivateVaultCanonicalValue bytes:Repeated(0x0c, 16)],
        @162 : [AncPrivateVaultCanonicalValue text:@"endpoint"],
        @163 : [AncPrivateVaultCanonicalValue boolean:NO],
        @164 : [AncPrivateVaultCanonicalValue
            bytes:Hex(@"204040e364c10f2bec9c1fe500a1cd4c247c89d650a01ed7e82caba"
                      @"867877c21")],
        @165 : [AncPrivateVaultCanonicalValue bytes:Repeated(0x33, 32)],
        @166 : [AncPrivateVaultCanonicalValue bytes:Repeated(0xa5, 32)],
        @168 : [AncPrivateVaultCanonicalValue integer:1721111711],
      }],
      &status);
}

static AncPrivateVaultControlLogState *State(void) {
  AncPrivateVaultControlLogMember *member =
      [[AncPrivateVaultControlLogMember alloc] init];
  member.endpointId = [@"02" stringByPaddingToLength:32
                                          withString:@"02"
                                     startingAtIndex:0];
  member.role = @"endpoint";
  member.unattended = NO;
  member.signingPublicKey =
      Hex(@"d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737");
  member.keyAgreementPublicKey = Repeated(0x22, 32);
  member.enrollmentRef = [@"10" stringByPaddingToLength:32
                                             withString:@"10"
                                        startingAtIndex:0];
  AncPrivateVaultControlLogState *state =
      [[AncPrivateVaultControlLogState alloc] init];
  state.vaultId = [@"01" stringByPaddingToLength:32
                                      withString:@"01"
                                 startingAtIndex:0];
  state.sequence = 9;
  state.headHash = Repeated(0x71, 32);
  state.membershipHash = Repeated(0x72, 32);
  state.signedAt = @"2024-07-16T04:25:00.000Z";
  state.activeMembers = @[ member ];
  state.removedEndpointIds = @[];
  state.epoch = 7;
  state.recoveryGeneration = 1;
  state.recoveryId = [@"73" stringByPaddingToLength:32
                                         withString:@"73"
                                    startingAtIndex:0];
  state.recoverySigningPublicKey = Repeated(0x74, 32);
  state.recoveryKeyAgreementPublicKey = Repeated(0x75, 32);
  state.recoveryWrapHash = Repeated(0x76, 32);
  state.freshnessMode = @"endpoint_witnessed";
  return state;
}

int main(void) {
  @autoreleasepool {
    assert(anc_pv_crypto_init() == ANC_PV_CRYPTO_OK);
    NSData *challenge = Hex(
        @"b20166616e632f76310250010101010101010101010101010101010374656e726f6c6"
        @"c6d656e742d6368616c6c656e6765041a6696125005500f0f0f0f0f0f0f0f0f0f0f0f"
        @"0f0f0f0f18aa58204f4737a03a92baf7a57d46e2bc5c6a29b817daeb163c28841969d"
        @"012a436f53518ab5840e26ba35d10a11dcccc1b9a36fa9fd4e191e9bdc727f7f0f542"
        @"7ad2bdc447a66456c00cbdf93e22e403ef9ec2aeba492b5ec6822185f26b071dd2dc9"
        @"8798cd10218ac500202020202020202020202020202020218ad5820d04ab232742bb4"
        @"ab3a1368bd4615e4e6d0224ab71a016baf8520a332c977873718ae582022222222222"
        @"2222222222222222222222222222222222222222222222222222218af0918b0582071"
        @"7171717171717171717171717171717171717171717171717171717171717118b1582"
        @"0727272727272727272727272727272727272727272727272727272727272727218b2"
        @"68656e64706f696e7418b358203efd1f28bab187e425633368ef8f649f5d6b4ab07df"
        @"6aa5f23a42493f9e3ba1b18b45820a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7"
        @"a7a7a7a7a7a7a7a7a7a7a7a718b51a669614a818b65840b6690aa7a62dc3041f88c59"
        @"7586a9943d165f62b511567a630e5309d9494bdd22e84bbd3b296748b98083e5080ea"
        @"08dd1dbef3ae00508099b6306b783a9a3500");
    AncPrivateVaultEnrollmentChallengeStatus status;
    AncPrivateVaultEnrollmentChallengeResult *result =
        AncPrivateVaultEnrollmentChallengeVerify(
            Offer(), challenge, State(), 1721111100, 1721111121, &status);
    assert(status == AncPrivateVaultEnrollmentChallengeStatusOK &&
           result != nil && [result.sasCode isEqualToString:@"056-775-976"] &&
           [result.challengeHash
               isEqualToData:Hex(@"18c08a5bb9ce83b936ae78290dcaeb8dbb70101aa2a6"
                                 @"2fa6f7ca525ec8f300b6")] &&
           [result.sasTranscriptHash
               isEqualToData:Hex(@"3efd1f28bab187e425633368ef8f649f5d6b4ab07df6"
                                 @"aa5f23a42493f9e3ba1b")] &&
           [result.targetMembershipRole isEqualToString:@"endpoint"] &&
           result.controlSequence == 9);
    assert([result.sasTranscript
        isEqualToData:
            Hex(@"b40166616e632f7631025001010101010101010101010101010101036e656"
                @"e726f6c6c6d656e742d736173190140500c0c0c0c0c0c0c0c0c0c0c0c0c0c"
                @"0c0c19014158204f4737a03a92baf7a57d46e2bc5c6a29b817daeb163c288"
                @"41969d012a436f53519014250030303030303030303030303030303031901"
                @"435820204040e364c10f2bec9c1fe500a1cd4c247c89d650a01ed7e82caba"
                @"867877c211901445820333333333333333333333333333333333333333333"
                @"33333333333333333333331901455840e26ba35d10a11dcccc1b9a36fa9fd"
                @"4e191e9bdc727f7f0f5427ad2bdc447a66456c00cbdf93e22e403ef9ec2ae"
                @"ba492b5ec6822185f26b071dd2dc98798cd10219014650020202020202020"
                @"202020202020202021901475820d04ab232742bb4ab3a1368bd4615e4e6d0"
                @"224ab71a016baf8520a332c97787371901485820222222222222222222222"
                @"22222222222222222222222222222222222222222221901490919014a5820"
                @"7171717171717171717171717171717171717171717171717171717171717"
                @"17119014b5820727272727272727272727272727272727272727272727272"
                @"727272727272727219014c68656e64706f696e7419014d5820a7a7a7a7a7a"
                @"7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a719014e50"
                @"0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f19014f1a669612501901501a66961"
                @"4a8")]);
    NSData *copiedVault = nil, *copiedEncoded = nil, *copiedOffer = nil,
           *copiedChallenge = nil, *copiedSas = nil, *copiedCandidate = nil,
           *copiedSigning = nil, *copiedAgreement = nil,
           *copiedCeremony = nil;
    NSString *copiedRole = nil;
    uint64_t copiedCreatedAt = 0, copiedExpiresAt = 0;
    assert(AncPrivateVaultEnrollmentChallengeCopyEvidence(
               result, &copiedVault, &copiedEncoded, &copiedOffer,
               &copiedChallenge, &copiedSas, &copiedCandidate, &copiedSigning,
               &copiedAgreement, &copiedCeremony, &copiedRole,
               &copiedCreatedAt, &copiedExpiresAt) &&
           [copiedVault isEqualToData:Repeated(0x01, 16)] &&
           [copiedEncoded isEqualToData:challenge] &&
           [copiedRole isEqualToString:@"endpoint"]);
    BOOL mutationRejected = NO;
    @try {
      [result setValue:Repeated(0x99, 32) forKey:@"offerHash"];
    } @catch (__unused NSException *exception) {
      mutationRejected = YES;
    }
    assert(mutationRejected);
    AncPrivateVaultEnrollmentChallengeResult *forged = class_createInstance(
        AncPrivateVaultEnrollmentChallengeResult.class, 0);
    assert(!AncPrivateVaultEnrollmentChallengeCopyEvidence(
        forged, &copiedVault, &copiedEncoded, &copiedOffer, &copiedChallenge,
        &copiedSas, &copiedCandidate, &copiedSigning, &copiedAgreement,
        &copiedCeremony, &copiedRole, &copiedCreatedAt, &copiedExpiresAt));

    NSMutableData *badSignature = [challenge mutableCopy];
    ((uint8_t *)badSignature.mutableBytes)[badSignature.length - 1] ^= 1;
    assert(AncPrivateVaultEnrollmentChallengeVerify(
               Offer(), badSignature, State(), 1721111100, 1721111121,
               &status) == nil &&
           status == AncPrivateVaultEnrollmentChallengeStatusInvalidSignature);
    assert(AncPrivateVaultEnrollmentChallengeVerify(Offer(), challenge, State(),
                                                    1721111100, 1721112000,
                                                    &status) == nil &&
           status == AncPrivateVaultEnrollmentChallengeStatusStaleAuthority);
    AncPrivateVaultControlLogState *wrongHead = State();
    wrongHead.headHash = Repeated(0x70, 32);
    assert(AncPrivateVaultEnrollmentChallengeVerify(
               Offer(), challenge, wrongHead, 1721111100, 1721111121,
               &status) == nil &&
           status == AncPrivateVaultEnrollmentChallengeStatusConflict);
    AncPrivateVaultControlLogState *hostileState = State();
    hostileState.activeMembers = (id) @[ NSNull.null ];
    assert(AncPrivateVaultEnrollmentChallengeVerify(
               Offer(), challenge, hostileState, 1721111100, 1721111121,
               &status) == nil &&
           status == AncPrivateVaultEnrollmentChallengeStatusInvalid);
    assert(AncPrivateVaultEnrollmentChallengeVerify(
               Offer(), challenge, State(), 1721111100,
               UINT64_C(9007199254740992), &status) == nil &&
           status == AncPrivateVaultEnrollmentChallengeStatusInvalid);
    AncPrivateVaultControlLogState *activeCandidate = State();
    AncPrivateVaultControlLogMember *candidate =
        [[AncPrivateVaultControlLogMember alloc] init];
    candidate.endpointId = [@"03" stringByPaddingToLength:32
                                               withString:@"03"
                                          startingAtIndex:0];
    candidate.role = @"endpoint";
    candidate.unattended = NO;
    candidate.signingPublicKey = Repeated(0x44, 32);
    candidate.keyAgreementPublicKey = Repeated(0x45, 32);
    candidate.enrollmentRef = [@"46" stringByPaddingToLength:32
                                                  withString:@"46"
                                             startingAtIndex:0];
    activeCandidate.activeMembers =
        [activeCandidate.activeMembers arrayByAddingObject:candidate];
    assert(AncPrivateVaultEnrollmentChallengeVerify(
               Offer(), challenge, activeCandidate, 1721111100, 1721111121,
               &status) == nil &&
           status == AncPrivateVaultEnrollmentChallengeStatusConflict);
    puts("private-vault enrollment challenge parity passed");
  }
  return 0;
}
