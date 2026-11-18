---
"@agent-native/core": patch
---

Organization MCP server URLs are masked for members who are not owners or admins: they see the origin and path, with userinfo, the query and key-shaped path segments hidden, so a key embedded in a URL is no longer shown to every member. Owners and admins, and a person's own servers, still see the full URL.
