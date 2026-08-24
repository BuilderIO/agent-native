---
"@agent-native/core": minor
---

Add `auth.requireEmailVerification` to the app config schema, aliased to
`AUTH_REQUIRE_EMAIL_VERIFICATION`, so a deployment can state its password-signup
verification policy instead of inheriting the environment-derived one.
`AUTH_SKIP_EMAIL_VERIFICATION` stays a local/QA-only convenience that hosted
deployments ignore; a declared value outranks it. Setting the field to `false`
accepts an unverified address as a login credential and therefore also lifts the
hosted no-email-provider signup lock, which exists to prevent exactly that;
setting it to `true` where no email provider is configured disables password
signup rather than stranding accounts on a verification that cannot be delivered.
