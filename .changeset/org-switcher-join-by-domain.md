---
"@agent-native/core": patch
---

OrgSwitcher popover now surfaces orgs the user can auto-join by email domain. When the active session's email matches an `organizations.allowed_domain`, the picker renders a "Join your team" section with a one-click Join button that wires through `useJoinByDomain`. Previously the popover only showed orgs the user already belonged to plus pending invites, so domain-eligible users (e.g. anyone on `@builder.io` opening a template) saw only "Personal" / "Create organization" with no path into the existing company org.
