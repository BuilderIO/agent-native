---
title: "Durable Background Runs"
description: "Long agent-chat turns can run on a separate 15-minute Netlify background function instead of the synchronous request, so multi-step work finishes server-side without the client babysitting continuations. Opt-in per app; a foreground circuit-breaker keeps chat working even if the worker never starts."
---

# Durable Background Runs

> **Who is this for:** anyone deploying an agent-native app who wants long,
> multi-step agent turns to complete server-side, and anyone wondering what the
> `AGENT_CHAT_DURABLE_BACKGROUND` flag and the second Netlify function do. This
> is opt-in and entirely inside the framework — there is no app code to write.

A normal hosted agent turn runs inside the synchronous request function, which
is capped by the platform's request timeout (~10s on Netlify's free tier, and
the framework's ~40s soft-timeout before it has to hand back to the client and
"continue from where you left off"). That is fine for quick answers, but a long
agentic turn — many tool calls, large analyses — ends up bouncing through
several client-driven continuations.

Durable background runs move that long turn onto a **separate Netlify
background function** with a **15-minute** budget. The turn runs to completion
server-side in one invocation; the UI just streams the result.

## Two functions, not one {#two-functions}

A deployed app has exactly two server functions, and almost every request hits
the first one. Only the dispatched agent turn runs on the second.

```an-diagram title="server handles everything; only the dispatched agent turn runs on the background function" summary="The synchronous server function serves pages, actions, API, and the foreground chat POST; it HMAC-dispatches the long turn to the background function, which has the 15-minute budget."
{
  "html": "<div class=\"diagram-bg-runs\"><div class=\"diagram-panel\" data-rough><div class=\"diagram-pill\">server &middot; synchronous</div><div class=\"diagram-box\">Pages / SSR</div><div class=\"diagram-box\">Actions</div><div class=\"diagram-box\">API + framework routes</div><div class=\"diagram-box\">Foreground chat POST <small class=\"diagram-muted\">decides + dispatches</small></div><small class=\"diagram-muted\">~10s timeout &middot; nearly every request</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;<br><small>HMAC 202</small></div><div class=\"diagram-panel\" data-rough><div class=\"diagram-pill accent\">server-agent-background &middot; background:true</div><div class=\"diagram-box\">_process-run worker</div><div class=\"diagram-box\">Agent turn: LLM + tool calls</div><small class=\"diagram-ok\">15-min budget &middot; only the dispatched turn</small></div></div>",
  "css": ".diagram-bg-runs{display:flex;align-items:stretch;gap:14px;flex-wrap:wrap}.diagram-bg-runs .diagram-panel{display:flex;flex-direction:column;gap:8px;padding:14px;flex:1;min-width:230px}.diagram-bg-runs .diagram-box{padding:8px 10px}.diagram-bg-runs .diagram-arrow{display:flex;flex-direction:column;justify-content:center;text-align:center;min-width:90px;font-size:20px}"
}
```

There is **nothing to flag in app or template code.** Netlify treats a function
as a background function when its `export const config` has `background: true`
(or its name ends `-background`). The framework's build step emits the
`server-agent-background` wrapper automatically when the feature is enabled —
app authors never declare it.

## What runs in the background, and how it's chosen {#what-runs}

Only the long agent-chat turn — the internal `_process-run` dispatch that
re-enters the agent loop (LLM calls + tool execution). Pages, actions, and
normal API calls always run synchronously on `server`.

The foreground chat POST decides **per turn**. It dispatches to the background
function only when all three hold:

- `AGENT_CHAT_DURABLE_BACKGROUND` is truthy (`true` / `1` / `yes` / `on`),
- the app is running hosted (on the platform, not local dev), and
- `A2A_SECRET` is set (the dispatch is an HMAC-signed self-call; without the
  secret it cannot be signed, so the turn stays inline).

If any is missing, the turn runs inline exactly as before. The flag is read at
**both build time** (to decide whether to emit the background function) and
**runtime** (to decide whether to dispatch), so enabling it requires a redeploy.

## The lifecycle and the circuit-breaker {#lifecycle}

A Netlify async function returns `202` the instant it **enqueues** the
invocation — that is not proof the worker executed. So the foreground does not
blindly trust the `202`: after dispatching it briefly polls for the worker to
actually **claim** the run, and recovers inline if it doesn't.

```an-diagram title="The foreground always returns a working turn" summary="On dispatch the foreground waits a grace window for the worker to claim the run; if it claims, the foreground subscribes to it; if not, the foreground claims and runs the turn inline."
{
  "html": "<div class=\"diagram-bg-life\"><div class=\"diagram-box\" data-rough>Foreground POST</div><div class=\"diagram-arrow diagram-muted\">&rarr;</div><div class=\"diagram-box\" data-rough>Insert run + HMAC dispatch &rarr; 202</div><div class=\"diagram-arrow diagram-muted\">&rarr;</div><div class=\"diagram-panel center\" data-rough><strong>Worker claims within the grace?</strong><small class=\"diagram-ok\">yes &rarr; stream the background worker (up to 15 min)</small><small class=\"diagram-warn\">no &rarr; circuit-breaker recovers the turn inline</small></div></div>",
  "css": ".diagram-bg-life{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-bg-life .diagram-arrow{font-size:20px}.diagram-bg-life .center{display:flex;flex-direction:column;gap:4px;padding:12px}"
}
```

The claim is observed via `dispatch_mode` flipping from `background` to
`background-processing` (only the worker's atomic claim does that). The grace
window must cover the worker's cold-start; heavy apps were observed needing
longer than the original 8s, so it is **15s** (still well within the
foreground's ~40s soft-timeout). A worker that never claims — dead, or just
slow to start — falls back to inline after the grace, so the turn still
completes; the cost is the added latency of waiting out the grace first.

```an-callout
{
  "tone": "success",
  "body": "The foreground returns a working turn either way: the background worker when it claims in time, an inline turn otherwise. So durable runs should preserve chat correctness even when a worker fails — but a misconfigured or slow-to-claim worker can add fallback latency (up to the grace window) before the inline recovery takes over."
}
```

## Cost and tradeoffs {#cost}

Netlify background functions are a **paid-plan** feature (Personal / Pro, not
the free tier) and are billed by compute time (GB-hour). A multi-minute agent
turn therefore costs more compute than a short synchronous call — but it largely
**replaces** the old pattern, where the turn hit the ~40s wall and the client
re-issued several continuation requests. It is the same work consolidated into
one long invocation, not purely additive.

```an-callout
{
  "tone": "info",
  "body": "Durable runs are opt-in per app and default OFF. Enable with AGENT_CHAT_DURABLE_BACKGROUND=true (plus A2A_SECRET) and redeploy. Verify a turn actually used the worker by checking that its run reaches dispatch_mode=background-processing rather than falling back to inline recovery."
}
```

## Related

- [**Durable Resume**](/docs/durable-resume) — how an interrupted run resumes
  without repeating completed side effects (a separate, always-on protection).
- [**Deployment**](/docs/deployment) — how the app and its functions are built
  and deployed to the platform.
- [**A2A Protocol**](/docs/a2a-protocol) — `A2A_SECRET` and the HMAC-signed
  self-dispatch the durable worker reuses.
