# Desktop workspace SSO work ledger

```yaml
stage: work
authority-source: "Alice: All right. Log that plan to the vault and work it."
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
  status: pending
  summary: implementation and automated verification are complete; live canary and signed installed-app acceptance remain outstanding
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
  implementation:
    - authenticated nonce-only app-local completion route in Core
    - dedicated persistent Dispatch identity partition in packaged Desktop
    - canonical-registry-only app session federation with target-cookie filtering
    - serialized and coalesced sign-in ceremonies with direct-login fallback
    - renderer-safe status and sign-in/sign-out IPC without credential material
    - workspace-wide Desktop sign-out for exact canonical POST logout requests
    - operator docs, all localized counterparts, authentication skill, and Core changeset
    - branch-scoped signed macOS canary workflow with no publishing, tags, releases, or updater feed
    - Dispatch primary-auth public-route configuration eliminating concurrent auth-initializer pre-emption
  blockers:
    - signed packaging depends on the repository's GitHub-hosted Apple signing and notarization secrets
    - production promotion requires green CI, a successful signed candidate, human review, and freshly captured rollback evidence
    - the signed installed-app matrix still needs restart, account switch, standalone browser, custom app, local-development, and hostile-flow verification against the canary
  last-land-packet: null
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
ledger-revision: desktop-sso-work-r5
status: active
```
