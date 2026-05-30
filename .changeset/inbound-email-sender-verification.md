---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Stop inbound email from impersonating real users. The inbound email adapter now
derives a `senderVerified` flag from the provider's DKIM/SPF
(`Authentication-Results`) results, and dispatch only grants a sender's real
identity — their API keys, org secrets, personal instructions, and ownable data
— when the message is DKIM/SPF-verified for the From domain AND that address is a
real org member. Unverified or spoofed `From:` headers fall back to a synthetic,
credential-less owner. Linked identities (`/link`) are unchanged. The legacy
"trust the From header" behavior can be restored with
`DISPATCH_TRUST_UNVERIFIED_EMAIL_SENDER=1` (off by default).
