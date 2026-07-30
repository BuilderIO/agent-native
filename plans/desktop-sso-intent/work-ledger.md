# Desktop workspace SSO work ledger

```yaml
stage: work
authority-source: "Alice: $work after the desktop SSO Land no-go packet."
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
    - packages/core
    - docs
    - .agents/skills/authentication
    - .changeset
    - .github/workflows/desktop-canary.yml
    - plans/desktop-sso-intent/work-ledger.md
    - /Users/alicemoore/Developer/teenylilthoughts/briefs/Agent-Native Desktop workspace SSO canary implementation plan 2026-07-21.md
governing-artifact:
  path: /Users/alicemoore/.codex/worktrees/52a5/agent-native/plans/desktop-sso-intent/implementation-brief.md
  revision: desktop-sso-brief-r1
architecture-fingerprint:
  outcome: one Desktop workspace identity ceremony followed by silent app-local federation
  shipping-surfaces:
    - id: desktop-shell
      repository: BuilderIO/agent-native
      product-surface: signed packaged Agent Native Desktop app
      constituency: users of canonical first-party Agent Native apps
      durable-destination: Agent Native Desktop release
    - id: core-identity
      repository: BuilderIO/agent-native
      product-surface: public Core authentication and identity-federation runtime
      constituency: source-blind Agent Native developers and app users
      durable-destination: published @agent-native/core package
    - id: dispatch-authority
      repository: BuilderIO/agent-native
      product-surface: Dispatch identity authorize flow
      constituency: first-party workspace users and self-hosted workspace operators
      durable-destination: Dispatch template and deployment
    - id: hosted-app-fleet
      repository: BuilderIO/agent-native
      product-surface: canonical first-party hosted app deployments
      constituency: Agent Native Desktop users
      durable-destination: per-app production deployments and auth configuration
  governing-architecture: Electron main owns one dedicated Dispatch identity partition and uses existing app-local federation; local development retains its loopback file broker; custom apps and Builder Connect remain outside the boundary
  acceptance-story:
    id: desktop-first-party-sso-v1
    summary: one Desktop sign-in opens every canonical first-party app as the same verified account while preserving app-local sessions, databases, authorization, and data isolation
    required-assertions:
      - signed packaged Desktop and real canary deployment pass before merge
      - every enabled canonical first-party app resolves the correct existing account and data without another credential ceremony
      - restart, workspace sign-out, account switch, standalone browser, custom app, and local-development behavior pass
      - hostile redirect, nonce, origin, cookie, concurrency, cancellation, and logging cases fail closed
      - Builder internal and Builder credentials do not participate
  risk-strategy:
    kind: system-ready
    production-validation-after-merge: false
delegation-ceiling:
  - read-only inventory and verification
product-boundary-gates:
  agent-native-public-constituency: source-blind developers packaging Desktop with standard Core and Dispatch apps receive the reusable identity boundary without Alice-specific infrastructure
acceptance-state:
  status: active
  summary: Desktop now has a credential-free path to authenticate its dedicated identity partition directly against canonical production Dispatch; signed-canary and authenticated end-to-end acceptance remain
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
    - direct Dispatch authority sign-in implementation 652fc57b68408812af748302141df1f01d6ab95c passes all 232 Desktop tests, Desktop typecheck, production build, formatting, diff checks, and a credential-material diff scan
  implementation:
    - authenticated nonce-only app-local completion route in Core
    - dedicated persistent Dispatch identity partition in packaged Desktop
    - canonical-registry-only app session federation with target-cookie filtering
    - serialized and coalesced sign-in ceremonies with direct-login fallback
    - renderer-safe status and sign-in/sign-out IPC without credential material
    - workspace-wide Desktop sign-out preserves exact canonical POST logout and logout-all server semantics, retains request-start credentials only for the active cleanup operation, and reports partial failure truthfully
    - sign-out cleanup inventories every immutable canonical packaged production partition independently of sidebar enablement, Dev mode, or edited URLs while leaving localhost and custom origins untouched
    - operator docs, all localized counterparts, authentication skill, and Core changeset
    - branch-scoped signed macOS canary workflow with no publishing, tags, releases, or updater feed
    - Dispatch primary-auth public-route configuration eliminating concurrent auth-initializer pre-emption
    - explicit Desktop account sign-in authenticates the dedicated identity partition against canonical production Dispatch and requires an allowlisted Dispatch session cookie before reporting success
  blockers:
    - the new exact-head signed canary must pass native Google sign-in before the short Mail and Dispatch candidate publication window can complete same-account continuity, restart, sign-out, account-switch, isolation, and hostile-flow acceptance
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
ledger-revision: desktop-sso-work-r16
status: active
```
