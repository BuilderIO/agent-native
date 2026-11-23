---
"@agent-native/core": patch
---

PowerPoint import now keeps a picture's alt text. `parsePptxPresentation` reads the description PowerPoint stores on each picture (`<p:cNvPr descr="…">`) into a new optional `altText` on the parsed image, on both the slide's `images` and the image element. Pictures with no description, or a blank one, have no `altText`.
