---
"@agent-native/core": patch
---

Make transactional email presentation configurable from app code. `registerEmailRenderer` replaces the framework's email markup wholesale, and `configureEmailBranding` sets a default logo and accent color — both called once from a server plugin. Together they reach the six emails core renders where no app call site exists: signup verification, magic link, password reset, org invite, share notification, and review comment. A renderer receives the same `RenderEmailArgs` the built-in template gets and can call the newly exported `renderBuiltInEmail` to wrap rather than replace it.

Both fail loudly by design. `configureEmailBranding` validates at the call that sets it, so a malformed color throws at boot pointing at the plugin instead of becoming an email that quietly looks wrong. A registered renderer that throws or returns the wrong shape fails the send rather than silently substituting the built-in template, which would ship a password reset in the wrong brand while reporting success.

Also documents the outbound email surface, which was previously source-only knowledge: a new `transactional-email` docs page and matching skill covering `sendEmail`, `renderEmail`, branding and renderer registration, which arguments are escaped and which are injected raw, the `cid:agent-native-logo` auto-attach rule, sending fully custom HTML, and registering an email with `defineTransactionalEmail`.
