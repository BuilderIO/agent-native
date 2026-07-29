---
record_type: "feature"
id: "content.feature.cite-what-you-found"
number: 26
name: "Cite what you found"
chapter: "content.chapter.capture-research"
order: 26
roadmap_status: "planned"
summary: "Turn a link into one durable source-and-locator identity that can render in different citation styles."
example_workflow: "A writer promotes an ordinary research link to a citation, adds a page locator, switches the article from author-date to footnote style, and watches the bibliography update without re-entering the source."
works_today: "Content has ordinary links, Page references, source metadata, rich text, equations, and import and export machinery that can donate to citation rendering."
remains: "First-class citation identity, locators, promote-to-citation, automatic bibliographies, selectable styles, Zotero interoperability, and semantic portability need implementation."
required_capabilities: ["content.research.citation", "content.author.footnotes"]
enhancing_capabilities:
  ["content.portability.roundtrip", "content.source.adapters"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 26: Cite what you found

Turn a link into one durable source-and-locator identity that can render in different citation styles.

## Product contract

- **Promote to citation:** Converts an ordinary link without losing its anchor or source identity.
- **Source Page:** Resolves or creates the canonical record for the paper, book, website, video, dataset, or other source.
- **Locators:** Preserve page, chapter, figure, timestamp, transcript range, or another precise place within the source.
- **Style rendering:** Presents one semantic citation as a link, author-date reference, number, footnote, or bibliography entry.
- **Bibliographies:** Recompute from the citations actually present rather than maintaining a second manual list.
- **Zotero interoperability:** Uses Zotero identities and CSL styles instead of volunteering to personally maintain civilization's citation formats.
- **Portability:** Keeps citation identity intact across supported imports and exports even when the destination renders it differently.
