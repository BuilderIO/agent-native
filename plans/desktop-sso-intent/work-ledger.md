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
  status: blocked
  summary: the updater guard is locally proven and independently reviewed; current-head CI, a fresh signed artifact, updater-safe exact-artifact QA, and authenticated real-app acceptance still block handoff readiness
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
    - current origin/main merged without conflicts; the SSO implementation remains based on current main
    - post-integration Desktop broker and preload suite: 17 tests passed; Core identity: 18; Dispatch auth: 1; Desktop typecheck and diff checks passed
    - independent security review verified authenticated server revocation, logout-all escalation during revocation and cleanup, exhaustive partial-failure cleanup, and dormant production-session cleanup for disabled, Dev-switched, missing, or edited canonical app configurations
    - prior head 8d33ffffe9e8b0b3acc78e725736a96f97dae7e5 passed required CI and the signed/notarized macOS canary workflow
    - the short locked production canary proved canonical Mail to Dispatch routing, callback/state construction, hostile-callback rejection, and safe reverse-order rollback
    - the exact signed canary launched and reached production Dispatch, but its browser had no authenticated Dispatch identity
    - current updater guard focused suite: 10 tests passed; Desktop identity, preload, and updater suite: 27 tests passed; Desktop typecheck and diff checks passed
    - independent incremental review found no updater-code defects and verified the exact canary version family has no feed, check, download, install, listener, focus, ready-callback, or timer capability while stable and unrelated prerelease builds retain normal updater behavior
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
  blockers:
    - current-head required CI and a fresh signed/notarized canary artifact must pass
    - the branch canary must not offer, download, or install a stable Desktop update while exact-artifact acceptance is running
    - a safe authenticated Dispatch test identity is required to complete same-account Mail data, restart, sign-out, account-switch, isolation, and hostile-flow acceptance
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
ledger-revision: desktop-sso-work-r11
status: active
```
