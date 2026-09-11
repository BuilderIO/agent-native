---
record_type: "feature"
id: "content.feature.share-how-your-organization-works"
number: 14
name: "Share how your organization works"
chapter: "content.chapter.working-systems"
order: 14
roadmap_status: "partially_implemented"
summary: "Govern reusable Templates, Properties, Expressions, and Custom Blocks without taking ownership away from adopters."
example_workflow: "An administrator publishes an approved editorial Template with governed Properties and Expressions; any team can inspect and adopt it, customize the local system, or detach without losing its existing records."
works_today: "Content already has Templates and several reusable configuration surfaces, while source Properties and local components demonstrate governed and source-backed reuse patterns."
remains: "Templates, Custom Properties, Expressions, and Custom Blocks need one understandable catalog model with ownership scope, inspection, adoption, local aliasing, provenance, and faithful detachment."
required_capabilities:
  [
    "content.template.graph",
    "content.template.governance",
    "content.template.item-body",
  ]
enhancing_capabilities:
  ["content.property.catalog", "content.organization.teams"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 14: Share how your organization works

Govern reusable Templates, Properties, Expressions, and Custom Blocks without taking ownership away from adopters.

## Product contract

- **Templates:** Package Pages, Databases, Views, Properties, Rules, and content into reusable starting systems.
- **Custom Properties:** Offer approved reusable field definitions without making every ordinary local column secretly global.
- **Expressions:** Store reusable typed logic with personal, workspace, or organization scope.
- **Catalog discovery:** Uses consistent names, descriptions, aliases, ownership, compatibility, and previews.
- **Adoption:** Lets someone inspect a governed building block before binding it into their local system.
- **Detachment:** Preserves the current data and behavior as a faithful local copy when someone leaves the shared lineage.
