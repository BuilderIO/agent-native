import type { ElementInfo } from "@/components/design/types";

export function styleWriteTarget(args: {
  selector: string;
  selectedElement: ElementInfo | null | undefined;
}): string {
  return args.selectedElement?.repeat?.sourceSelector ?? args.selector;
}
