#import <AppKit/AppKit.h>

#include "TrustedEnrollmentUI.h"

#include <cstring>

namespace {

bool PVLowerHex(const char *value, size_t length) {
  if (value == nullptr || strnlen(value, length + 1) != length)
    return false;
  for (size_t index = 0; index < length; index += 1) {
    const char byte = value[index];
    if (!((byte >= '0' && byte <= '9') || (byte >= 'a' && byte <= 'f')))
      return false;
  }
  return true;
}

bool PVSasCode(const char *value) {
  if (value == nullptr || strnlen(value, 12) != 11)
    return false;
  for (size_t index = 0; index < 11; index += 1) {
    if (index == 3 || index == 7) {
      if (value[index] != '-')
        return false;
    } else if (value[index] < '0' || value[index] > '9') {
      return false;
    }
  }
  return true;
}

} // namespace

bool PVTrustedEnrollmentValidateInput(
    const char *sasCode, const char *candidateEndpointID,
    const char *membershipRole, bool unattended,
    const uint8_t *sasTranscriptHash, size_t sasTranscriptHashLength) {
  const bool broker = membershipRole != nullptr &&
                      strcmp(membershipRole, "broker") == 0;
  const bool endpoint = membershipRole != nullptr &&
                        strcmp(membershipRole, "endpoint") == 0;
  if (!PVSasCode(sasCode) || !PVLowerHex(candidateEndpointID, 32) ||
      (!broker && !endpoint) || unattended != broker ||
      sasTranscriptHash == nullptr || sasTranscriptHashLength != 32)
    return false;
  uint8_t aggregate = 0;
  for (size_t index = 0; index < sasTranscriptHashLength; index += 1)
    aggregate |= sasTranscriptHash[index];
  return aggregate != 0;
}

PVTrustedEnrollmentDecision PVTrustedEnrollmentConfirmSAS(
    const char *sasCode, const char *candidateEndpointID,
    const char *membershipRole, bool unattended,
    const uint8_t *sasTranscriptHash, size_t sasTranscriptHashLength) {
  if (![NSThread isMainThread] ||
      !PVTrustedEnrollmentValidateInput(
          sasCode, candidateEndpointID, membershipRole, unattended,
          sasTranscriptHash, sasTranscriptHashLength))
    return PVTrustedEnrollmentDecision::Cancelled;
  @autoreleasepool {
    NSString *code = [NSString stringWithUTF8String:sasCode];
    NSString *candidate = [NSString stringWithUTF8String:candidateEndpointID];
    NSString *role = [NSString stringWithUTF8String:membershipRole];
    if (code == nil || candidate == nil || role == nil)
      return PVTrustedEnrollmentDecision::Cancelled;

    NSAlert *alert = [[NSAlert alloc] init];
    alert.alertStyle = NSAlertStyleWarning;
    alert.messageText = [role isEqualToString:@"broker"]
                            ? @"Verify this Private Vault broker"
                            : @"Verify this Private Vault device";
    alert.informativeText = [NSString
        stringWithFormat:
            @"Compare the code below with the code on your existing trusted "
             "device. Then type the trusted device's code here.\n\n"
             "Candidate: %@\n\nA different code means this enrollment must be "
             "destroyed, not retried.",
            candidate];
    [alert addButtonWithTitle:@"Codes Match"];
    [alert addButtonWithTitle:@"Codes Don't Match"];
    [alert addButtonWithTitle:@"Cancel"];

    NSStackView *stack = [[NSStackView alloc]
        initWithFrame:NSMakeRect(0, 0, 420, 92)];
    stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    stack.alignment = NSLayoutAttributeCenterX;
    stack.spacing = 12;
    NSTextField *display = [NSTextField labelWithString:code];
    display.font = [NSFont monospacedSystemFontOfSize:28
                                               weight:NSFontWeightSemibold];
    display.selectable = YES;
    NSTextField *typed = [[NSTextField alloc]
        initWithFrame:NSMakeRect(0, 0, 240, 28)];
    typed.placeholderString = @"000-000-000 from trusted device";
    typed.font = [NSFont monospacedSystemFontOfSize:15
                                             weight:NSFontWeightRegular];
    [stack addArrangedSubview:display];
    [stack addArrangedSubview:typed];
    alert.accessoryView = stack;

    NSModalResponse response = [alert runModal];
    NSString *entered = [typed.stringValue copy];
    typed.stringValue = @"";
    if (response == NSAlertSecondButtonReturn)
      return PVTrustedEnrollmentDecision::Mismatch;
    if (response != NSAlertFirstButtonReturn || ![entered isEqualToString:code])
      return PVTrustedEnrollmentDecision::Cancelled;
    return PVTrustedEnrollmentDecision::Confirmed;
  }
}

bool PVTrustedEnrollmentPresentSAS(
    const char *sasCode, const char *candidateEndpointID,
    const char *membershipRole, bool unattended,
    const uint8_t *sasTranscriptHash, size_t sasTranscriptHashLength) {
  if (![NSThread isMainThread] ||
      !PVTrustedEnrollmentValidateInput(
          sasCode, candidateEndpointID, membershipRole, unattended,
          sasTranscriptHash, sasTranscriptHashLength))
    return false;
  @autoreleasepool {
    NSString *code = [NSString stringWithUTF8String:sasCode];
    NSString *candidate = [NSString stringWithUTF8String:candidateEndpointID];
    if (code == nil || candidate == nil)
      return false;

    NSAlert *alert = [[NSAlert alloc] init];
    alert.alertStyle = NSAlertStyleWarning;
    alert.messageText = @"Verify a new Private Vault broker";
    alert.informativeText = [NSString
        stringWithFormat:
            @"Read this code to the person at the new device. They must type "
             "the same code into the trusted Private Vault window there.\n\n"
             "Candidate: %@\n\nCancel if you did not start this enrollment. "
             "A wrong code permanently rejects this attempt.",
            candidate];
    [alert addButtonWithTitle:@"I've Shared This Code"];
    [alert addButtonWithTitle:@"Cancel"];

    NSStackView *stack = [[NSStackView alloc]
        initWithFrame:NSMakeRect(0, 0, 420, 52)];
    stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    stack.alignment = NSLayoutAttributeCenterX;
    NSTextField *display = [NSTextField labelWithString:code];
    display.font = [NSFont monospacedSystemFontOfSize:28
                                               weight:NSFontWeightSemibold];
    display.selectable = NO;
    [stack addArrangedSubview:display];
    alert.accessoryView = stack;

    return [alert runModal] == NSAlertFirstButtonReturn;
  }
}
