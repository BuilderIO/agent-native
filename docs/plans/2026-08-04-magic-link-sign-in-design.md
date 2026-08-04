# Magic Link Sign-In Design

## Goal

Make email magic links the default authentication method below the existing Google sign-in button, while retaining password sign-in, password signup, and forgot-password as an optional alternate mode.

## Architecture

Core adds Better Auth's `magicLink` plugin to the shared auth instance, making the same request and verification routes available in every app. Better Auth owns token generation, single-use verification, user lookup, session creation, and account linking. An unknown email creates a verified user only after the recipient opens the link; existing Google-only and password users resolve to the same app-local user by email.

Google sign-in and its preflight behavior remain unchanged. Password authentication remains enabled and uses the existing Better Auth routes.

## Sign-In UI

Below the Google button and “or” divider, the default view is one “Continue with email” form containing an email field and submit button. A “Use password instead” control reveals the existing Create Account / Sign In tabs and forms. Password mode includes “Use an email link instead” to return to the default view; the choice is not persisted across visits.

After a successful request, the magic-link form shows “Check your email” copy and supports resending. Forgot Password remains available only inside password Sign In. Existing localization, resume-path handling, validation, loading states, accessibility, responsive styling, and Google-only mode are preserved.

## Transactional Email

Add one shared catalog entry, `core.magic-link-sign-in`. Sign-in and first-time account creation use the same message because both verify the same token endpoint. The message is app-branded in its subject and body, uses representative dummy data for Dispatch preview, and passes its template ID to `sendEmail` for activity logs and SendGrid attribution.

The transport uses configured `EMAIL_FROM` with no sender or Reply-To override. First-party deployments therefore send from `noreply@agent-native.com`. The body explains that opening the link signs the recipient in and that an unrequested message can be ignored.

## Data Flow and Security

The browser normalizes and validates the email, then submits it with a same-origin resume destination. Better Auth generates a short-lived, single-use token and invokes the email callback. The callback renders and awaits delivery before the UI reports success. The verification endpoint resolves the user by email, creates a verified user for a new address, and establishes the session before redirecting to the validated resume path.

Callback destinations must remain same-origin to prevent open redirects. Delivery failures show retryable generic errors. Expired, invalid, or already-used links return to sign-in with clear localized copy. Password-reset behavior remains unchanged.

## Testing

Cover plugin registration and send callback arguments, existing Google-only user sign-in, new-user creation on verification, configured no-reply sender behavior, catalog registration/preview, UI default/toggle/success/error states, callback validation, and localization keys. Run focused Core tests, Core build, workspace guards, and browser verification for magic-link and password alternate paths.
