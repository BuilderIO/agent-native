#import <AppKit/AppKit.h>

#include "TrustedGenesisUI.h"

#include <cstring>

namespace {

bool PVTrustedASCII(const std::vector<uint8_t> &value, size_t maximum) {
  if (value.empty() || value.size() > maximum)
    return false;
  for (uint8_t byte : value) {
    if (byte < 0x20 || byte > 0x7e)
      return false;
  }
  return true;
}

bool PVTrustedIdentifier(const char *value) {
  if (value == nullptr)
    return false;
  const size_t length = strnlen(value, 161);
  if (length < 8 || length > 160)
    return false;
  for (size_t index = 0; index < length; index += 1) {
    const char byte = value[index];
    const bool alphaNumeric =
        (byte >= 'a' && byte <= 'z') || (byte >= 'A' && byte <= 'Z') ||
        (byte >= '0' && byte <= '9');
    if (!alphaNumeric &&
        (index == 0 || (byte != '.' && byte != '_' && byte != ':' &&
                        byte != '-')))
      return false;
  }
  return true;
}

} // namespace

bool PVTrustedGenesisCollectFullPhrase(
    const std::vector<uint8_t> &recoveryPhrase,
    std::vector<uint8_t> &confirmedPhrase) {
  confirmedPhrase.clear();
  if (![NSThread isMainThread] || !PVTrustedASCII(recoveryPhrase, 215))
    return false;
  @autoreleasepool {
    NSString *phrase = [[NSString alloc]
        initWithBytes:recoveryPhrase.data()
              length:recoveryPhrase.size()
            encoding:NSASCIIStringEncoding];
    if (phrase == nil)
      return false;

    NSAlert *display = [[NSAlert alloc] init];
    display.alertStyle = NSAlertStyleWarning;
    display.messageText = @"Save your Private Vault recovery phrase";
    display.informativeText =
        @"These 24 words are the only way to recover this vault. Store them "
         "somewhere private. Agent Native cannot retrieve them for you.";
    [display addButtonWithTitle:@"I've saved it"];
    [display addButtonWithTitle:@"Cancel"];
    NSScrollView *scroll = [[NSScrollView alloc]
        initWithFrame:NSMakeRect(0, 0, 520, 112)];
    scroll.hasVerticalScroller = YES;
    scroll.borderType = NSBezelBorder;
    NSTextView *text = [[NSTextView alloc]
        initWithFrame:NSMakeRect(0, 0, 500, 112)];
    text.editable = NO;
    text.selectable = YES;
    text.font = [NSFont monospacedSystemFontOfSize:13
                                           weight:NSFontWeightRegular];
    text.string = phrase;
    scroll.documentView = text;
    display.accessoryView = scroll;
    if ([display runModal] != NSAlertFirstButtonReturn) {
      text.string = @"";
      return false;
    }
    text.string = @"";

    NSAlert *confirm = [[NSAlert alloc] init];
    confirm.alertStyle = NSAlertStyleWarning;
    confirm.messageText = @"Confirm all 24 recovery words";
    confirm.informativeText =
        @"Type the complete phrase in order. This confirmation stays inside "
         "the signed native vault boundary.";
    [confirm addButtonWithTitle:@"Create Private Vault"];
    [confirm addButtonWithTitle:@"Cancel"];
    NSSecureTextField *field = [[NSSecureTextField alloc]
        initWithFrame:NSMakeRect(0, 0, 520, 28)];
    field.placeholderString = @"word1 word2 … word24";
    confirm.accessoryView = field;
    if ([confirm runModal] != NSAlertFirstButtonReturn)
      return false;
    NSData *typed = [field.stringValue dataUsingEncoding:NSUTF8StringEncoding
                                    allowLossyConversion:NO];
    if (typed.length == 0 || typed.length > 512) {
      field.stringValue = @"";
      return false;
    }
    try {
      const auto *bytes = static_cast<const uint8_t *>(typed.bytes);
      confirmedPhrase.assign(bytes, bytes + typed.length);
    } catch (...) {
      field.stringValue = @"";
      confirmedPhrase.clear();
      return false;
    }
    field.stringValue = @"";
    return true;
  }
}

bool PVTrustedGenesisConfirmAdmission(const char *accountID,
                                      const char *workspaceID) {
  if (![NSThread isMainThread] || !PVTrustedIdentifier(accountID) ||
      !PVTrustedIdentifier(workspaceID))
    return false;
  @autoreleasepool {
    NSString *account = [NSString stringWithUTF8String:accountID];
    NSString *workspace = [NSString stringWithUTF8String:workspaceID];
    if (account == nil || workspace == nil)
      return false;
    NSAlert *alert = [[NSAlert alloc] init];
    alert.alertStyle = NSAlertStyleWarning;
    alert.messageText = @"Connect this Private Vault?";
    alert.informativeText = [NSString
        stringWithFormat:
            @"Account: %@\nWorkspace: %@\n\nOnly public encrypted-vault "
             "artifacts will be admitted. The server will not receive your "
             "recovery phrase or vault keys.",
            account, workspace];
    [alert addButtonWithTitle:@"Connect Vault"];
    [alert addButtonWithTitle:@"Cancel"];
    return [alert runModal] == NSAlertFirstButtonReturn;
  }
}
