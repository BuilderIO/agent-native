import type { DispatchExtensionConfig } from "@agent-native/dispatch/components";

/**
 * Local Dispatch extensions for this generated workspace.
 *
 * Add workspace-owned management tabs here, then create the matching
 * app/routes/*.tsx file. Dispatch keeps inheriting package updates because
 * the package still owns the shell, sidebar behavior, and built-in routes.
 *
 * Example:
 *
 *   import { IconChartBar } from "@tabler/icons-react";
 *
 *   export const dispatchExtensions = {
 *     navItems: [
 *       {
 *         id: "reports",
 *         to: "/reports",
 *         label: "Reports",
 *         icon: IconChartBar,
 *         section: "operations",
 *       },
 *     ],
 *     queryKeys: ["list-reports"],
 *   } satisfies DispatchExtensionConfig;
 */
export const dispatchExtensions = {
  navItems: [],
  queryKeys: [],
} satisfies DispatchExtensionConfig;
