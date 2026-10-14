# Paused Layer-stack checkpoint

Base commit: `e2dfbafceb3b4bbd8c52747add00a57490394faf`.

`native-layer-chain-2026-10-14.wip.patch` preserves the unfinished same-target Layer-chain refactor at the user-requested pause. It is not wired into the top render publication path, has not been checked, and must not be reported as functional. The current working copy also retains this diff; do not apply it a second time there.

Completed source through the base commit passed focused checks, capped Design TypeScript and all 85 guards. The latest nested-particle and shader-control persistence changes still need a live UI check. Full catalog pixel, export and performance validation remains pending.

For a clean checkout of the base, apply with `git apply --unidiff-zero native-layer-chain-2026-10-14.wip.patch`. The patch omits context-only blank lines to keep the artifact whitespace-clean.
