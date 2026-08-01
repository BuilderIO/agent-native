# ADR 0002 — The local Cloudflare Workers runtime counts as hosted

- Status: accepted
- Date: 2026-08-01

## Context

`isHostedRuntimeForDurableBackground()` decides whether an agent-chat turn may
be handed to a durable background worker. It carves out the local Netlify
emulator explicitly: `NETLIFY_LOCAL=true` returns `false`, so `netlify dev`
keeps the inline streaming loop.

Adding Cloudflare Workers to that predicate raises the obvious question: should
`wrangler dev` get the same carve-out its Netlify counterpart gets? The
symmetry is tempting, and a future maintainer looking only at the two lines
side by side will read the absence of a Workers carve-out as an oversight.

## Decision

The Cloudflare Workers runtime counts as hosted, in local development as well
as in a deployed Worker. There is no local carve-out. A developer who wants the
inline streaming loop sets `AGENT_CHAT_DURABLE_BACKGROUND=false`.

## Why the Netlify reasoning does not transfer

The Netlify carve-out is not a preference about local ergonomics. It is a
statement of fact about what is running: `netlify dev` serves the app from a
Node.js process. There is no Lambda, no 15-minute background function, and none
of the constraints the hosted regime exists to accommodate. Treating it as
hosted would have the framework dispatch to a second function that does not
exist, and clamp a run to a wall that is not there.

`wrangler dev` is a different kind of thing. It runs `workerd` — the same
runtime binary that serves a deployed Worker — with the same isolate model, the
same request/queue invocation shapes, the same absence of a Node process, and
the same budget constraints. Declaring it "not hosted" would mean developing
against a code path that no deploy ever executes, which is the failure mode the
hosted/local split is meant to prevent, pointed the other way.

The two runtimes also disagree on the property that actually matters here. A
Netlify function invocation gets its own isolate, so an isolate-level marker is
a sound proof that this worker holds the long budget. A Worker isolate serves
concurrent fetch and queue invocations, so no isolate-wide fact can prove
anything about a single invocation. That difference exists identically in
`wrangler dev` and in production, and it is precisely the difference a local
carve-out would hide: bugs in the per-invocation scoping would be invisible
locally and only appear under production concurrency.

## Consequences

- `isHostedRuntimeForDurableBackground()` returns `true` whenever
  `isCloudflareRuntime()` (`packages/core/src/shared/runtime.ts`, the same
  predicate the database layer relies on) is true. It is checked before the
  Netlify env-var legs, because it is a runtime fact rather than an env-var
  reading.
- The durable gate is default-on for Workers, matching Netlify's shape, with
  `AGENT_CHAT_DURABLE_BACKGROUND=false` as the explicit opt-out that restores
  the inline streaming loop.
- Long-budget proof on Workers comes only from the per-invocation async-context
  scope (`runInBackgroundInvocationScope`). Every isolate-wide signal — the
  `globalThis` marker, the `AWS_LAMBDA_FUNCTION_NAME` suffix, and the
  `AGENT_CHAT_FORCE_BACKGROUND_RUNTIME` escape hatch — is ignored on this
  runtime, because none of them can say anything about a single invocation when
  the isolate serves several. The isolate-level marker is unchanged for Netlify,
  the host it was written for.
- Cloudflare Pages Functions inherit this, because `isCloudflareRuntime()`
  cannot tell them apart from a Worker and there is nothing to tell apart: it is
  the same runtime with the same isolate model, so the same reasoning holds.
  Pages is otherwise out of scope for the Cloudflare adapter work, and this is
  the one place it is touched.
- Until a queue transport is bound, an enabled gate on Workers resolves to the
  in-process route and reports that once per isolate. A developer running
  `wrangler dev` sees the same message a deploy would, which is the point.
