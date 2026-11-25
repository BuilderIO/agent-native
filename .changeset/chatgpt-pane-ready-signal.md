---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

An app pane in ChatGPT now tells the host it is ready as soon as ChatGPT's bridge is read, instead of after a five second wait for the host handshake, so the pane stays open. The open-app tool description now asks the model to open the pane for show, open, draft, chart, calendar, and dashboard requests.
