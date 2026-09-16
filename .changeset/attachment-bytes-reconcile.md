---
"@agent-native/core": patch
---

Verify an attachment's bytes against its declared media type before building a
provider image or document block. A browser labels a file from its extension,
so a screenshot saved as `.jpg` holding PNG bytes, an SVG exported as `.png`, a
cut-short upload, or a DOCX named `.pdf` are all ordinary user files — and each
one made the gateway reject the entire request with `code: invalid_request` and
an opaque error ID, killing every sibling attachment and the user's prompt with
it. An image whose bytes are a different supported format is now relabelled so
it works, and an attachment that decodes to nothing usable degrades to a text
note naming the real problem instead of ending the turn.

Validation asks each file about itself rather than trusting a magic number:
base64 must be canonical (a spliced space or a line break decodes fine in
Node but is rejected by the provider), a PNG must carry its IHDR chunk, and
JPEG, WebP, GIF, PNG, and PDF payloads must reach their own declared end.
