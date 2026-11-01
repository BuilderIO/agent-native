---
"@agent-native/core": minor
"@agent-native/toolkit": minor
---

The share popover is one panel: an invite field for people, groups and org agents, one "People with access" list, general access ("Only people invited", "Anyone at <org>", "Anyone with the link"), and a footer with Copy link and a Send to menu. Roles read "Can view", "Can comment", "Can edit" and "Can manage access", and Remove access moved into each row's role menu.

Org service principals can now be shared with like people: `list-resource-shares` returns `agents` for owners and admins in the resource's org, marks agent rows with `agent: true`, and resolves people's profile names into `displayName` and `ownerDisplayName`. Resources locked to their org accept live agents of that org, and agents are never emailed.

Breaking for `ShareButton`: `agentTabContent`, `peopleTabLabel`, `agentsTabLabel` and the `secondaryShareUrl*` props are removed. Pass a `sendTo` prop (`openInAgent`, `items`, `copyAgentPrompt`, `openMcpSettings`) instead. `shareUrlPlacement` and `shareUrlDescription` no longer affect rendering.

`writeClipboardText` keeps its fallback copy inside the open dialog or menu, so copying from a popover no longer closes it when the async clipboard is unavailable.

`registerShareableResource` accepts `agentRead: { actions, idParam? }` naming the MCP tool that reads one resource. `list-resource-shares` returns it, and the share panel then offers Open in Claude, Open in Claude Code, Open in Codex and Copy agent prompt with a prompt that sends the agent to the app's MCP server. Analytics, Assets, Brain, Design, Forms, Plan, Slides and Slides 2 declare it.
