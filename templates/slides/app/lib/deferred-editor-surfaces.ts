import { lazy } from "react";

let addSlidePopoverModule:
  | Promise<typeof import("@/components/editor/AddSlidePopover")>
  | undefined;

function loadAddSlidePopover() {
  addSlidePopoverModule ??= import("@/components/editor/AddSlidePopover").catch(
    (error) => {
      addSlidePopoverModule = undefined;
      throw error;
    },
  );
  return addSlidePopoverModule;
}

export function preloadAddSlidePopover() {
  // Hover/focus loads are speculative; the opened lazy render owns recovery.
  void loadAddSlidePopover().catch(() => {});
}

export const DeferredAddSlidePopover = lazy(async () => {
  const module = await loadAddSlidePopover();
  return { default: module.AddSlidePopover };
});
