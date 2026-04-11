/**
 * @{{APP_NAME}}/core-module — enterprise-wide workspace core.
 *
 * Every agent-native app in this workspace inherits from this package:
 *   - Server plugins (auth, org, agent-chat) — see src/server
 *   - Shared React components and hooks — see src/client
 *   - Shared agent actions — see actions/
 *   - Shared agent skills — see skills/
 *   - Enterprise-wide agent instructions — see AGENTS.md
 *   - Shared Tailwind preset — see tailwind.preset.ts
 *
 * Apps don't import from this root entry directly — they import from
 * the specific sub-path they need:
 *
 *   import { authPlugin } from "@{{APP_NAME}}/core-module/server";
 *   import { AuthenticatedLayout } from "@{{APP_NAME}}/core-module/client";
 *   import { resolveCompanyCredential } from "@{{APP_NAME}}/core-module/credentials";
 *
 * This root file is for package metadata only.
 */
export const WORKSPACE_CORE_NAME = "@{{APP_NAME}}/core-module";
