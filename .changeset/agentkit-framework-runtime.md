---
"@agent-native/agentkit-adapters": minor
"@agent-native/agentkit": minor
"@agent-native/agentkit-client": minor
"@agent-native/agentkit-conformance": minor
"@agent-native/agentkit-protocol": minor
"@agent-native/agentkit-react": minor
"@agent-native/core": patch
"@agent-native/toolkit": minor
---

Introduce AgentKit as six focused public packages with a
versioned, provider-neutral protocol; validated messages, runs, capabilities,
approvals, activities, smart objects, uploads, actions, participants, tasks,
custom content, and durable thread snapshots; and typed compatibility,
cancellation, and error semantics. Add the headless client, resumable HTTP and
SSE adapters, executable transport conformance, and composable React provider,
hooks, slots, registries, semantic UI, safe streamed Markdown, run recovery,
host-aware copy confirmation, capability-gated feedback and forking with
visible mutation state, and durable queued-message promotion.
Add typed, replay-safe contextual connection requests with host-controlled
setup, retry, decline, and resumable-run handling.
Choice prompts now offer a focused custom response by default, preserve that
answer separately from predefined option ids across transports, and let hosts
disable the affordance for deliberately constrained workflows.
Completed activity groups now collapse to a duration-aware “Worked for…” row
while preserving their expandable action history.
Execution segments now settle at the first visible assistant output rather than
the terminal run event, so response streaming time is not counted as working
time and hidden reasoning does not prematurely end the work phase.
Active execution segments now expose a duration-aware “Working for…” spine and
cluster consecutive equivalent default tool activity without discarding trace
detail or overriding host renderers.
The entire chat frame now owns transcript scrolling while the inner transcript
retains its constrained reading measure, so wheel input works from either gutter.
Activity traces now share a protocol-level semantic taxonomy, render distinct
icons for searches, reads, edits, commands, checks, MCP calls, connections,
navigation, delegation, and approvals, and give the run-level work spine its own
identity instead of presenting every operation as a generic tool.
Run startup now becomes active before the first streamed event arrives, keeping
rapid follow-ups in the durable queue instead of launching overlapping runs.
Transcript following ignores queue-only state churn, follows queue-driven
viewport resizing, distinguishes programmatic scrolls from deliberate history
navigation, and avoids redundant scroll writes during sustained streamed
output.
Chat shells can now preserve accepted AgentKit runs across thread navigation,
observe typed per-thread lifecycle state in surrounding chrome, show background
activity in rails, and surface a newly submitted conversation before durable
history catches up.
Host chrome now distinguishes active execution from the pre-response working
phase, so progress indicators settle when visible assistant output begins while
queueing and cancellation remain active through the terminal event.
Core and AgentKit now share one animation-frame-paced streaming primitive with
adaptive backlog draining, incremental grapheme segmentation, reduced-motion
support, background-tab catch-up, and stable memoized Markdown blocks, avoiding
chunk dumps and whole-response reparsing during long answers.
