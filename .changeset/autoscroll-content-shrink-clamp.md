---
"@agent-native/core": patch
---

Fix agent chat intermittently scrolling to the top when sending a prompt in an ongoing conversation. When the message list briefly shrank on a re-render (content swap, collapsing streaming/reconnect placeholder, message list remount), the browser-forced `scrollTop` clamp was misread as the user scrolling up, detaching auto-follow and stranding the conversation scrolled up — sometimes at the very top. The near-bottom autoscroll handler now ignores downward scroll jumps caused by content shrinking, so it stays anchored to the bottom; genuine user scroll-ups still detach.
