---
"@agent-native/core": minor
"@agent-native/toolkit": patch
---

Automatic Builder setup at signup can now be enabled for exact hosted hostnames with `onboarding.builderSignupHostedHosts`, so an app copied from a template does not switch it on for its own domain. The sign-in page asks for an assignment only when the server has enabled the experiment for the request host, and the framework default stays off.
