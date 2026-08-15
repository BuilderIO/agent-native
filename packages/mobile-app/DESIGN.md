# Mobile chat-first workbench

## Direction

Mobile uses the same chat-first information architecture in a native form:
Chat is the initial landing surface and leftmost bottom-tab destination, with
Cloud as the default target for workspace-wide conversations. Computer is an
optional target for a paired laptop, while Sessions remains the connection and
run-management flow. Four device-local workspace app slots follow Chat with
each app's accent color and tinted icon background, and More holds the rest of
the registry and Settings.
Mobile keeps Chat native while workspace apps remain secure WebView routes.

The product mode is operate: frequent, focused actions on a phone. The visual
world is ink-and-graphite utility - quiet dark surfaces, crisp white type,
semantic app accents, compact controls, and generous space around the next
action. Avoid dense setup dashboards, explanatory hero copy, desktop sidebars,
and status-chip-heavy empty states.

## Layout contract

- Bottom navigation is Chat + up to four app slots + More. The app slots are
  chosen in Settings and default to Mail, Calendar, Content, and Analytics.
- More is the overflow destination for all enabled apps and the settings
  surface that manages the bottom-tab selection.
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
