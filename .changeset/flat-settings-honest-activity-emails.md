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
  `delivery-failed`, `no-recipients`, `email-not-configured`, or
  `notification-error` rather than collapsing them into an empty success. A
  batch where every send threw is reported as `delivery-failed`, never as a
  delivery.
- `runActivityNotification` (`@agent-native/core/server`) runs a notification
  without letting it reject the write that caused it. The comment is already
  persisted when notification runs, so throwing made the client retry and
  duplicate the row; the failure now surfaces as `notification-error`.
- `filterRecipientsByResourceAccess` (`@agent-native/core/sharing`) keeps only
  the addresses that can open a resource right now. Notification recipients
  come from history — stored mentions, past thread authors — and none of that
  is an access grant, so mentioning an arbitrary address no longer mails it the
  comment body and a revoked collaborator stops receiving the thread.
- `isOrgMember` (`@agent-native/core/org`) is now one exported resolver instead
  of two private copies of the same query.
- Review threads now send comment, reply, and mention emails from core
  (`notifyReviewComment`), so every app built on the review surface gets them.
  `ReviewableResourceRegistration` gained an optional `resolveUrl` so those
  emails can deep-link to the resource instead of the app root.
