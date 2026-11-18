# Action conformance

`@agent-native/core/testing` exports `checkActionConformance` and
`assertActionConformance`. One fixture is run through UI, MCP, A2A, ChatGPT and
Claude adapters. Adapters must exercise the real clients or transport handlers;
calling `action.run` five times does not test transport parity.

The Core inventory discovers every action-bearing template, imports its generated
registry, and records missing input/output schemas for every app. Strict enforcement
is staged through `packages/core/action-conformance-onboarding.json`: adding an app
in review requires complete schemas and owned real-client fixtures in the same PR.
The initial set is empty; no template has claimed client coverage yet. The audit
still runs for all templates and reports every gap as unmeasured. Onboarded apps require
`server/action-conformance.fixtures.ts`, exporting a default object with:

- `adapters`: `ui`, `mcp`, `a2a`, `chatgpt`, and `claude`. Each has `list()` and
  `call(name, args, signal)`. Catalog entries expose semantic input/output schemas; UI inputs use `schema`,
  agent inputs use `agentInputSchema ?? schema`, and fixture arguments must also
  validate against the full action schema.
  adapters unwrap transport envelopes before returning `result`.
- `fixtures`: keyed by every registered action name. Each supplies `args` and
  optional per-client `setup(surface, signal)` / `cleanup(surface, signal)` for
  independently owned records. Callbacks must honor cancellation before effects;
  cleanup must be idempotent and address ownership reserved before setup. The
  harness tracks setup, calls and polls through settlement. One finalizer attempts
  cancellation of every known task immediately, then waits for setup/calls/polls
  and cancels any newly revealed task. A stalled poll cannot delay cancellation
  of a known task, but leaves fixture teardown unconfirmed until its response
  can be accounted for. It checks each authenticated
  `cancelAndWait(signal)` terminal receipt before tearing down the fixture. Aborting an HTTP request does not establish that its
  remote task stopped; cancellation must wait for a server-fenced terminal state. If finalization remains unsettled, the returned report
  explicitly fails with unconfirmed cleanup. Eventual cleanup never mutates a
  returned report; a late failure emits only safe app/action/surface metadata. Reads
  require `visibleContent(signal)` from the UI and `resultContent(result)`, so an
  id-only or stale read cannot pass. Use a fixture with nonempty visible content.
- For actions producing links, a fixture supplies `focus` (exact `route`, `pane`,
  `applicationState`) and `open(url, signal)`, which follows the link through the app and
  reads the mounted pane and persisted application state. A URL string alone is
  insufficient proof.

Intentional access differences belong in a fixture's `excluded` map, with a
reason per client. The suite verifies the excluded action is actually absent.
Never widen permissions simply to satisfy parity.

Each fixture setup, content read, cleanup, catalog request, call, link open and pending-task poll has a 25-second
budget. This is the framework's conservative inline target, not a claimed
universal host timeout. A call may return `pending: { handle, poll(signal), cancelAndWait(signal) }`;
the suite validates the terminal result without re-running the action, rejects
empty handles, and fails tasks that never terminate. Returning a pending value
alone does not make work durable: the adapter must use an authenticated,
persisted task runner that survives the originating request. The harness does
not make arbitrary action handlers durable.

The first pending-task poll starts immediately. Later poll starts are spaced at
least 250 ms apart; a long poll already spends that interval and adds no further
wait. By default, polling continues within the remaining work budget rather
than stopping after a fixed number of fast pending responses. Each poll keeps
its 25-second operation ceiling. Pacing waits abort at the work deadline so the
reserved recovery window remains available for authenticated cancellation and
fixture cleanup. Callers may set a positive `maxPolls` for an intentional
additional cap, such as a controlled failure test.

The whole harness run has a 150-second ceiling, including a reserved recovery
window; callers may tighten it with `runTimeoutMs`. Each onboarded app has its
own inventory test and writes an incomplete/failure checkpoint before imports.
This keeps failed or stalled runtime measurements visible in retained artifacts.

Missing fixtures and unreadable catalogs fail explicitly. No tool is executed
without its fixture. Reports under `.tmp/action-conformance/` contain app/action
names and failed check identifiers, never action arguments or returned content.
CI retains these reports on failing runs. Onboarded runtime findings are written
before assertion, alongside schema findings. Template source changes select the
inventory even when dynamic registry imports are invisible to `vitest --changed`.

Run the inventory audit and strict checks for the reviewed onboarding set:

```sh
pnpm --filter @agent-native/core exec vitest run src/action-conformance-inventory.spec.ts
```

Navigation and editor saves can register a deferred flush with
`registerBeforeAgentTurnFlush` from `@agent-native/core/client/navigation`.
Unregister it on unmount. The route-state hook registers its debounced navigation
write automatically; AgentKit waits for these callbacks and outstanding state
writes before sending a turn. A failed immediate or deferred navigation flush rejects submission and can be
retried on the next turn. A stalled save rejects submission after 25 seconds. This does not
save app-owned editor drafts unless their save callback is registered.

Settled failures gate `navigation`, `__url__`, `pending-selection-context`, and
`selection`. Per-tab storage alone does not make settings or inbound commands
required context. For custom app state
that the agent must read before a turn, register its keys with
`registerBeforeAgentTurnStateKeys(["editor-context"])` from the same navigation
entry point while its view is mounted, and register a flush callback to retry or
save that state. Unregister both on unmount or scope change. Flush registrations
capture the same context; reset view-owned state and register again for a new
app, tab or authenticated session. Old-context callbacks never run for the new
context. Required-key registrations are
reference counted and scoped to the mounted app, browser tab and authenticated
session. An unrelated, unregistered key's settled failure does not block future
turns; in-flight writes are still awaited. Failed writes are not automatically
replayed, so a stale delete or compare-and-set cannot overwrite newer intent.
