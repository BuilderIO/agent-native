import type { ElementInfo } from "@/components/design/types";

/**
 * The one element a style patch lands on — read by the live preview AND the
 * commit, so what you see dragging cannot drift from what gets written.
 */
export function styleWriteTarget(args: {
  selector: string;
  selectedElement: ElementInfo | null | undefined;
}): string {
  return args.selectedElement?.repeat?.sourceSelector ?? args.selector;
}
