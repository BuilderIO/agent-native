import { HouseAppShell, HouseSidebar } from "../app-shell/house-frames.js";
import type { WholeParts } from "./whole-parts.js";

/** Explicit registration for a house-only entry; the frames also default here. */
export const houseShellParts = {
  sidebar: HouseSidebar,
  "app-shell": HouseAppShell,
} satisfies Partial<WholeParts>;
