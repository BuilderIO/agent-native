#import "PrivateVaultGrantIndexControlVerifier.h"

#import "PrivateVaultControlLogInternal.h"

@implementation AncPrivateVaultGrantIndexControlVerifier {
  AncPrivateVaultGrantIndex *_grantIndex;
  id<AncPrivateVaultControlLogAuthorizationVerifier> _fallback;
}

- (instancetype)initWithGrantIndex:(AncPrivateVaultGrantIndex *)grantIndex
                           fallback:
                               (id<AncPrivateVaultControlLogAuthorizationVerifier>)fallback {
  self = [super init];
  if (self == nil || grantIndex == nil) return nil;
  _grantIndex = grantIndex;
  _fallback = fallback;
  return self;
}

- (BOOL)verifyGrantRevocationSignedEntry:(NSData *)signedEntry
                           innerEnvelope:(NSData *)innerEnvelope
                      revocationEnvelope:(NSData *)revocationEnvelope
                            currentState:(AncPrivateVaultControlLogState *)state {
  if (signedEntry.length == 0 || innerEnvelope.length == 0 ||
      revocationEnvelope.length == 0 || state == nil)
    return NO;
  NSString *signerId =
      AncPrivateVaultControlLogSignedEntrySignerEndpointId(signedEntry);
  AncPrivateVaultControlLogMember *signer = nil;
  for (AncPrivateVaultControlLogMember *candidate in state.activeMembers)
    if ([candidate.endpointId isEqualToString:signerId]) signer = candidate;
  if (signer == nil || ![signer.role isEqualToString:@"endpoint"] ||
      signer.signingPublicKey.length != 32)
    return NO;
  return [_grantIndex applyRevocationEnvelope:revocationEnvelope
                                      vaultId:state.vaultId
                      signerControlEndpointId:signer.endpointId
                       signerSigningPublicKey:signer.signingPublicKey] ==
      AncPrivateVaultGrantIndexStatusOK;
}

- (BOOL)verifyGenesisMembershipCommit:(AncPrivateVaultControlLogMembershipCommit *)commit
                           signedEntry:(AncPrivateVaultControlLogSignedEntry *)entry
                      signedEntryBytes:(NSData *)signedEntryBytes
                    innerEnvelopeBytes:(NSData *)innerEnvelopeBytes {
  SEL selector = _cmd;
  return [_fallback respondsToSelector:selector] &&
      [_fallback verifyGenesisMembershipCommit:commit
                                    signedEntry:entry
                               signedEntryBytes:signedEntryBytes
                             innerEnvelopeBytes:innerEnvelopeBytes];
}

- (BOOL)verifyRecoverySignedEntry:(NSData *)signedEntry
                    innerEnvelope:(NSData *)innerEnvelope
                      currentState:(AncPrivateVaultControlLogState *)state {
  SEL selector = _cmd;
  return [_fallback respondsToSelector:selector] &&
      [_fallback verifyRecoverySignedEntry:signedEntry
                             innerEnvelope:innerEnvelope
                               currentState:state];
}

- (BOOL)verifyRecoveryMembershipCommit:
            (AncPrivateVaultControlLogMembershipCommit *)commit
                            signedEntry:
                                (AncPrivateVaultControlLogSignedEntry *)entry
                           currentState:
                               (AncPrivateVaultControlLogState *)state
                       signedEntryBytes:(NSData *)signedEntryBytes
                     innerEnvelopeBytes:(NSData *)innerEnvelopeBytes {
  SEL selector = _cmd;
  return [_fallback respondsToSelector:selector] &&
      [_fallback verifyRecoveryMembershipCommit:commit
                                     signedEntry:entry
                                    currentState:state
                                signedEntryBytes:signedEntryBytes
                              innerEnvelopeBytes:innerEnvelopeBytes];
}

- (BOOL)verifyRecoveryWrapRotationCommit:(AncPrivateVaultControlLogMembershipCommit *)commit
                              signedEntry:(AncPrivateVaultControlLogSignedEntry *)entry
                             currentState:(AncPrivateVaultControlLogState *)state
                         signedEntryBytes:(NSData *)signedEntryBytes
                       innerEnvelopeBytes:(NSData *)innerEnvelopeBytes {
  SEL selector = _cmd;
  return [_fallback respondsToSelector:selector] &&
      [_fallback verifyRecoveryWrapRotationCommit:commit
                                       signedEntry:entry
                                      currentState:state
                                  signedEntryBytes:signedEntryBytes
                                innerEnvelopeBytes:innerEnvelopeBytes];
}

- (BOOL)verifyCeremonyAbortSignedEntry:(NSData *)signedEntry
                         innerEnvelope:(NSData *)innerEnvelope
                           currentState:(AncPrivateVaultControlLogState *)state {
  SEL selector = _cmd;
  return [_fallback respondsToSelector:selector] &&
      [_fallback verifyCeremonyAbortSignedEntry:signedEntry
                                  innerEnvelope:innerEnvelope
                                    currentState:state];
}

@end
