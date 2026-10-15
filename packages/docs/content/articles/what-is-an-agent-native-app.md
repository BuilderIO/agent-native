---
slug: what-is-an-agent-native-app
topic: agentic-apps
apps: []
job_id: job-agentic-apps
title: "What is an agent-native app?"
meta_description: "An agent-native app pairs an AI agent with a real UI, and both use the same actions. What that means, when it's the right fit, and when it isn't."
audience: technical
published: 2026-10-15
author: "Agent-Native Team"
app_cta_url: "https://www.agent-native.com/docs/what-is-agent-native/"
cta_label: "Read the docs"
cta_band_heading: "Start from a template"
cta_band_subhead: "Every Agent-Native app is an open-source agent with a UI you can build on."
related_resources:
  - label: "What is Agent-Native?"
    url: "https://www.agent-native.com/docs/what-is-agent-native/"
  - label: "Templates"
    url: "https://www.agent-native.com/docs/cloneable-saas/"
  - label: "External Agents"
    url: "https://www.agent-native.com/docs/external-agents/"
related:
  - can-people-and-an-ai-agent-edit-the-same-document
internal:
  target_terms: "agentic ai framework (US 600/mo, KD 0); ai agent framework (700, KD 33); agentic ui (250); agentic app (150)"
  basis: "Search Console: 'what does it mean for a product to be agent-native?', 'who is agent-native for?', 'what can i build with agent-native?'"
  sources: "/docs/what-is-agent-native/, /docs/external-agents/, /docs/real-time-collaboration/, docs navigation (templates list)"
---

An agent-native app is an app where an AI agent and a regular user interface work on the same data, through the same actions. Agent-Native is an open-source TypeScript framework for building them. The agent does real work, and people use the interface to inspect, edit, approve, or share what it did.

## How is it different from a chatbot?

A chatbot hands you text. In an agent-native app, the agent's work lands in the app itself, as a slide, a plan, a dashboard, or a document. The agent doesn't click through the UI to get there. The agent and the UI call the same actions, so anything the agent does, you can see and change in the interface.

## When is an agent-native app the right fit?

| Your situation | Better fit |
| --- | --- |
| The agent does real work, and people need to inspect, edit, approve, or share it | An agent-native app |
| You need a single generated response | Call a model directly |
| The work follows a fixed, predictable sequence | Ordinary application logic or automation |

## What can you start from?

Agent-Native has templates, which are complete open-source agents with a UI. They include Clips, Plans, Design, Slides, Mail, Analytics, Calendar, Content, Forms, Assets, Dispatch, and Chat.

## Can you use it with the agents you already use?

Yes. Every Agent-Native app exposes an MCP URL. Claude, Claude Code, Codex, ChatGPT, and Cursor can connect to it, and connected agents get the app's real actions, the same ones its in-app agent uses. ChatGPT custom MCP apps require a supported ChatGPT web workspace.

<!-- try-it -->

## Frequently asked questions

### What is Agent-Native?

Agent-Native is an open-source TypeScript framework for building autonomous agents with intuitive UIs.

### Does the agent click buttons in the UI?

No. The agent and the UI call the same actions.

### When shouldn't I build an agent-native app?

When you only need a single generated response, call a model directly. When the work follows a fixed, predictable sequence, ordinary application logic or automation is simpler.

### Can I connect Claude or ChatGPT to an Agent-Native app?

Yes. Every app exposes an MCP URL that Claude, Claude Code, Codex, ChatGPT, and Cursor can connect to. ChatGPT custom MCP apps require a supported ChatGPT web workspace.

### Can people and the agent edit at the same time?

Yes. Agent-Native supports real-time collaborative editing, with the agent as a peer editor.
