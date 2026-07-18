#import "PrivateVaultAuthoritySnapshotInternal.h"
#import "PrivateVaultAuthorityStoreInternal.h"
#import "PrivateVaultControlLog.h"
#import "PrivateVaultControlLogInternal.h"

#import <objc/message.h>
#import <objc/runtime.h>

#include <assert.h>
#include <stdio.h>

#ifndef ANC_PV_CONTROL_VECTOR_PATH
#error ANC_PV_CONTROL_VECTOR_PATH must name the native control-log fixture
#endif

@interface AncPrivateVaultAuthorityCheckpoint (BridgeTestConstruction)
@property(nonatomic, readwrite) NSString *vaultId;
@property(nonatomic, readwrite) uint64_t custodyGeneration;
@property(nonatomic, readwrite) NSData *frameDigest;
@property(nonatomic, readwrite) AncPrivateVaultAuthoritySnapshot *snapshot;
@end

@interface AncPrivateVaultControlLogMember (BridgeTestConstruction)
@property(nonatomic, readwrite) NSString *endpointId;
@property(nonatomic, readwrite) NSString *role;
@property(nonatomic, readwrite) BOOL unattended;
@property(nonatomic, readwrite) NSData *signingPublicKey;
@property(nonatomic, readwrite) NSData *keyAgreementPublicKey;
@property(nonatomic, readwrite) NSString *enrollmentRef;
@end

@interface AncPrivateVaultControlLogState (BridgeTestConstruction)
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

static NSData *BridgeHex(NSString *hex) {
  if (![hex isKindOfClass:NSString.class] || (hex.length & 1) != 0)
    return nil;
  NSMutableData *data = [NSMutableData dataWithLength:hex.length / 2];
  uint8_t *bytes = data.mutableBytes;
  for (NSUInteger index = 0; index < data.length; index++) {
    unsigned value = 0;
    NSString *pair = [hex substringWithRange:NSMakeRange(index * 2, 2)];
    NSScanner *scanner = [NSScanner scannerWithString:pair];
    if (![scanner scanHexInt:&value] || !scanner.isAtEnd)
      return nil;
    bytes[index] = (uint8_t)value;
  }
  return [data copy];
}

static NSData *BridgeBytes(uint8_t value) {
  uint8_t bytes[32];
  memset(bytes, value, sizeof bytes);
  return [NSData dataWithBytes:bytes length:sizeof bytes];
}

static BOOL BridgeHasReplayEvidence(
    AncPrivateVaultControlLogReplayResult *result) {
  AncPrivateVaultControlLogState *prior = nil;
  AncPrivateVaultControlLogState *current = nil;
  NSData *entryHash = nil;
  BOOL idempotent = NO;
  return AncPrivateVaultControlLogReplayResultCopyEvidence(
      result, &prior, &current, &entryHash, &idempotent);
}

static BOOL BridgeDirectObjectSetterThrew(id object, SEL selector, id value) {
  assert([object respondsToSelector:selector]);
  BOOL threw = NO;
  @try {
    void (*setter)(id, SEL, id) =
        (void (*)(id, SEL, id))[object methodForSelector:selector];
    setter(object, selector, value);
  } @catch (__unused NSException *exception) {
    threw = YES;
  }
  return threw;
}

static BOOL BridgeInvocationSetterThrew(id object, SEL selector, id value) {
  assert([object respondsToSelector:selector]);
  NSMethodSignature *signature = [object methodSignatureForSelector:selector];
  assert(signature != nil);
  NSInvocation *invocation =
      [NSInvocation invocationWithMethodSignature:signature];
  invocation.target = object;
  invocation.selector = selector;
  __unsafe_unretained id argument = value;
  [invocation setArgument:&argument atIndex:2];
  BOOL threw = NO;
  @try {
    [invocation invoke];
  } @catch (__unused NSException *exception) {
    threw = YES;
  }
  return threw;
}

@interface BridgeAuthorizationVerifier
    : NSObject <AncPrivateVaultControlLogAuthorizationVerifier>
