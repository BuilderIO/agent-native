import { HouseAppShell, HouseSidebar } from "../app-shell/house-frames.js";
import type { DesignSystemParts } from "./parts.js";
import type {} from "./sidebar-shell.js";

/** Explicit registration for a house-only entry; the public parts also default here. */
export const houseShellParts = {
  Sidebar: HouseSidebar,
  AppShell: HouseAppShell,
} satisfies Pick<DesignSystemParts, "Sidebar" | "AppShell">;
