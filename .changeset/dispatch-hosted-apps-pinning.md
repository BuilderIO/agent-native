---
"@agent-native/core": minor
"@agent-native/toolkit": minor
"@agent-native/dispatch": minor
---

Let organizations hide Agent-Native.com hosted apps in Dispatch, group Dispatch's app pages into Pinned apps, Apps, and Agent-Native.com hosted apps, and keep the sidebar to pinned apps.

- Organization owners and admins get a "Show Agent-Native.com hosted apps" switch under Settings › Organization › Apps, backed by the new `get-hosted-apps-settings` and `set-hosted-apps-settings` actions (recorded in Dispatch's audit log, on by default). When it is off, Agent-Native.com hosted apps leave Dispatch's app lists, `list_apps`, and the Dispatch agent's app context; `list-connected-agents` still returns them marked `hiddenFromLaunchers`, and `call-agent` by name still reaches them. An unreadable stored value hides Agent-Native.com hosted apps and Settings offers to repair it.
- Core adds `registerAgentContextAgentFilter` and `discoverAgentContextAgents` so an app can narrow the peers its own agent is shown (`<available-apps>`, relevant apps, @-mention Connected Agents, `describe-workspace-apps`) without changing `discoverAgents` routing.
- Home, New chat, and All apps show Pinned apps, Apps, and Agent-Native.com hosted apps sections. The sidebar shows pinned apps, or until something is pinned, three suggested apps, above an All apps link. Every app row has a visible pin button, and pins stay in sync across surfaces. The toolkit apps rail accepts optional `sections` and `onTogglePinned` (pin changes go to the host instead of a whole layout); without them it renders as before.
