# @agent-native/mobile-app

## Unreleased

### Added

- A native companion Home for dictation, background meeting audio, camera video
  and imports, plus remote agent sessions.
- Restart-safe recovery for finalized captures with resumable Clips uploads,
  automatic foreground retry, and completion notifications.
- iOS and Android quick actions for dictation, audio, and video capture, plus
  Siri/App Intents on iOS and a dictation Quick Settings tile on Android.
- Native iOS Clips browsing, calendar readiness, Live Activities, widgets,
  ReplayKit broadcast capture, Apple Watch actions, and configurable dictation.

### Changed

- Upgraded the mobile runtime to Expo SDK 57 and React Native 0.86.
- Improved native capture lifecycle tracking and session-token storage so
  uploads and companion actions recover cleanly across app restarts.

## 0.1.2

### Patch Changes

- Updated dependencies [c3852e0]
  - @agent-native/shared-app-config@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [daeb0a9]
  - @agent-native/shared-app-config@0.1.1
