---
record_type: "capability"
id: "content.relationship.edge"
name: "Typed Relationships"
user_promise: "One typed edge substrate powers relation Properties, inline typed Page references, backlinks, Info, graph queries, and Graph editing"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.object.page"]
related_features: ["content.feature.living-references","content.feature.run-projects-your-way","content.feature.plan-work-across-time","content.feature.sketch-connections-keep-whats-true"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Current code models/displays relation values but omits relation from user-creatable properties and treats Notion relations as unsupported. Add stable relationship-type identity (the technical graph term is predicate), target constraints, inverse labels, cardinality, access, relation-property UI/actions, automatic structural edges, workspace-defined semantic relationships, and one mutation path shared by columns, Info, inline references, Canvas promotion, and Graph."
proof_requirements: ["Current code models/displays relation values but omits relation from user-creatable properties and treats Notion relations as unsupported. Add stable relationship-type identity (the technical graph term is predicate), target constraints, inverse labels, cardinality, access, relation-property UI/actions, automatic structural edges, workspace-defined semantic relationships, and one mutation path shared by columns, Info, inline references, Canvas promotion, and Graph."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Typed Relationships

## Contract

One typed edge substrate powers relation Properties, inline typed Page references, backlinks, Info, graph queries, and Graph editing

## Acceptance boundary

A complete proof demonstrates: Current code models/displays relation values but omits relation from user-creatable properties and treats Notion relations as unsupported. Add stable relationship-type identity (the technical graph term is predicate), target constraints, inverse labels, cardinality, access, relation-property UI/actions, automatic structural edges, workspace-defined semantic relationships, and one mutation path shared by columns, Info, inline references, Canvas promotion, and Graph.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
