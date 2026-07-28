import type { SelectColorToken } from "@/hooks/use-custom-fields";

export const SELECT_COLOR_OPTIONS: Array<{
  value: SelectColorToken;
  labelKey: string;
  className: string;
}> = [
  { value: "red", labelKey: "fieldEditor.colors.red", className: "bg-red-500" },
  {
    value: "orange",
    labelKey: "fieldEditor.colors.orange",
    className: "bg-orange-500",
  },
  {
    value: "yellow",
    labelKey: "fieldEditor.colors.yellow",
    className: "bg-yellow-500",
  },
  {
    value: "green",
    labelKey: "fieldEditor.colors.green",
    className: "bg-green-500",
  },
  {
    value: "blue",
    labelKey: "fieldEditor.colors.blue",
    className: "bg-blue-500",
  },
  {
    value: "purple",
    labelKey: "fieldEditor.colors.purple",
    className: "bg-purple-500",
  },
  {
    value: "pink",
    labelKey: "fieldEditor.colors.pink",
    className: "bg-pink-500",
  },
  {
    value: "gray",
    labelKey: "fieldEditor.colors.gray",
    className: "bg-muted-foreground",
  },
];

export function selectColorClass(color?: SelectColorToken) {
  return (
    SELECT_COLOR_OPTIONS.find((option) => option.value === color)?.className ??
    "bg-muted-foreground"
  );
}
