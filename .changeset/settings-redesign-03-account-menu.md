---
"@agent-native/core": minor
---

Turn `OrgSwitcher` into an account menu (also exported as `AccountMenu`). The button shows the signed-in person's photo, name, and current organization. The menu lists organizations, invitations, domain matches, and Create organization, then Settings (with the `⌘,` hint), Usage, a "Get apps and extensions" drill-in when `utilityLinks` are passed, and Log out. Invite member, Organization settings, Profile, and the Tools header leave the menu, and Log out leaves Settings › Account. `settingsPath` and `profilePath` are deprecated and ignored.
