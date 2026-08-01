# Desktop workspace SSO work ledger

```yaml
stage: work
authority-source: "Alice: Yes, you can work it, approving desktop-first-party-sso-front-door-v2."
authorized-scope:
  repositories:
    - BuilderIO/agent-native
    - alicemoore/teenylilthoughts
  product-surfaces:
    - Agent Native Desktop packaged application
    - Core authentication and cross-app identity federation
    - Dispatch identity authority
    - first-party hosted Agent Native app fleet
  outcome: one human sign-in for all canonical first-party apps opened in Agent Native Desktop
allowed-mutations:
  - artifact-write
  - branch
  - commit
  - push
  - pull-request
  - deploy
write-targets:
  artifacts:
    - packages/desktop-app
    - .agents/skills/authentication/SKILL.md
    - plans/desktop-sso-intent/work-ledger.md
governing-artifact:
  path: plans/desktop-sso-intent/work-ledger.md
  revision: desktop-sso-work-r20
architecture-fingerprint:
  outcome: one Agent Native workspace sign-in begun from the ordinary front door of any canonical first-party app, followed by silent app-local federation
  shipping-surfaces:
    - id: desktop-shell
      repository: BuilderIO/agent-native
      product-surface: signed packaged Agent Native Desktop app
      constituency: users of canonical first-party Agent Native apps
      durable-destination: PR #2290 exact head plus its signed branch-canary artifact; stable Desktop release remains outside this lane
      integration-action: push
    - id: core-identity
      repository: BuilderIO/agent-native
      product-surface: public Core authentication and identity-federation runtime
      constituency: source-blind Agent Native developers and app users
      durable-destination: PR #2290 exact head with its Core changeset; package publication remains outside this lane
      integration-action: push
    - id: dispatch-authority
      repository: BuilderIO/agent-native
      product-surface: Dispatch identity authorize flow
      constituency: first-party workspace users and self-hosted workspace operators
      durable-destination: PR #2290 exact head; stable Dispatch integration remains outside this lane
      integration-action: push
    - id: hosted-app-fleet
      repository: BuilderIO/agent-native
      product-surface: short locked canonical-origin Mail and Dispatch canary deployments
      constituency: supervised pre-merge canary testers
      durable-destination: exact candidate and rollback receipts recorded in the ledger, with canonical production restored after the test
      integration-action: deploy
  governing-architecture: Electron main keeps one dedicated Dispatch identity partition, intercepts the ordinary sign-in entry of an eligible canonical app, and uses existing app-local federation; Settings is status, sign-out, and recovery rather than the primary identity front door; local development retains its loopback file broker; custom apps and Builder Connect remain outside the boundary
  acceptance-story:
    id: desktop-first-party-sso-front-door-v2
    summary: signing in normally from any eligible canonical first-party app establishes the shared Agent Native workspace identity, returns to that initiating app without exposing Dispatch home, and lets every later canonical app open as the same verified account while preserving app-local sessions, databases, authorization, and data isolation
    required-assertions:
      - signed packaged Desktop and real canary deployment pass before merge
      - the ordinary sign-in entry in each enabled canonical first-party app, including Dispatch, can initiate the shared workspace ceremony and returns to the initiating app without using Dispatch home as a completion screen
      - the Desktop Settings account card accurately reflects an existing authority session and never presents Dispatch home as successful sign-in; any signed-out action hands off to an app front door or is clearly labeled as recovery
      - every enabled canonical first-party app resolves the correct existing account and data without another credential ceremony
      - restart, workspace sign-out, account switch, standalone browser, custom app, and local-development behavior pass
      - hostile redirect, nonce, origin, cookie, concurrency, cancellation, and logging cases fail closed
      - Agent Native identity sign-in remains separate from app-specific provider connection and consent
      - Builder internal and Builder credentials do not participate
  risk-strategy:
    kind: system-ready
    production-validation-after-merge: false
delegation-ceiling:
  - read-only inventory and verification
architecture-grounding:
  applicability: required
  reason: authentication spans Desktop, Core, Dispatch, and every participating first-party deployment
  status: grounded
  demonstrated-callers:
    - pre-fix Desktop Settings account Sign in invoked IPC.IDENTITY_SIGN_IN and the direct Dispatch authority ceremony
    - a canonical app webview reaching its exact /_agent-native/sign-in invokes the existing app-targeted Desktop federation ceremony
  existing-primitives:
    - DesktopIdentityBroker.ensureAppSession uses the initiating app's existing identity/login route and copies only that app's allowlisted local session
    - the pre-fix DesktopIdentityBroker.signInAuthority opened Dispatch's generic sign-in document in the dedicated identity partition
    - Core's generic sign-in document redirects an already-authenticated session to its validated continuation
    - Dispatch remains the existing identity authority and authorize endpoint
  ownership-boundaries:
    - Desktop main owns partitions, ceremony lifecycle, trusted app resolution, cookie transfer, and bounded status IPC
    - Core owns the generic sign-in journey and trusted-app federation client/callback
    - Dispatch owns human authentication, redirect validation, and identity assertion minting
    - each target app owns its local user, session, authorization, provider grants, and data
  legacy-contracts:
    - preserve legacy ?return= consumption on /_agent-native/sign-in
    - preserve standalone browser, direct app login, local loopback broker, custom-app exclusion, app-local databases, and per-provider consent
    - preserve the dedicated identity partition and exact app/origin/callback/cookie trust boundaries
  shared-vocabulary:
    - workspace sign-in means Agent Native identity federation, not provider connection sharing
    - app front door means the app's ordinary sign-in entry, not a hidden Dispatch account page
    - Settings account card is a secondary status, sign-out, and recovery surface
  smallest-compatible-delta: remove the Settings-only authority sign-in command, make an eligible canonical app's ordinary sign-in entry the sole workspace front door, reflect authority status and workspace sign-out in Settings, and retain Dispatch's generic sign-in only as the identity-provider step inside the app-led ceremony
  deferred-capabilities:
    - custom and third-party app federation
    - shared provider OAuth grants or automatic provider-scope expansion
    - replacing Dispatch, Better Auth, or app-local sessions
  reversibility: Desktop-only routing and status behavior can be reverted without schema, credential, provider, or deployment-data migration; hosted federation remains opt-in per app
  direct-evidence:
    - the Clip shows Settings Sign in visibly landing on Dispatch home instead of returning to an initiating app
    - pre-fix source routed Settings directly to signInAuthority(dispatch) and used Dispatch root as its completion observation
    - current source already intercepts exact sign-in navigation for eligible canonical apps and completes app-local federation in the dedicated identity partition
    - Core documentation defines federation as happening at the app front door and preserves app-local sessions
  inferences:
    - the Clip's immediate root redirect is consistent with a pre-existing Dispatch session in the identity partition, but the Clip does not expose cookie or IPC status evidence
    - Dispatch self-federation is source-supported but still requires current signed-runtime acceptance
  unresolved-owner-questions: []
product-boundary-gates:
  agent-native-public-constituency: source-blind developers packaging Desktop with standard Core and Dispatch apps receive the reusable identity boundary without Alice-specific infrastructure
acceptance-state:
  status: pending
  summary: Alice approved the app-front-door replacement story; current main is integrated, the branch canary now has a fail-closed profile distinct from stable Desktop, and exact-head CI, signed-canary, and native acceptance must be regenerated while production remains on normal unlocked main deployments
  verified:
    - Core identity protocol suite: 210 tests passed
    - Desktop main, renderer, shared, broker, and preload suites: 202 tests passed
    - Desktop TypeScript clean-machine typecheck passed on Framework
    - Core package build passed on Framework
    - Desktop production compile passed on macOS
    - i18n catalog guard and git diff checks passed
    - Dispatch package suite: 269 tests passed; package build and typecheck passed on Framework
    - Dispatch template suite: 40 tests passed; template typecheck passed on Framework
    - production-shaped Netlify bundle changed the valid logged-out identity authorize request from 401 to the expected 302 sign-in redirect
    - Desktop identity regression suite: 8 tests passed, including sign-out suppression, queued cancellation, cookie-write draining, and immediate explicit reauthentication ordering
    - final-fix Desktop TypeScript passed
    - final-fix formatting, focused lint, and git diff checks passed
    - independent final technical review found no remaining actionable issues after the repeated sign-out concurrency regression was added
    - current origin/main ce426feef1ebeb370fca581291c9391339a757ed integrated in merge commit 7d4cbf499; updater and Dispatch identity conflicts were resolved by retaining both current-main recovery/sign-in behavior and the frozen SSO safety boundaries
    - post-integration Desktop broker and preload suite: 17 tests passed; Core identity: 18; Dispatch auth: 1; Desktop typecheck and diff checks passed
    - independent security review verified authenticated server revocation, logout-all escalation during revocation and cleanup, exhaustive partial-failure cleanup, and dormant production-session cleanup for disabled, Dev-switched, missing, or edited canonical app configurations
    - prior head 8d33ffffe9e8b0b3acc78e725736a96f97dae7e5 passed required CI and the signed/notarized macOS canary workflow
    - the short locked production canary proved canonical Mail to Dispatch routing, callback/state construction, hostile-callback rejection, and safe reverse-order rollback
    - the exact signed canary launched and reached production Dispatch, but its browser had no authenticated Dispatch identity
    - pre-integration updater guard focused suite: 10 tests passed; Desktop identity, preload, and updater suite: 27 tests passed; Desktop typecheck and diff checks passed
    - pre-integration independent review found no updater-code defects and verified the exact canary version family has no feed, check, download, install, listener, focus, ready-callback, or timer capability while stable and unrelated prerelease builds retain normal updater behavior
    - post-integration focused verification on 7d4cbf499: Desktop identity, updater policy/runtime, and preload 29 tests passed; Core identity 27; Dispatch primary-auth forwarding 1; Dispatch identity library 24
    - post-integration conflict review verified every updater touchpoint retains the exact canary eligibility guard while current-main delayed native staging and manual-result notifications remain intact; Dispatch retains the sign-in journey while primary auth remains the sole initializer
    - exact-head required CI run 30480891661 passed on 3d380f5db0d5ae93b310b3665c165d2a3716f1fd, including build, typecheck, security guards, Core integration, scaffold, SSR smoke, and every fast-test lane
    - exact-head signed canary run 30480891545 passed signing, notarization, provenance, trust verification, and short-lived artifact upload for desktop-sso-canary-3d380f5db0d5ae93b310b3665c165d2a3716f1fd
    - downloaded canary 0.1.150-desktop-sso-canary.9 matched all four manifest SHA-256 values and the arm64 app passed strict deep codesign, stapler, Gatekeeper, bundle id, version, signer, and architecture checks locally
    - exact-head canary .9 is installed side-by-side at /Applications/Agent Native SSO Canary.app; the prior .2 canary is preserved recoverably at /Applications/Agent Native SSO Canary.previous.app and the stable Desktop app is untouched
    - immutable exact-head Netlify candidates 6a6a48cbd8ca3400088ba95f (Mail) and 6a6a48cbc9c76200085e212c (Dispatch) are ready and unpublished
    - candidate preflight proved Mail constructs the canonical Dispatch authorize route, Dispatch returns the logged-out sign-in continuation for the canonical Mail callback, and Dispatch rejects a hostile callback with 400 before session work
    - fresh production rollback targets are Mail 6a6a3a4ee65f5f0008ca3fc5 and Dispatch 6a6a3a4e9b07310008196a34, both current-main ce426feef1ebeb370fca581291c9391339a757ed
    - exact-head required CI run 30489087026 and signed canary run 30489085253 passed on 5d57687b13b0d3572bbd6a10a525ed43cba28139; canary .12 passed manifest checks, strict signing, notarization, Gatekeeper, bundle identity, version, and arm64 verification
    - independent updater-isolation QA on canary .12 passed a four-minute observation and real quit/relaunch cycle with no updater activity
    - two fresh post-publication profiles proved the identity control renders but native activation does not reach Dispatch; both short production windows were rolled back in reverse order and Mail and Dispatch were restored unlocked to ce426fe
    - Electron 41.9 runtime probes proved session.fetch manual redirects throw Redirect was cancelled, followed fetches omit response.url, and net.request manual mode exposes the first redirect event
    - the replacement native redirect resolver passes 19 focused identity/navigation tests, 228 full Desktop tests, Desktop typecheck, formatting, and diff checks; independent review found no redirect-trust, request-lifecycle, cancellation, cookie-isolation, or logging defect
    - exact-head required CI run 30555246811 and signed canary run 30555243503 passed on d19c92f1d1ebe3ab336506e9f27e6efa9125da25
    - downloaded canary 0.1.150-desktop-sso-canary.13 matched all four manifest SHA-256 values and passed strict deep codesign, stapler, Gatekeeper, bundle id, version, signer, and arm64 checks locally
    - independent pre-publication QA on canary .13 passed a fresh-profile launch, disabled updater observation, real quit, process-absence check, and relaunch without touching the stable Desktop app
    - the short locked production canary published immutable candidates 6a6a48cbd8ca3400088ba95f (Mail) and 6a6a48cbc9c76200085e212c (Dispatch); valid canonical routes returned the expected 302 chain and hostile redirect and forged callback requests returned 400
    - fresh-profile native acceptance on canary .13 passed Mail activation into the canonical Dispatch sign-in ceremony with the exact Mail app id and callback; the run stopped safely when Dispatch presented credential fields
    - the canary window rolled back in reverse order to current-main 13f7e6bceceb52f04b69201f911729c174524041 using Mail deploy 6a6b46a26b16cb0008e0cf26 and Dispatch deploy 6a6b46a2ef65c600082759f5; both sites were unlocked, temporary identity routes returned baseline 401, Mail root retained normal redirect behavior, and canary and updater processes were absent
    - superseded direct Dispatch authority sign-in implementation 652fc57b68408812af748302141df1f01d6ab95c passed all 232 Desktop tests, Desktop typecheck, production build, formatting, diff checks, and a credential-material diff scan before the front-door acceptance story invalidated it
    - front-door replacement removes the Settings authority sign-in command end to end across renderer, preload, IPC, main, broker, tests, and authentication guidance while retaining status and workspace sign-out
    - live status refresh now rejects stale results when a sign-in ceremony or workspace sign-out begins during cookie I/O and skips authority-cookie inspection throughout an active sign-out
    - Dispatch as the initiating app now accepts only its exact same-origin nonce-bound desktop completion when Core detects the existing authority session, copies only the allowlisted Dispatch app session, retains the dedicated authority cookie, and never opens Dispatch home
    - replacement front-door Desktop verification: all 231 tests across 24 files passed; Desktop TypeScript, production build, formatting, and git diff checks passed
    - final independent read-only review found no remaining source-level defect or requested coverage gap in the status concurrency, direct-completion, cancellation, or cookie-isolation paths
    - current origin/main 3e89c5e5aea6752beea0849fbd62c5a1d58b986d was integrated without textual conflicts in merge commit 6e202d737ad3f84ba3801a38b596b118d1fa69a2; all four acceptance-relevant overlaps retain both the SSO behavior and current-main additions
    - post-integration focused verification on 6e202d737: Desktop identity and updater 24 tests passed; Core identity 27; Dispatch primary auth 1; Dispatch template identity 24
    - post-integration full relevant verification on 6e202d737: Desktop 231 tests, Dispatch package 336, Dispatch template 41, Desktop/Core/Dispatch/Dispatch-template typechecks, Core and Dispatch builds, Desktop production compile, formatting hygiene, and git diff checks passed
    - the broader Core package sweep passed 10080 tests and failed 228 tests because Node 24 exposed no browser localStorage in the Mac test runtime; every failing test source is unchanged from current main, so this is recorded as baseline harness evidence rather than SSO acceptance
    - local artifact inspection found that packaged Desktop SSO canaries still inherited stable Desktop's Electron userData path even though development was isolated; canary .19 was therefore not installed
    - the packaged canary version family now selects Agent Native SSO Canary as its userData directory before Sentry or logger initialization and aborts launch if that isolated profile cannot be established, while stable Desktop retains its existing profile
    - canary-profile fix verification: all 236 Desktop tests passed; Desktop TypeScript, production build, formatting, and git diff checks passed
    - the startup regression suite proves profile creation and selection precede Sentry and logger initialization, packaged isolation failure aborts before either consumer starts, stable Desktop leaves its profile unchanged, and development retains its recoverable fallback
  implementation:
    - authenticated nonce-only app-local completion route in Core
    - dedicated persistent Dispatch identity partition in packaged Desktop
    - canonical-registry-only app session federation with target-cookie filtering
    - serialized and coalesced sign-in ceremonies with direct-login fallback
    - renderer-safe status and sign-out IPC without credential material
    - workspace-wide Desktop sign-out preserves exact canonical POST logout and logout-all server semantics, retains request-start credentials only for the active cleanup operation, and reports partial failure truthfully
    - sign-out cleanup inventories every immutable canonical packaged production partition independently of sidebar enablement, Dev mode, or edited URLs while leaving localhost and custom origins untouched
    - operator docs, all localized counterparts, authentication skill, and Core changeset
    - branch-scoped signed macOS canary workflow with no publishing, tags, releases, or updater feed
    - Dispatch primary-auth public-route configuration eliminating concurrent auth-initializer pre-emption
    - the ordinary sign-in entry in a canonical first-party app starts the app-targeted workspace ceremony; Settings exposes status and workspace sign-out but no separate authority sign-in command
  blockers:
    - the canary-profile fix must be independently reviewed, pushed, and pass exact-head CI plus a newly signed canary before native Google sign-in from an ordinary app front door can begin
    - the short Mail and Dispatch candidate publication window must then complete same-account continuity, restart, sign-out, account-switch, isolation, provider-separation, and hostile-flow acceptance before Work can be complete
  last-land-packet: https://github.com/BuilderIO/agent-native/pull/2290#issuecomment-5062742844
deployment-boundary:
  allowed:
    - branch-scoped GitHub Actions macOS canary build with publish disabled
    - immutable Dispatch and Mail candidate deploy preparation
    - short, announced Mail canonical-origin production canary with exact rollback target
  forbidden:
    - editing the stable desktop release workflow
    - tags, updater feeds, or GitHub releases
    - merge or stable Desktop publication without a separate decision
    - enabling arbitrary preview hosts, custom apps, or Builder credentials
vault-brief: /Users/alicemoore/Developer/teenylilthoughts/briefs/Agent-Native Desktop workspace SSO canary implementation plan 2026-07-21.md
return-to-shape:
  banner: resolved by Alice's explicit Work approval
  invalidated-field: acceptance story
  old-fingerprint:
    outcome: one Desktop workspace identity ceremony followed by silent app-local federation
    governing-architecture: dedicated Dispatch identity partition plus app-local federation, with Settings able to start a direct authority ceremony
    acceptance-story: desktop-first-party-sso-v1
    risk-strategy: system-ready, production validation before merge
  proposed-fingerprint:
    outcome: one workspace sign-in begun at any canonical app's ordinary front door, followed by silent app-local federation
    governing-architecture: dedicated Dispatch identity partition plus existing app-targeted federation; Settings is secondary status, sign-out, and recovery and never exposes Dispatch home as completion
    acceptance-story: desktop-first-party-sso-front-door-v2
    risk-strategy: unchanged system-ready, production validation before merge
  replacement-acceptance-story: desktop-first-party-sso-front-door-v2 approved
production-safety-preflight:
  verified-at: 2026-08-01T09:05:00-04:00
  mail: normal unlocked auto-publishing main deploy 6a6ddd1e966031000859bd7e at 3e89c5e5aea6752beea0849fbd62c5a1d58b986d, identity route baseline 401, root normal 302
  dispatch: normal unlocked auto-publishing main deploy 6a6ddd1e8eef7d00084f719e at 3e89c5e5aea6752beea0849fbd62c5a1d58b986d, identity authorize baseline 401
  local: no SSO Canary, ShipIt, or Squirrel process remains; stable Desktop untouched
ledger-revision: desktop-sso-work-r20
status: active
```

