---
"@agent-native/core": patch
---

The Builder.io OAuth callback re-checks a personal connection's eligibility (the member's role and the organization's personal API key restriction) before saving it, so a policy or role change during sign-in can't leave a personal grant behind. The personal API key restriction view reads every member's Builder.io grant in a few batched queries instead of one per member.