@end
@implementation BridgeAuthorizationVerifier
- (BOOL)verifyGenesisMembershipCommit:
            (AncPrivateVaultControlLogMembershipCommit *)commit
                           signedEntry:
                               (AncPrivateVaultControlLogSignedEntry *)entry
                      signedEntryBytes:(NSData *)signedEntryBytes
                    innerEnvelopeBytes:(NSData *)innerEnvelopeBytes {
  return commit != nil && entry != nil && signedEntryBytes.length > 0 &&
         innerEnvelopeBytes.length > 0;
}
- (BOOL)verifyRecoverySignedEntry:(NSData *)signedEntry
                    innerEnvelope:(NSData *)innerEnvelope
                      currentState:(AncPrivateVaultControlLogState *)state {
  return signedEntry.length > 0 && innerEnvelope.length > 0 && state != nil;
}
- (BOOL)verifyRecoveryWrapRotationCommit:
            (AncPrivateVaultControlLogMembershipCommit *)commit
                              signedEntry:
                                  (AncPrivateVaultControlLogSignedEntry *)entry
                             currentState:
                                 (AncPrivateVaultControlLogState *)state
                         signedEntryBytes:(NSData *)signedEntryBytes
                       innerEnvelopeBytes:(NSData *)innerEnvelopeBytes {
  return commit != nil && entry != nil && state != nil &&
         signedEntryBytes.length > 0 && innerEnvelopeBytes.length > 0;
}
- (BOOL)verifyCeremonyAbortSignedEntry:(NSData *)signedEntry
                         innerEnvelope:(NSData *)innerEnvelope
                           currentState:(AncPrivateVaultControlLogState *)state {
  return signedEntry.length > 0 && innerEnvelope.length > 0 && state != nil;
}
@end

static AncPrivateVaultControlLogMember *BridgeCopyMember(
    AncPrivateVaultControlLogMember *source) {
  AncPrivateVaultControlLogMember *member =
      [[AncPrivateVaultControlLogMember alloc] init];
  member.endpointId = [source.endpointId copy];
  member.role = [source.role copy];
  member.unattended = source.unattended;
  member.signingPublicKey = [source.signingPublicKey copy];
  member.keyAgreementPublicKey = [source.keyAgreementPublicKey copy];
  member.enrollmentRef = [source.enrollmentRef copy];
  return member;
}

static AncPrivateVaultControlLogState *BridgeCopyState(
    AncPrivateVaultControlLogState *source) {
  AncPrivateVaultControlLogState *state =
      [[AncPrivateVaultControlLogState alloc] init];
  state.vaultId = [source.vaultId copy];
  state.sequence = source.sequence;
  state.headHash = [source.headHash copy];
  state.membershipHash = [source.membershipHash copy];
  state.signedAt = [source.signedAt copy];
  NSMutableArray *members = [NSMutableArray array];
  for (AncPrivateVaultControlLogMember *member in source.activeMembers)
    [members addObject:BridgeCopyMember(member)];
  state.activeMembers = [members copy];
  state.removedEndpointIds =
      [[NSArray alloc] initWithArray:source.removedEndpointIds copyItems:YES];
  state.epoch = source.epoch;
  state.recoveryGeneration = source.recoveryGeneration;
  state.recoveryId = [source.recoveryId copy];
  state.recoverySigningPublicKey = [source.recoverySigningPublicKey copy];
  state.recoveryKeyAgreementPublicKey =
      [source.recoveryKeyAgreementPublicKey copy];
  state.recoveryWrapHash = [source.recoveryWrapHash copy];
  state.freshnessMode = [source.freshnessMode copy];
  return state;
}

static AncPrivateVaultAuthorityCheckpoint *BridgeCheckpoint(
    AncPrivateVaultControlLogState *state,
    AncPrivateVaultControlLogState *previous, uint64_t generation,
    uint64_t verifiedAtMs) {
  AncPrivateVaultAuthoritySnapshot *snapshot =
      AncPrivateVaultAuthoritySnapshotCreateFromVerifiedControlState(
          state, generation, generation - 1,
          previous == nil ? nil : @(previous.sequence),
          previous == nil ? nil : previous.headHash, verifiedAtMs);
  assert(snapshot != nil);
  AncPrivateVaultAuthorityCheckpoint *checkpoint =
      [[AncPrivateVaultAuthorityCheckpoint alloc] init];
  checkpoint.vaultId = [state.vaultId copy];
  checkpoint.custodyGeneration = generation;
  checkpoint.frameDigest = BridgeBytes(0x88);
  checkpoint.snapshot = snapshot;
  return checkpoint;
}

