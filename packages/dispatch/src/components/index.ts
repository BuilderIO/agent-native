/**
 * Public dispatch UI components. Most consumers only use `dispatchRoutes`
 * and never import from here directly — components are exported as a
 * customization escape hatch for embedding (e.g. mount `<DispatchShell>`
 * inside a parent layout, or render `<AppKeysPopover>` next to a custom
 * card list).
 */
export { DispatchShell } from "./dispatch-shell.js";
export { Layout, NavContent } from "./layout/Layout.js";
export type {
  DispatchExtensionConfig,
  DispatchNavIcon,
  DispatchNavItem,
  DispatchNavSection,
} from "./layout/Layout.js";
export { CreateAppPopover, CreateAppFlow } from "./create-app-popover.js";
export { AppKeysPopover } from "./app-keys-popover.js";
