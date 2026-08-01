# ADR 0003 — Cloudflare Queues carries the durable background run

- Status: accepted
- Date: 2026-08-01

## Context

On Netlify a long agent-chat turn is handed to a background function: the
foreground POST returns immediately, the function gets a ~15-minute budget, and
the client streams the same run through the cross-isolate SQL-poll path. The
mechanism is an HTTP POST to a url that carries its own budget.

Cloudflare Workers has no such url. Something else has to carry a run that
outlives the request that created it, and the choice is hard to reverse: it
decides what the build emits into the generated Worker configuration, what the
generated entry exports, and how the framework proves an invocation may take
the long budget. A future maintainer who does not know why the alternatives
fail will "simplify" this back into one that cannot work.

## Decision

A durable background run is handed to a **Cloudflare Queue**. The build emits
the producer binding, the consumer registration, and a raised CPU limit into the
generated Worker configuration; the generated Worker entry exports the consumer
alongside the request handler. Per message the consumer enters the
per-invocation background scope, synthesises a POST to the existing processor
route carrying the signed internal token, and delegates to the same handler that
serves fetch — structurally the move the Netlify wrapper makes when it rewrites
an incoming pathname.

## Why, against the documented limits

Cloudflare publishes a wall-time limit per invocation type
(`developers.cloudflare.com/workers/platform/limits/`):

| Invocation type          | Wall time  |
| ------------------------ | ---------- |
| Incoming HTTP request    | Unlimited **while the client stays connected** |
| `waitUntil()` after the response | 30 seconds |
| Queue consumer           | 15 minutes |
| Cron Trigger             | 15 minutes |
| Durable Object alarm     | 15 minutes |

**The post-response continuation API (`ctx.waitUntil`) is disqualified.** It is
the closest thing to the Netlify background function in shape — fire work, let
the response return — and it caps at 30 seconds after the response or the
disconnect. A long turn is minutes, not seconds. Its resemblance to the thing
that works is exactly what makes it dangerous: the code would look right, run
short turns correctly, and truncate real ones.

**A request-triggered invocation is disqualified.** Its budget is unbounded only
while a client remains connected, and the entire premise of this path is that
the foreground returns immediately so the client can stream over SQL polling
instead. The condition under which it has no limit is the one condition this
feature guarantees is false.

**Durable Object alarms and cron triggers are rejected, not disqualified.** Both
offer the same 15-minute budget. An alarm requires adopting a storage class the
framework does not otherwise use and does not need — the run row already lives
in SQL. A cron trigger is not request-shaped: it polls for work on a schedule
rather than being handed a specific run, which adds latency to every turn and a
second scheduling concern for no gain.

**Queues additionally brings what this path needs anyway**: retries, a
dead-letter queue, and consumer concurrency control, all declared in the same
configuration the build already patches.

The consumer's 15-minute budget **exceeds** the framework's existing background
soft-timeout ceiling, so that ceiling is unchanged. This work does not touch the
foreground soft-timeout regime or the circuit breaker's recovery logic.

## Consequences

- **The message is small by construction.** Cloudflare caps a queue message at
  128 KB (256 KB per batch). The normal path already sends only a marker,
  because the run row carries the payload. The inline-body fallback — used only
  when the run row insert failed — refuses an oversized payload and degrades to
  an inline run. It never truncates: a truncated payload runs a *different* turn
  than the one asked for and looks like a completed one.
- **The CPU ceiling is raised to 300,000 ms.** That is the documented Workers
  Paid maximum against a 30,000 ms default. Waiting on model I/O is not CPU
  time, but a 15-minute turn's own work accumulates past 30 seconds.
- **A failed send and an unclaimed run are different conditions.** A send that
  fails is known and handled: the run degrades to an inline turn, and the
  existing circuit breaker is unchanged. A send the queue *accepted* that no
  consumer ever claims is an undiagnosable deploy defect — the producer works,
  so nothing else surfaces it, and the circuit breaker's inline recovery makes
  it look healthy. That one is reported once per isolate. Collapsing the two
  into one branch would re-create the silent lost-budget failure this whole path
  exists to end.
- **The long-budget signal is per-invocation.** One Worker isolate serves
  concurrent fetch and queue invocations, so no isolate-wide marker can prove
  *this* invocation holds the budget — see ADR 0002 and the async-context scope
  the consumer enters.
- **A key-value binding is deliberately not emitted.** Nothing in the framework
  reads one; shipping the configuration would be dead weight that invites
  contract violations.
