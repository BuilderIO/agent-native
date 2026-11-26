---
record_type: "feature"
id: "content.feature.use-content-from-chatgpt"
number: 33
name: "Use Content from ChatGPT"
chapter: "content.chapter.publishing-portability"
order: 33
roadmap_status: "partially_implemented"
summary: "Find Content in ChatGPT's app directory, connect your account, and search, open, and edit your real pages without leaving the chat."
example_workflow: "A writer finds Content in ChatGPT's app directory, connects it with their Content sign-in, asks ChatGPT for last week's launch brief, opens the real page inline, and edits a paragraph. Opening the page in Content later shows the same edit, history, and permissions, whether the writer used ChatGPT on the web or on a phone."
works_today: "Content has a ChatGPT listing package with a curated, annotated tool set: search and read pages, create and revise documents, inspect databases, and add or update records, with no delete action. Production serves the directory connector behind sign-in and answers OpenAI's domain check. Inline widgets show the real document with Content's own layout, top bar, and formatting toolbar, and can edit it (#6529, #6542, #6856, #6985, #7149, #7257, #7317)."
remains: "OpenAI still has to approve the Content listing and make it public. Today the widget opens only on a page or database ChatGPT has just created: opening an existing page it found returns the page's text, so opening a found page inline still has to be built. Sign-in and the search, open, and edit tools need end-to-end proof on production rather than beta, and the widgets need proof that they render and save reliably in ChatGPT on the web and on mobile. The general mount and host-grant contract stays with Feature 31."
required_capabilities:
  [
    "content.embed.mcp-app",
    "content.embed.surface",
    "content.embed.host-grant",
    "content.agent.action-parity",
    "content.knowledge.search",
  ]
enhancing_capabilities: ["content.layout.responsive"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-11-08"
---

# Feature 33: Use Content from ChatGPT

Find Content in ChatGPT's app directory, connect your account, and search, open, and edit your real pages without leaving the chat.

## Product contract

- **Public listing:** Anyone can find Content in ChatGPT's app directory once OpenAI approves the listing, without pasting a connector URL.
- **Own sign-in:** Connects through Content's production sign-in, and ChatGPT never sees or edits more than the signed-in person could in Content itself.
- **Curated tools:** Offers search, read, create, and revise for pages and records through the same Actions Content uses, each annotated for the host, with no delete action.
- **Real page inline:** Opens the canonical Page in a ChatGPT widget rather than a copy, and saves edits through the same validation, history, and permissions.
- **Every ChatGPT client:** Works in ChatGPT on the web and on mobile, and says so plainly when a host cannot show the widget.
- **Boundary:** Feature 31 owns the general contract for mounting Content inside another application; this Feature is the ChatGPT directory path onto it.
