---
"@agent-native/core": minor
---

Image uploads and drag-and-drop, framework-wide.

- New `upload-image` agent action — converts a base64 data URL or remote URL into a hosted CDN URL via the active file-upload provider (Builder.io by default). Auto-registered for every template alongside the sharing actions; the agent now has an explicit tool to materialize chat-attached or generated images as stable URLs for slides, documents, and outbound messages.
- Server-side pre-upload of chat image attachments: when a user attaches an image to the agent composer, the framework now uploads it through `uploadFile()` before the model runs and injects a `<chat-image-attachment url="..." />` block at the bottom of the user message. The model still receives the image as multimodal vision content; it just also has the hosted URL to embed in HTML. If no upload provider is configured, the framework injects a `<chat-image-attachment-upload-error>` block instructing the agent to recommend connecting Builder.io.
- Chat-wide drag-and-drop: the agent sidebar now accepts file drops anywhere on the chat surface (thread, header, composer), not just inside the contenteditable. A "Drop to attach" affordance highlights the chat while files are being dragged over it.
- Slides drag-and-drop fixes: `/api/assets/upload` now routes through the framework `uploadFile()` provider chain (works on Netlify/Vercel/Cloudflare instead of writing to a non-persistent local disk). Drops anywhere on the slides editor — including the chrome and sidebars — are caught instead of letting the browser navigate to the file; drops outside a placeholder/`<img>` open a popover that hands the image off to the agent chat for the user to describe what to do with it.
