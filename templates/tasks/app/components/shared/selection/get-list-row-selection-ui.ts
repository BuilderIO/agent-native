import type { MouseEvent } from "react";
import { cn } from "@/lib/utils";

export type ListRowSelectionContainerUi = {
  className: string;
  role?: "option";
  "aria-selected"?: boolean;
  "aria-label"?: string;
  onClick?: (event: MouseEvent<Element>) => void;
};

type GetListRowSelectionUiArgs = {
  selectionMode: boolean;
  selected: boolean;
  itemLabel: string;
  onRowSelect?: (event: MouseEvent<Element>) => void;
};

export function getListRowSelectionUi({
  selectionMode,
  selected,
  itemLabel,
  onRowSelect,
}: GetListRowSelectionUiArgs): ListRowSelectionContainerUi {
  if (!selectionMode) {
    return { className: "" };
  }

  return {
    className: cn(
      "cursor-pointer select-none",
      selected &&
        "border-primary/40 bg-primary/[0.08] ring-2 ring-inset ring-primary/20",
    ),
    role: "option",
    "aria-selected": selected,
    "aria-label": itemLabel,
    onClick: onRowSelect,
  };
}
