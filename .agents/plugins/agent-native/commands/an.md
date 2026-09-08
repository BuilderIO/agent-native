---
description: Open and operate a granted Agent-Native app through Dispatch MCP.
argument-hint: <app> [request]
---

Use the an skill. Treat the first argument as the Agent-Native Dispatch app id.
For `/an slides`, call `open_app` with app `slides`, path "/", embed
true, and chrome `full`. Keep the returned link if the host cannot render
the inline MCP App. Any remaining arguments are the user's request after the
app opens:

$ARGUMENTS
