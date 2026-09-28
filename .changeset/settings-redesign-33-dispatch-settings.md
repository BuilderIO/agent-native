---
"@agent-native/dispatch": patch
---

Dispatch's Settings page has one implementation: `@agent-native/dispatch/routes/pages/settings` exports `DispatchSettingsPage({ changelog })`, and the Dispatch template renders it with its own changelog. With `settings-redesign` on, the Dispatch layout renders Settings full width, Members keeps the Dispatch access column, and Dispatch › General shows a Workspace group (Chat-first workspace, Resources, Connect apps) while core Preferences owns the interface language. The route's default export now matches the template's page: it gains the Account and Integrations tabs, links Resources to `/workspace`, and drops the Delivery card and page title wrapper.
