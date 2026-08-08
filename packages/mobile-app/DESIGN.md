# Mobile chat-first workbench

## Direction

Mobile uses the same chat-first information architecture in a native form:
Chat stays the home surface, a compact horizontal workspace shelf exposes up
to six registry apps, and history/settings remain native sheets.

## Layout contract

- The preference is device-local and opt-in.
- App chips route through the existing Expo app registry and secure WebView
  routes; they never accept arbitrary URLs.
- The desktop/Dispatch split pane becomes a native navigation push on mobile.
- Provider/model/API-key settings remain in the existing chat settings sheet.

## Deliberate platform boundary

Mobile is a rail-and-navigation variant, not the desktop/web workbench in a
smaller viewport. This pass intentionally keeps app launches full-screen and
does not advertise contextual chrome-less panes, browser tabs, terminal, files,
or diff surfaces on native mobile. Dispatch and Electron own those side-pane
surfaces; mobile can add native equivalents later without pretending that a
desktop iframe is a good phone UX.
