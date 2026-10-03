---
"@agent-native/core": patch
---

Record a signup whose first visit carried UTM tags or an ad click id, but no referrer, as `referral_source: "campaign"` instead of `"direct"`. Links opened from mobile apps, email clients, or a `noreferrer` hop keep their tags, so they no longer count as direct traffic.