## Return-to-shape review: the sign-in front door

### What changed

The original product destination was “one human sign-in for every canonical first-party app,” but the current Settings implementation added a direct authority ceremony whose visible success path is Dispatch's ordinary home page. Alice's Clip and feedback establish a more specific successful-user story: the normal sign-in inside any individual Agent Native app should be the front door to the shared workspace identity. Dispatch may remain the identity authority underneath, but Dispatch home is not a user-facing completion screen.

### Evidence-backed diagnosis

- The pre-fix Settings button called `signInAuthority("dispatch")`, opened `/_agent-native/sign-in?return=/` in the dedicated identity partition, and treated Dispatch `/` plus an allowlisted cookie as completion.
- Core's generic sign-in document intentionally redirects an already-authenticated session to its validated return path. The Clip's immediate jump to `/` is therefore consistent with an existing authority session, although the recording alone cannot prove the cookie or final IPC status.
- The app-led path already exists: an eligible canonical app reaching its ordinary sign-in entry is intercepted, federates through Dispatch in the dedicated identity partition, mints a normal session in the initiating app, and copies only that app's allowlisted cookie into its own partition.
- Provider connection remains a separate concern. Signing into the Agent Native account once does not silently grant Gmail, Slack, Notion, or other provider scopes.

### Options

