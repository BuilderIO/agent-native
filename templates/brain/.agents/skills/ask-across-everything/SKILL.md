---
name: ask-across-everything
description: >-
  Use when a Brain question asks across company memory plus live/app-owned data
  such as metrics, email threads, workspace grants, or secrets.
---

# Ask Across Everything

## Rule

Search Brain first, inspect `federatedCoverage`, then delegate live app-owned
questions to the owning specialist agent with `call-agent`.

## Why

Brain owns cited company memory: reviewed knowledge, accessible raw captures,
and source records. It does not directly search Analytics, Mail/Gmail,
Dispatch, or sibling app databases. `federatedCoverage` is deterministic routing
metadata, not retrieved evidence.

## Workflow

1. Call `search-everything` for broad questions, or use `ask-brain` when the
   user asks a direct cited-memory question and wants an answer immediately.
2. Read the Brain results and `federatedCoverage.scopeNote`.
3. Inspect `federatedCoverage.delegationHints` and
   `federatedCoverage.discoveredAgents.agents`. `delegationHints[].target` is
   typed to exactly three values today: `"analytics"`, `"mail"`, `"dispatch"`
   (`FederatedDelegationTarget` in `server/lib/search.ts`) — there is no
   delegation hint for other templates yet, even if one is installed in the
   workspace. Each hint also carries `matchedSignals` (which words in the
   question triggered it) and a human-readable `reason`.
4. If the user asked for live/app-owned data and a hint matches the request,
   call the specialist app agent with `call-agent`. Keep the prompt narrow and
   include the user question plus any Brain context needed for names, dates, or
   citations.
5. Synthesize the final answer with clear source boundaries:
   - Brain knowledge/captures are cited company memory.
   - Specialist agent results are app-owned live data or app-native search.
   - Coverage metadata only explains where you routed next.
6. If no specialist agent is available, say Brain found a delegation hint but
   you could not query that app in this workspace.

## Routing Examples

- Product decision, policy, process, or "why did we decide..." -> Brain only.
  Search Brain, open `get-knowledge` / `get-capture` as needed, cite evidence.
- Dashboard metric, KPI, funnel, cohort, revenue, or chart -> Brain +
  Analytics. Use Brain for context, then `call-agent` Analytics for live
  dashboard/data-source facts.
- Email, customer thread, sender/recipient, Gmail, inbox, or mailbox state ->
  Brain + Mail/Gmail. Use Brain for durable context, then `call-agent`
  Mail/Gmail for mailbox-native search.
- Integration grants, reusable connections, secrets, approvals, recurring jobs,
  workspace resources, or cross-app routing -> Brain + Dispatch. Use Brain for
  documented decisions, then `call-agent` Dispatch for current control-plane
  state.

## Don't

- Do not claim Brain searched sibling app databases directly.
- Do not treat `federatedCoverage.delegationHints` as answer evidence.
- Do not invent live metrics, mailbox state, grants, or secrets from Brain
  memory.
- Do not put A2A calls inside Brain actions; cross-app delegation happens in the
  agent loop.

## Related Skills

- `brain`
- `delegate-to-agent`
- `a2a-protocol`
- `security`
