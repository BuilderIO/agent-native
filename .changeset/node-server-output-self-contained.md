---
"@agent-native/core": patch
---

Make `node-server` build output run on its own. Nitro leaves React external on Node presets, so a `.output/` folder copied into a container or onto a server without the app's `node_modules` answered API requests but failed every server-rendered page with "Cannot find module 'react'". The build now copies those packages, and resvg for OG images, into `.output/server/node_modules`, as it already did for Netlify, Vercel and AWS.