1. **Patch only the Dispatch-home flash.** Preflight the authority session before opening the Settings window. This is mechanically smallest, but it leaves Settings as a privileged direct sign-in path and does not fully answer the front-door feedback.
2. **Use the app front door everywhere (recommended).** Keep the dedicated identity partition and existing federation. Make ordinary canonical-app sign-in the primary entry; have any Settings signed-out action hand off to the current eligible app's same ceremony, with a preflight so an existing authority session completes silently. Settings remains useful for status, workspace sign-out, and recovery, but never lands on Dispatch home.
3. **Reuse or synchronize the visible Dispatch app partition.** This could make Dispatch itself the shared cookie jar, but it collapses or duplicates the existing authority/app partition boundary and adds account-switch and logout coupling without evidence that the larger change is needed.

### Recommendation

Approve option 2. It is the smallest delta that addresses both the concrete Clip defect and the product expectation. It keeps the existing identity authority, dedicated partition, per-app local sessions, and provider-consent boundaries. Implementation should delete or stop using the Settings-only direct-root completion path, route through the existing app-targeted ceremony, add an authority-session preflight, and test Dispatch as an initiating canonical app rather than assuming it works.

### Replacement successful-user story

A user opens any canonical first-party app in packaged Desktop and uses that app's normal sign-in. Agent Native performs one workspace identity ceremony, returns to the initiating app without exposing Dispatch home, and silently signs subsequent canonical apps into their correct existing local accounts. Settings accurately reports the shared account and supports workspace sign-out or recovery. Standalone browsers, custom apps, local development, Builder credentials, app-local authorization, and provider-specific connection consent remain unchanged.
