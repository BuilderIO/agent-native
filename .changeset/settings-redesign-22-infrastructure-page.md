---
"@agent-native/core": minor
---

With the `settings-redesign` flag on, Settings › Organization › Infrastructure is a real page for owners and admins: Builder.io setup, the services and who powers each (AI model, file storage, Voice input, Image generation, Embeddings, and the Builder.io-only services), and the read-only environment (database, hosting and every app's address, required variables). Choosing a service's provider updates its row before the server answers and rolls back on failure. The new `get-infrastructure-status` action (owners and admins, `orgAdministration` group) reports the database provider and host, the hosting platform and app addresses, which deploy variables are set (never their values), and the app profile's Required/Recommended tags; `resolveDeployPlatform()` and `getInfrastructureStatus()` are exported from `@agent-native/core/server`. Background agents move from the bridged Model page to Infrastructure's Services list.
