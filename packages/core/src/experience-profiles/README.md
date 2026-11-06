# Experience profiles

Profiles are user choices over an app's existing deviation flags. They do not create a second rollout store or replace DEVIATIONS.md. Define feature flags with `defineFeatureFlag`, register them with the existing feature-flags plugin, and pass their definitions plus `enabledInAgentNative` to `createExperienceProfileActions` from `@agent-native/core/experience-profiles/server`.

Export the returned `get` and `set` actions as `get-experience-profile.ts` and `set-experience-profile.ts` in the app's actions directory. Both the UI and agent use those actions. `get` returns the effective profile, saved choice, reference availability, and preset values for only the declared deviations. Other feature flags retain their normal rollout semantics.

The first visit uses Agent-Native. Reference disables all declared deviations. Pass `canUseReferenceExperience` as the authorization callback to use the deployment's `experienceProfiles.referenceEmails` allowlist (`EXPERIENCE_REFERENCE_EMAILS`), or supply a stronger app-owned policy. Authorization is rechecked for every read and write. A revoked saved choice remains visible as `savedProfile: reference` but the effective profile is Agent-Native. Invalid or unreadable preferences throw rather than silently becoming defaults.

Keep controllers, actions, navigation and selection outside presentation replacements. Load alternative screens through dynamic imports and preserve draft state in the shared controller. The command menu calls the setter; it never navigates or reloads the page. Expose loading, failure and saving states; do not paint an unverified reference view while the profile is loading.

Each DEVIATIONS.md entry records its flag, request, affected surfaces, reference and public checks, owner and promotion state. Fidelity runners explicitly select reference through the action, assert the returned profile, then capture. Functional runners execute both profiles. Ordinary users cannot select reference just by changing browser storage or sending a direct setter request.
