# Password Reset Email Design

## Goal

Ensure password-reset requests send for any existing Better Auth user, including Google-only users, while preserving the configured no-reply sender and avoiding app-specific Reply-To overrides.

## Behavior

Better Auth remains responsible for email-based user lookup and reset-token lifecycle. Its reset endpoint already supports social-only users: requesting a reset invokes `sendResetPassword`, and completing it creates a credential account when one does not exist.

The reset template remains app-branded in its subject and body, but it will not return `appSender`. The send call therefore uses the deployment's configured `EMAIL_FROM`; with first-party configuration this is `Agent Native <noreply@agent-native.com>`. No explicit Reply-To is set, so replies resolve to the same no-reply address.

Verification and invitation emails keep their existing sender behavior. Unknown emails continue to receive Better Auth's generic success response without a send, preventing account enumeration.

## Verification

Add a template test proving reset messages have no sender override and retain app-specific content branding. Add focused Better Auth route coverage proving a social-only user is eligible for reset and that completing the reset creates a credential account. Run Core tests, type checking, and the workspace guards.
