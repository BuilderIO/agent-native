---
"@agent-native/core": minor
---

Add shared settings and activity-notification primitives.

- `SettingsGroup` / `SettingsRow` (`@agent-native/core/client/settings`) render
  several one-line settings inside a single card instead of one card per
  control. Each row keeps its own `id`, so existing settings-search hashes
  still resolve after a card collapses into a row.
- `resolveActivityRecipients` and `notifyActivity`
  (`@agent-native/core/server`) resolve who should receive a collaboration
  email — owner, thread participants, mentions, never the actor — filter them
  by an app-owned preference key, and report delivery as `delivered`,
  `no-recipients`, or `email-not-configured` rather than collapsing all three
  into an empty success.
- Review threads now send comment, reply, and mention emails from core
  (`notifyReviewComment`), so every app built on the review surface gets them.
  `ReviewableResourceRegistration` gained an optional `resolveUrl` so those
  emails can deep-link to the resource instead of the app root.
