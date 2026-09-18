---
record_type: "feature"
id: "content.feature.keep-your-private-vault-private"
number: 32
name: "Keep your private vault private"
chapter: "content.chapter.publishing-portability"
order: 32
roadmap_status: "paused"
summary: "Add user-controlled encrypted custody without abandoning collaboration, recovery, or ordinary agent workflows."
example_workflow: "A person enrolls a trusted laptop, opens an encrypted private vault locally, grants a local agent bounded access for one task, then revokes the device without exposing the vault to the service."
works_today: "The private-vault lane has substantial research and fork implementation history around enrollment, encrypted custody, device authorization, fail-closed behavior, and cross-architecture verification."
remains: "The complete user product still needs audited cryptographic integration, understandable recovery and revocation, collaboration, agent access boundaries, portable exit, current-main reconciliation, and production proof. Work remains deliberately paused."
required_capabilities:
  [
    "content.security.private-vault",
    "content.agent.resource-consent",
    "content.portability.vault-export",
  ]
enhancing_capabilities:
  ["content.source.local-bridge", "content.agent.audience-safe"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 32: Keep your private vault private

Add user-controlled encrypted custody without abandoning collaboration, recovery, or ordinary agent workflows.

## Product contract

- **End-to-end encryption:** Keeps private content unreadable to the service outside explicitly authorized plaintext boundaries.
- **Enrollment and recovery:** Gives people understandable key setup, device addition, rotation, revocation, and recovery ceremonies.
- **Device authority:** Lets trusted local clients decrypt only the vaults and operations they are authorized to handle.
- **Agent access:** Makes private-vault availability explicit and bounded rather than silently handing an agent plaintext.
- **Collaboration:** Preserves sharing, Versions, comments, and revocation without weakening the custody promise.
- **Portable exit:** Allows the owner to export readable authorized content and keys without permanent service dependence.
- **Paused boundary:** Retains the existing E2EE research and implementation history without claiming the complete workflow is ready.
