---
"@agent-native/core": minor
---

Add an opt-in projected resource load to access checks so callers that only need the access decision can skip fetching heavy resource columns. Default behavior unchanged.

`resolveAccess()`/`assertAccess()` now accept `{ skipResourceBody: true }` (as the trailing options argument) to load only the columns the access decision itself reads — `id`, `ownerEmail`, `orgId`, `visibility` — instead of the full resource row (`resource` is typed as `AccessProjectedResource` in this mode). This is automatically ignored, falling back to a full row load, for any resource type registered with a `publicAccessRole` _function_ resolver, since that callback can read arbitrary resource fields the projection would have omitted. Passing nothing (the default) is a pure no-op: `loadResourceForAccess` still runs `db.select()` exactly as before, so none of the ~317 existing `assertAccess`/`resolveAccess` call sites change behavior.

This is a mechanism only — no call sites are migrated in this change. `templates/design/actions/update-design.ts`'s bare `assertAccess("design", id, "editor")` — which currently pulls the full `data` blob it doesn't otherwise need — was the motivating example and is the intended first adopter as a follow-up. Note: the `"design"` resource type itself is registered with a dynamic `publicAccessRole` resolver (`publicDesignAccessRole`), which the guard above always excludes from projection, so that specific call would keep loading the full row even after opting in; `"design-system"` (checked a few lines later in the same action) has no such resolver and is a real candidate. Follow-up migration work should account for this per resource type rather than assuming every `assertAccess`/`resolveAccess` call site benefits.
