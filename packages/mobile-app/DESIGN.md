# Mobile chat-first workbench

## Direction

Mobile uses the same chat-first information architecture in a native form:
Chat is the leftmost bottom-tab destination, three device-local workspace app
slots follow it with the shared app colors/icons, and More holds the rest of
the registry plus native capture/session tools and Settings. New installs use
chat-first by default, while the existing preference can still opt back into
the legacy Home-first shell.

## Layout contract

- The preference is device-local; new installs default to chat-first.
- Bottom navigation is Chat + up to three app slots + More. The app slots are
  chosen in Settings and default from `CHAT_FIRST_DEFAULT_APP_IDS`.
- More is the overflow destination for all enabled apps, native tools, and the
  settings surface that manages the bottom-tab selection.
- App rows route through the existing Expo app registry and secure WebView
  routes; they never accept arbitrary URLs.
- The desktop/Dispatch split pane becomes a native navigation push on mobile.
- Provider/model/API-key settings remain in the existing chat settings sheet.

## Deliberate platform boundary

Mobile is a tab-and-navigation variant, not the desktop/web workbench in a
smaller viewport. App launches remain full-screen and do not advertise
contextual chrome-less panes, browser chrome, terminal, files, or diff
surfaces on native mobile. Dispatch and Electron own those side-pane surfaces;
mobile can add native equivalents later without pretending that a desktop
iframe is a good phone UX.
