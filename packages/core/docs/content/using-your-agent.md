---
title: "Using Your Agent"
description: "The day-to-day loop of working with the agent: it sees what you're looking at, you direct it, embed it, go UI-light, and co-edit alongside it."
---

# Using Your Agent

The defining idea behind agent-native is that the agent and the UI are **equal partners** — see [What Is Agent-Native?](/docs/what-is-agent-native) for the why. This section is about the other half of that promise: what it feels like to actually work with the agent once it's docked next to your app.

There's a simple through-line. The agent **sees** what you're looking at, you **direct** it toward what you want, you can **embed** it anywhere, you can go fully **UI-light** when that's the better fit, and you can **co-edit** the same documents at the same time. Each of those is a page in this section.

## It sees what you're looking at {#it-sees}

The agent isn't blind to your screen. Open an email and it knows which thread. Select a chart and it knows which chart. Highlight a paragraph and it can act on just that range. That shared awareness is what lets you say "reply to this" or "summarize the selection" without spelling out the context every time.

This works because the current navigation and selection live in `application_state` SQL, which the agent reads as part of its context. The agent can also drive that same state back — opening a view, selecting a row — so you watch it work in the real UI rather than in a transcript.

→ [**Context Awareness**](/docs/context-awareness) — navigation state, view-screen, navigate commands, and how the agent stays in sync with your screen.

## You direct it {#you-direct-it}

Most of the time you steer the agent by typing into the chat. Two things make that faster.

**Mentions.** Tag a custom agent, a connected agent, or a file with `@` to pull it into the conversation — "let `@analytics` pull last week's numbers, then draft the summary." Mentions are how you reach the right specialist or attach the right context without leaving the composer.

**Voice.** The composer has a microphone. Dictate a request instead of typing it, with provider options ranging from Builder's hosted transcription to bring-your-own-key to a browser fallback.

→ [**Agent Mentions**](/docs/agent-mentions) — `@`-mention custom agents, connected agents, and files in chat.
→ [**Voice Input**](/docs/voice-input) — dictation in the chat composer and how transcription is routed.

## You embed it {#you-embed-it}

The agent isn't a separate app you tab over to. It ships as a handful of React components — a sidebar, a raw panel, and a `sendToAgentChat()` call — that you drop into any app. Render `<AgentSidebar>` to give every screen a toggleable agent, or wire a button to hand a specific task off to the chat instead of running a one-shot LLM call.

→ [**Drop-in Agent**](/docs/drop-in-agent) — mount `<AgentPanel>`, `<AgentSidebar>`, and `sendToAgentChat()` into any React app.

## You can go UI-light {#ui-light}

Not every app needs a full dashboard. When the agent _is_ the product, you can skip most of the custom UI: open the app, ask for what you want, and let the agent do the rest. The agent still has its management surface — history, workspace, settings — but the primary interaction is conversation rather than clicks.

→ [**Pure-Agent Apps**](/docs/pure-agent-apps) — apps where the agent is the whole product.

## You co-edit with it {#you-co-edit}

When you and the agent are working on the same document, you don't take turns. With real-time collaboration, the agent's edits stream in alongside yours — live cursors, no overwrites — the same way a teammate's would. You can keep typing while it works, and it sees your changes as they happen.

→ [**Real-Time Collaboration**](/docs/real-time-collaboration) — multi-user collaborative editing with live cursors and agent edits in the same document.

## What's next {#whats-next}

- [**Context Awareness**](/docs/context-awareness) — the agent knows what you're looking at
- [**Agent Mentions**](/docs/agent-mentions) — direct it with `@`-mentions
- [**Voice Input**](/docs/voice-input) — direct it by speaking
- [**Drop-in Agent**](/docs/drop-in-agent) — embed it in any React app
- [**Pure-Agent Apps**](/docs/pure-agent-apps) — go UI-light when the agent is the product
- [**Real-Time Collaboration**](/docs/real-time-collaboration) — co-edit the same document together
