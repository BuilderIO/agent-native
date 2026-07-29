---
record_type: "capability"
id: "content.author.mermaid"
name: "Mermaid diagrams"
user_promise: "Mermaid source renders through a normal built-in Code-block renderer and round-trips through ordinary fenced source"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.author.code","content.renderer.typed"]
related_features: []
roadmap_boundary: "supporting"
acceptance_summary: "A complete proof demonstrates: Present Mermaid as `/Diagram (Mermaid)` over `language = mermaid`, with Source/Rendered views and the shared renderer/export substrate. Current block donates source/caption editing, Excalidraw-style SVG with strict Mermaid fallback, visible errors, lightbox, dark mode, sanitization, and MDX migration. Add ordinary fence mapping, static/accessibility fallback, public SSR strategy, and shared HTML/PDF rendering."
proof_requirements: ["Present Mermaid as `/Diagram (Mermaid)` over `language = mermaid`, with Source/Rendered views and the shared renderer/export substrate. Current block donates source/caption editing, Excalidraw-style SVG with strict Mermaid fallback, visible errors, lightbox, dark mode, sanitization, and MDX migration. Add ordinary fence mapping, static/accessibility fallback, public SSR strategy, and shared HTML/PDF rendering."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Mermaid diagrams

## Contract

Mermaid source renders through a normal built-in Code-block renderer and round-trips through ordinary fenced source

## Acceptance boundary

A complete proof demonstrates: Present Mermaid as `/Diagram (Mermaid)` over `language = mermaid`, with Source/Rendered views and the shared renderer/export substrate. Current block donates source/caption editing, Excalidraw-style SVG with strict Mermaid fallback, visible errors, lightbox, dark mode, sanitization, and MDX migration. Add ordinary fence mapping, static/accessibility fallback, public SSR strategy, and shared HTML/PDF rendering.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
