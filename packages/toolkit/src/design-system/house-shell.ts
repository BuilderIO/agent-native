import { HouseAppShell, HouseSidebar } from "../app-shell/house-frames.js";
import type { DesignSystemFrames } from "./frames.js";

/** Explicit registration for a house-only entry; the frames also default here. */
export const houseShellFrames = {
  Sidebar: HouseSidebar,
  AppShell: HouseAppShell,
} satisfies DesignSystemFrames;
