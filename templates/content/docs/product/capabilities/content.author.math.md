---
record_type: "capability"
id: "content.author.math"
name: "Math and equations"
user_promise: "Inline and block math render faithfully in editor, reader, and export"
kind: "primitive"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: ["content.object.block","content.renderer.typed"]
related_features: []
roadmap_boundary: "supporting"
acceptance_summary: "A complete proof demonstrates: Current code has KaTeX rendering with accessible MathML, inline `$…$` promotion, slash composers with live validation, NFM round trips, visible invalid-source fallback, and HTML/PDF-ready export tests. Verify the shipped editor, public reader, copy/paste, Notion sync, and export surfaces together before calling the capability fully verified."
proof_requirements: ["Current code has KaTeX rendering with accessible MathML, inline `$…$` promotion, slash composers with live validation, NFM round trips, visible invalid-source fallback, and HTML/PDF-ready export tests. Verify the shipped editor, public reader, copy/paste, Notion sync, and export surfaces together before calling the capability fully verified."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Math and equations

## Contract

Inline and block math render faithfully in editor, reader, and export

## Acceptance boundary

A complete proof demonstrates: Current code has KaTeX rendering with accessible MathML, inline `$…$` promotion, slash composers with live validation, NFM round trips, visible invalid-source fallback, and HTML/PDF-ready export tests. Verify the shipped editor, public reader, copy/paste, Notion sync, and export surfaces together before calling the capability fully verified.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
