# Centralized feature flags and experiments — work ledger

- **complete — Core contract**
  - Verified: versioned list states, scoped A2A auth and audit lineage,
    controlled editor, exact decisions, exposure helpers, docs, skills, locales,
    typecheck, and focused tests.
- **complete — Analytics backend**
  - Verified: fleet actions, experiment schema/lifecycle/readouts,
    reconciliation, running-flag locks, migrations, typecheck, and focused tests.
- **complete — Analytics UI**
  - Verified: sibling admin views, mixed-state fleet UI, controlled editing,
    experiment workflow, navigation/application-state parity, i18n, changelog,
    typecheck, and focused tests.
- **complete — integrated verification and independent QA**
  - Verified: repository guards, Core and Analytics typechecks, focused suites,
    the broad Framework workspace run, and the frozen browser story against a
    disposable three-app fleet. The browser pass caught and verified a fix for
    transient partial rule envelopes in the shared editor.
  - Note: the broad Framework run's only failures were Design browser tests on
    a worker without the Playwright Chromium executable; all other workspace
    project suites passed.
- **parked — remote stakeholder adjustments**
  - Owner: orchestrator
  - Next: incorporate later product feedback only if it changes the settled
    Analytics/Core/Dispatch boundary.
  - Resurface: when feedback arrives or before the PR leaves draft.
