---
"@agent-native/core": minor
"@agent-native/toolkit": minor
---

One way to show a comment, in every app:

- New `CommentBody` from `@agent-native/toolkit/app/review` draws a comment's Markdown: paragraphs, bold, italic, strikethrough, code, links, lists, quotes, code blocks and mention chips, with headings as bold lines. Raw HTML shows as written, so a note like `use <Button> here` keeps its tag; HTML comments stay hidden. Mentions come from a `mentions` list (`@label`, whole words only, or pinned with `at`) or from `@[Name](mailto:…)` text. A label two listed people share stays text, rather than name one of them for both. `renderMention` draws a mention an app's own way; returning nothing keeps the kit's chip. `compact` flattens it to one run of text for previews, with links shown as text and chips in the line's size and color, so they read on a dark card. Past 20,000 characters, or from a paragraph nested or tangled far past what people write (brackets, quotes or list markers more than 16 deep, more than 1,000 emphasis markers in one paragraph, or brackets the parser would spend long looking back for), the rest shows as plain text, so one comment can't stall the page. Code in a fence doesn't count, and rather than split a code block at 20,000 characters, the plain text starts before it. If drawing a comment fails, it shows as written instead of breaking the list it sits in.
- `ReviewCommentItem` uses it, so review comments keep their lists, quotes and code blocks, and mentions show as chips.
- New `commentPlainText()` and `commentExcerpt()` from `@agent-native/core/review/plain-text` turn a comment into plain text for emails and webhooks. They read the comment with the same Markdown parser as the renderer, so the text matches what the comment shows. The kit's reply and mention emails quote comments with them, so they no longer show Markdown markers or `@[Name](mailto:…)`. `COMMENT_MARKDOWN_LIMIT` and `splitCommentAtMarkdownLimit()` from the same module give the cut both use.
- `InlineMarkdown` shows a protected span's own text inside inline code and code blocks, instead of its placeholder link. A new `showRawHtml` option shows raw HTML as text rather than skip it, but for HTML comments.
- Toolkit now requires Core 0.223.0 or newer, because `CommentBody` uses Core's comment plain text.