static NSArray<AncPrivateVaultControlLogReplayResult *> *BridgeReplayFixture(
    NSArray<NSDictionary *> *steps) {
  AncPrivateVaultControlLog *log = [[AncPrivateVaultControlLog alloc] init];
  BridgeAuthorizationVerifier *verifier =
      [[BridgeAuthorizationVerifier alloc] init];
  NSMutableArray *results = [NSMutableArray array];
  AncPrivateVaultControlLogState *state = nil;
  for (NSUInteger index = 0; index <= 8; index++) {
    NSData *entry = BridgeHex(steps[index][@"outerHex"]);
    AncPrivateVaultControlLogReplayResult *result = nil;
    assert([log replaySignedEntry:entry
                    currentState:state
                        verifier:verifier
                          result:&result] ==
           AncPrivateVaultControlLogStatusOK);
    assert(result != nil && !result.idempotent &&
           BridgeHasReplayEvidence(result));
    [results addObject:result];
    state = result.state;
  }
  return [results copy];
}

@interface BridgeThrowingReplay : AncPrivateVaultControlLogReplayResult
@end
@implementation BridgeThrowingReplay
- (BOOL)authenticatedReplay {
  [NSException raise:NSInternalInconsistencyException format:@"test"];
  return NO;
}
@end

int main(void) {
  @autoreleasepool {
    NSData *fixtureData = [NSData
        dataWithContentsOfFile:@ANC_PV_CONTROL_VECTOR_PATH];
    NSDictionary *fixture =
        [NSJSONSerialization JSONObjectWithData:fixtureData options:0 error:nil];
    NSArray<NSDictionary *> *steps = fixture[@"steps"];
    assert(steps.count >= 9);
    NSArray<AncPrivateVaultControlLogReplayResult *> *results =
        BridgeReplayFixture(steps);
    AncPrivateVaultControlLogState *state2 = results[2].state;
    AncPrivateVaultControlLogState *state3 = results[3].state;
    AncPrivateVaultControlLogState *state4 = results[4].state;
    AncPrivateVaultAuthorityCheckpoint *checkpoint =
        BridgeCheckpoint(state3, state2, 7, UINT64_C(1800000000000));

    AncPrivateVaultControlLogState *bridged =
        AncPrivateVaultControlLogStateCreateFromAuthenticatedCheckpoint(
            checkpoint);
    assert(bridged != nil && [bridged.vaultId isEqualToString:state3.vaultId] &&
           bridged.sequence == state3.sequence &&
           [bridged.headHash isEqualToData:state3.headHash] &&
           [bridged.membershipHash isEqualToData:state3.membershipHash] &&
           [bridged.signedAt isEqualToString:state3.signedAt] &&
           [bridged.removedEndpointIds isEqualToArray:state3.removedEndpointIds] &&
           bridged.epoch == state3.epoch &&
           bridged.recoveryGeneration == state3.recoveryGeneration &&
           [bridged.recoveryId isEqualToString:state3.recoveryId] &&
           [bridged.recoverySigningPublicKey
               isEqualToData:state3.recoverySigningPublicKey] &&
           [bridged.recoveryKeyAgreementPublicKey
               isEqualToData:state3.recoveryKeyAgreementPublicKey] &&
           [bridged.recoveryWrapHash isEqualToData:state3.recoveryWrapHash] &&
           [bridged.freshnessMode isEqualToString:state3.freshnessMode]);
    BOOL stateMutationThrew = NO;
    @try {
      [bridged setValue:@"vault:mutated" forKey:@"vaultId"];
    } @catch (__unused NSException *exception) {
      stateMutationThrew = YES;
    }
    assert(stateMutationThrew);
    assert(BridgeDirectObjectSetterThrew(
        bridged, NSSelectorFromString(@"setVaultId:"), @"vault:mutated"));
    assert(BridgeInvocationSetterThrew(
        bridged.activeMembers[0], NSSelectorFromString(@"setRole:"),
        @"broker"));

    AncPrivateVaultVerifiedReplayResult *verified =
        AncPrivateVaultVerifiedReplayResultCreate(
            results[4], checkpoint, 8, UINT64_C(1800000001000),
            AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch);
    assert(verified != nil && verified.expectedCheckpoint != checkpoint &&
           verified.epochTransition ==
               AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch &&
           verified.nextSnapshot.targetCustodyGeneration == 8 &&
           verified.nextSnapshot.previousCustodyGeneration == 7 &&
           verified.nextSnapshot.previousSequence.unsignedLongLongValue == 3 &&
           [verified.nextSnapshot.previousHead isEqualToData:state3.headHash] &&
           verified.nextSnapshot.sequence == 4 &&
           [verified.nextSnapshot.headHash
               isEqualToData:results[4].entryHash] &&
           verified.nextSnapshot.epoch == state3.epoch + 1);
    AncPrivateVaultAuthoritySnapshotStatus snapshotStatus;
    NSData *canonical = AncPrivateVaultAuthoritySnapshotEncode(
        verified.nextSnapshot, &snapshotStatus);
    assert(canonical != nil &&
           AncPrivateVaultAuthoritySnapshotDecode(canonical, &snapshotStatus) !=
               nil);
    BOOL resultMutationThrew = NO;
    @try {
      [verified setValue:@0 forKey:@"epochTransition"];
    } @catch (__unused NSException *exception) {
      resultMutationThrew = YES;
    }
    assert(resultMutationThrew);
    assert(BridgeDirectObjectSetterThrew(
        verified, NSSelectorFromString(@"setNextSnapshot:"),
        checkpoint.snapshot));
    assert(BridgeInvocationSetterThrew(
        verified.expectedCheckpoint, NSSelectorFromString(@"setVaultId:"),
        @"vault:mutated"));
    assert(BridgeDirectObjectSetterThrew(
        verified.nextSnapshot, NSSelectorFromString(@"setVaultId:"),
        @"vault:mutated"));
    assert(BridgeInvocationSetterThrew(
        verified.nextSnapshot.activeMembers[0],
        NSSelectorFromString(@"setRole:"), @"broker"));

    assert(AncPrivateVaultVerifiedReplayResultCreate(
               results[4], checkpoint, 7, UINT64_C(1800000001000),
               AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch) ==
           nil);
    assert(AncPrivateVaultVerifiedReplayResultCreate(
               results[4], checkpoint, 9, UINT64_C(1800000001000),
               AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch) ==
           nil);
    assert(AncPrivateVaultVerifiedReplayResultCreate(
               results[4], checkpoint, 8, UINT64_C(1800000001000),
               AncPrivateVaultCustodyEpochTransitionCarryCurrentEpoch) == nil);
    assert(AncPrivateVaultVerifiedReplayResultCreate(
               results[3], BridgeCheckpoint(state2, results[1].state, 6,
                                             UINT64_C(1800000000000)),
               7, UINT64_C(1800000001000),
               AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch) ==
           nil);
    assert(AncPrivateVaultVerifiedReplayResultCreate(
               results[4], checkpoint, 8,
               checkpoint.snapshot.signedAtMs - UINT64_C(60000),
               AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch) ==
           nil);
    assert(AncPrivateVaultVerifiedReplayResultCreate(
               results[4], checkpoint, 8,
               checkpoint.snapshot.verifiedAtMs - 1,
               AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch) ==
           nil);

    AncPrivateVaultControlLogState *wrongVault = BridgeCopyState(state3);
    wrongVault.vaultId = @"vault:wrong-authority-0001";
    assert(AncPrivateVaultVerifiedReplayResultCreate(
               results[4], BridgeCheckpoint(wrongVault, state2, 7,
                                             UINT64_C(1800000000000)),
               8, UINT64_C(1800000001000),
               AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch) ==
           nil);
    AncPrivateVaultControlLogState *wrongHead = BridgeCopyState(state3);
    wrongHead.headHash = BridgeBytes(0xa1);
    assert(AncPrivateVaultVerifiedReplayResultCreate(
               results[4], BridgeCheckpoint(wrongHead, state2, 7,
                                             UINT64_C(1800000000000)),
               8, UINT64_C(1800000001000),
               AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch) ==
           nil);
    AncPrivateVaultControlLogState *wrongRecovery = BridgeCopyState(state3);
    wrongRecovery.recoveryId = @"recovery:wrong-bridge-0001";
    assert(AncPrivateVaultVerifiedReplayResultCreate(
               results[4], BridgeCheckpoint(wrongRecovery, state2, 7,
                                             UINT64_C(1800000000000)),
               8, UINT64_C(1800000001000),
               AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch) ==
           nil);
    AncPrivateVaultControlLogState *wrongMember = BridgeCopyState(state3);
    AncPrivateVaultControlLogMember *changed =
        BridgeCopyMember(wrongMember.activeMembers[0]);
    changed.signingPublicKey = BridgeBytes(0xb1);
    NSMutableArray *changedMembers = [wrongMember.activeMembers mutableCopy];
    changedMembers[0] = changed;
    wrongMember.activeMembers = [changedMembers copy];
    assert(AncPrivateVaultVerifiedReplayResultCreate(
               results[4], BridgeCheckpoint(wrongMember, state2, 7,
                                             UINT64_C(1800000000000)),
               8, UINT64_C(1800000001000),
               AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch) ==
           nil);

    AncPrivateVaultControlLog *log = [[AncPrivateVaultControlLog alloc] init];
    AncPrivateVaultControlLogReplayResult *idempotent = nil;
    assert([log replaySignedEntry:BridgeHex(steps[4][@"outerHex"])
                    currentState:state4
                        verifier:[[BridgeAuthorizationVerifier alloc] init]
                          result:&idempotent] ==
               AncPrivateVaultControlLogStatusOK &&
           idempotent.idempotent);
    assert(AncPrivateVaultVerifiedReplayResultCreate(
               idempotent, checkpoint, 8, UINT64_C(1800000001000),
               AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch) ==
           nil);
    BOOL replayKVCThrew = NO;
    @try {
      [results[4] setValue:@YES forKey:@"idempotent"];
    } @catch (__unused NSException *exception) {
      replayKVCThrew = YES;
    }
    assert(replayKVCThrew && BridgeHasReplayEvidence(results[4]));
    assert(BridgeDirectObjectSetterThrew(
        results[4], NSSelectorFromString(@"setEntryHash:"),
        BridgeBytes(0xd1)));

    AncPrivateVaultControlLogReplayResult *forged =
        class_createInstance(AncPrivateVaultControlLogReplayResult.class, 0);
    assert(!BridgeHasReplayEvidence(forged) &&
           AncPrivateVaultVerifiedReplayResultCreate(
               forged, checkpoint, 8, UINT64_C(1800000001000),
               AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch) ==
               nil);
    Class privateReplayClass =
        NSClassFromString(@"AncPrivateVaultAuthenticatedReplayResult");
    assert(privateReplayClass != Nil);
    AncPrivateVaultControlLogReplayResult *forgedPrivate =
        class_createInstance(privateReplayClass, 0);
    assert(!BridgeHasReplayEvidence(forgedPrivate) &&
           ![forgedPrivate respondsToSelector:
                              NSSelectorFromString(@"internalReplayResult")] &&
           AncPrivateVaultVerifiedReplayResultCreate(
               forgedPrivate, checkpoint, 8, UINT64_C(1800000001000),
               AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch) ==
               nil);
    for (NSString *name in @[
           @"_state", @"_authenticatedPriorState", @"_entryHash"
         ]) {
      Ivar ivar = class_getInstanceVariable(privateReplayClass,
                                            name.UTF8String);
      assert(ivar != NULL);
      id value = [name isEqualToString:@"_state"]
                     ? results[4].state
                     : ([name isEqualToString:@"_authenticatedPriorState"]
                            ? results[3].state
                            : results[4].entryHash);
      object_setIvar(forgedPrivate, ivar, value);
    }
    assert(!BridgeHasReplayEvidence(forgedPrivate));

    Class privateVerifiedClass =
        NSClassFromString(@"AncPrivateVaultImmutableVerifiedReplayResult");
    assert(privateVerifiedClass != Nil);
    id forgedVerified = class_createInstance(privateVerifiedClass, 0);
    assert(![forgedVerified
        respondsToSelector:NSSelectorFromString(
                               @"internalResultWithExpectedCheckpoint:snapshot:transition:")]);

    AncPrivateVaultControlLogReplayResult *mutatedAuthentic = results[5];
    Ivar entryHashIvar = class_getInstanceVariable(privateReplayClass,
                                                   "_entryHash");
    assert(entryHashIvar != NULL && BridgeHasReplayEvidence(mutatedAuthentic));
    object_setIvar(mutatedAuthentic, entryHashIvar, BridgeBytes(0xe1));
    assert(!BridgeHasReplayEvidence(mutatedAuthentic) &&
           AncPrivateVaultVerifiedReplayResultCreate(
               mutatedAuthentic,
               BridgeCheckpoint(results[4].state, results[3].state, 8,
                                UINT64_C(1800000001000)),
               9, UINT64_C(1800000002000),
               AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch) ==
               nil);

    AncPrivateVaultControlLogState *aliased = BridgeCopyState(state4);
    NSMutableData *shared = [BridgeBytes(0xc1) mutableCopy];
    aliased.headHash = shared;
    aliased.membershipHash = shared;
    assert(AncPrivateVaultAuthoritySnapshotCreateFromVerifiedControlState(
               aliased, 8, 7, @3, state3.headHash,
               UINT64_C(1800000001000)) == nil);

    AncPrivateVaultControlLogState *mutableState = BridgeCopyState(state4);
    NSMutableData *mutableHead = [mutableState.headHash mutableCopy];
    mutableState.headHash = mutableHead;
    AncPrivateVaultAuthoritySnapshot *frozen =
        AncPrivateVaultAuthoritySnapshotCreateFromVerifiedControlState(
            mutableState, 8, 7, @3, state3.headHash,
            UINT64_C(1800000001000));
    assert(frozen != nil);
    NSData *frozenHead = [frozen.headHash copy];
    ((uint8_t *)mutableHead.mutableBytes)[0] ^= 0xff;
    assert([frozen.headHash isEqualToData:frozenHead]);

    AncPrivateVaultAuthorityCheckpoint *badGeneration =
        BridgeCheckpoint(state3, state2, 7, UINT64_C(1800000000000));
    badGeneration.custodyGeneration = 6;
    assert(AncPrivateVaultControlLogStateCreateFromAuthenticatedCheckpoint(
               badGeneration) == nil);
    AncPrivateVaultAuthorityCheckpoint *badDigest =
        BridgeCheckpoint(state3, state2, 7, UINT64_C(1800000000000));
    badDigest.frameDigest = [NSMutableData dataWithLength:31];
    assert(AncPrivateVaultControlLogStateCreateFromAuthenticatedCheckpoint(
               badDigest) == nil);

    BridgeThrowingReplay *throwing =
        class_createInstance(BridgeThrowingReplay.class, 0);
    assert(!BridgeHasReplayEvidence(throwing) &&
           AncPrivateVaultVerifiedReplayResultCreate(
               throwing, checkpoint, 8, UINT64_C(1800000001000),
               AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch) ==
           nil);

    AncPrivateVaultAuthorityCheckpoint *recoveryCheckpoint =
        BridgeCheckpoint(results[7].state, results[6].state, 11,
                         UINT64_C(1800000000000));
    AncPrivateVaultVerifiedReplayResult *recovery =
        AncPrivateVaultVerifiedReplayResultCreate(
            results[8], recoveryCheckpoint, 12, UINT64_C(1800000001000),
            AncPrivateVaultCustodyEpochTransitionPromotePreparedEpoch);
    assert(recovery != nil && recovery.nextSnapshot.recoveryGeneration ==
                                  results[7].state.recoveryGeneration + 1 &&
           recovery.nextSnapshot.activeMembers.count == 1);
  }
  fprintf(stdout, "private-vault authenticated replay bridge tests passed\n");
  return 0;
}
