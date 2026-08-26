---
"@agent-native/core": patch
---

Stop a rejected provider credential from re-breaking the first prompt on a fixed cadence

A 401 pins the rejected credential so the next lane serves everyone after it, but
two things kept unpinning it and making the next person's first prompt pay to
rediscover the same rejection:

- `ai-sdk-engine` cleared the auth-failure marker after every stream, error or
  not, so one unrelated failure (a 500, an overload) re-admitted a credential a
  401 had just pinned. Clearing asserts the credential works, so only a turn
  that actually completed does it now.
- Both auth-failure markers released on a flat 15-minute TTL. The marker is
  fingerprinted on the credential value, so a rotated credential never matched
  the old marker anyway — the TTL only ever re-tested a credential that was
  still wrong. Repeat failures on the same fingerprint now back off
  exponentially from that base up to 24h, while a first, genuinely transient
  401 still releases on the original TTL.
