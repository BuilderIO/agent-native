---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Create app now offers a "Connect Builder" action when Builder isn't connected, instead of dead-end prose. The create-app flow (popover and full-page NewWorkspaceAppFlow) tracks the structured `builder-unavailable` failure reason from `start-workspace-app-creation`, gives hard failures a destructive-styled affordance instead of the neutral muted box used for informational states, adds a "Try again" control for `builder-error`/`credential-store-unavailable`, and wires the "Connect Builder" button through the shared `useBuilderConnectFlow` hook so users can connect and retry without leaving the flow.
