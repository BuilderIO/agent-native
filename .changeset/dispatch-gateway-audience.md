---
"@agent-native/dispatch": patch
---

Address Dispatch's workspace apps gateway token to the gateway's Dispatch mount (`/dispatch`) when the gateway is a bare origin and Dispatch has no base path of its own. A root-mounted Dispatch reading another deployment's workspace gateway addressed its token to the bare origin, so the workspace's Dispatch refused it for audience and the page showed "Couldn't load data" (`workspace_gateway_rejected`).
