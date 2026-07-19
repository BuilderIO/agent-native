#import "PrivateVaultObjectJobScope.h"

BOOL AncPrivateVaultObjectJobScopeAllows(
    NSData *resourceId, NSString *operation, NSString *provider,
    NSString *status, BOOL resultRecorded, BOOL receiptAcknowledged,
    NSData *vaultId, NSData *objectId, NSString *contentType) {
  if (resourceId.length != 16 || vaultId.length != 16 ||
      objectId.length != 16 || ![provider isEqualToString:@"content"] ||
      ![status isEqualToString:@"claimed"] || resultRecorded ||
      receiptAcknowledged)
    return NO;
  BOOL vaultScoped = [resourceId isEqualToData:vaultId];
  BOOL objectScoped = [resourceId isEqualToData:objectId];
  NSSet<NSString *> *vaultOperations = [NSSet setWithArray:@[
    @"list-documents", @"search-documents", @"create-document"
  ]];
  NSSet<NSString *> *objectOperations = [NSSet setWithArray:@[
    @"get-document", @"pull-document", @"update-document",
    @"edit-document", @"move-document", @"delete-document",
    @"list-document-versions", @"restore-document-version"
  ]];
  if (vaultScoped && [vaultOperations containsObject:operation]) return YES;
  if (![objectOperations containsObject:operation]) return NO;
  if (contentType == nil) return YES;
  return [contentType isEqualToString:
                          @"application/vnd.agent-native.content-vault-manifest+json"] ||
         objectScoped;
}
