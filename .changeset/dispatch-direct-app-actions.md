---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Dispatch can now run a granted workspace app's actions directly. Set `dispatch.directAppActions` (env `DISPATCH_DIRECT_APP_ACTIONS=true`) to add `list_app_actions`, `call_app_action`, and `read_view` to Dispatch's agent and MCP tools; they call the target app as the signed-in user, only for apps that user has granted, and return in about a second instead of running the app's agent through `ask_app`. The setting is off by default, and with it off Dispatch's tools and `ask_app` are unchanged.

Dispatch app discovery now honors the workspace's `deployment.workspace.appsDirectory` and `appInclude` settings, and shows the `icon` set for an app in the deployment manifest or in `.agent-native/workspace-apps.json`. Apps listed without a description no longer break MCP task discovery.
