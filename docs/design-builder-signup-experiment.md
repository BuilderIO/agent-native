# Design automatic Builder signup experiment

Design opts into `design_builder_signup_v1`. Other apps stay on their existing
signup and connection flow. Set `BUILDER_SIGNUP_EXPERIMENT=0` to disable new
assignments and automatic activation on the next deployment. Existing connections
remain intact.

Anonymous visitors receive a signed, HttpOnly, seven-day assignment cookie before
signup controls are enabled. The allocation is 50% control and 50% automatic.
Both groups retain their assignment through redirects and reloads in that browser.
The automatic group sees Builder account creation and linked Builder terms and
privacy disclosure before signup. Clicking treatment signup records acceptance for an explicit auth attempt. Password
and magic-link attempts include the submitted email; Google carries the attempt in
its signed OAuth state. Only the successful account-creation continuation may bind
that attempt to a user, and its original browser cookie must still match. A verified
session must match that durable consent binding and an account created after
acceptance. Abandoned attempts, later unrelated logins, returning accounts and
missing/expired cookies never auto-provision. Control records assignment at account
creation without recording Builder acceptance or calling the acceptance endpoint.
Acceptance failures preserve normal signup and disable automatic activation for
that attempt. Organization-managed SSO and delegated preview sign-in retain their
existing connection flow; cross-device magic links also fall back when the original
acceptance cookie is absent.

A non-secret pending cookie lets Design hold the first-run surface while activation
runs. Ordinary returning visitors make no activation request. Server-side settings
under `design_builder_signup_v1:<auth-user-id>` retain the assignment, policy revision,
acceptance time, attempt and terminal outcome. Separate `:attempt:<id>` and
`:consent:<user-id>` settings bind treatment consent to its authenticated completion.
Anonymous acceptance writes only the signed cookie; durable records are created only
after account creation, avoiding abandoned pre-signup records.
Automatic attempts are reserved atomically and are not retried after an uncertain
outcome. An interrupted reservation expires into terminal fallback after 45 seconds;
a thrown activation error records terminal fallback immediately. Post-write audit or
telemetry failures keep the connection connected and report an explicit warning. The old connection flow
remains available after errors and for every existing Builder account, including
accounts with multiple spaces.

## Builder deployment dependency

Activation exclusively sends `agent-native-account-v3` to
`POST /api/v1/accounts/agent-native`, with `newAccountOnly: true`. Its HMAC payload is:

```
version\ntimestamp\nrequestId\nemail\nname\nagentNativeApp\nagentNativeTemplate\nnew-account-only
```

Builder must validate the v3 signature and mode, refuse either an existing Firebase
identity or user-settings record with `409 account_exists`, and never issue or
rotate an existing account's tokens in this mode. New-account creation retains
Builder's free-plan provisioning, abuse checks, uniqueness enforcement and email
claim lock. Existing v1/v2 clients keep their current behavior.

Older Builder servers reject v3. Agent-Native then uses its ordinary connection
flow; it never downgrades to v1/v2. The bypass becomes effective only after this
Builder API contract is deployed and provisioning is configured. Merging
Agent-Native alone does not establish that the bypass is live.

## Measurement and verification

`auth.builder_signup_experiment_exposed` identifies the pre-signup denominator.
Auth events include `experiment_id`, `experiment_variant` and `assignment_id`.
`builder_signup_experiment_outcome` binds assignment to account creation and reports
control/connected/fallback with an explicit reason.
`auth.builder_signup_experiment_unavailable` records assignment or acceptance
failures separately from an intentionally disabled experiment. Join subsequent
Design activation and retention events by authenticated user id. Include every
exposed visitor, including signup abandoners, in the primary conversion analysis.
Stratify by the independent first-run credits experiment and track provisioning
failures, existing-account fallbacks, latency and credit spend separately.

Before enabling on production, verify the deployed v3 API, provisioning secret
configuration, treatment disclosure on each signup method, verified new-account
success, existing-account refusal, and both variants on the intended Design host.
Legal/privacy review of the combined-account disclosure is separate from technical
verification. Signup acceptance does not opt the user into optional marketing or
paid billing.
