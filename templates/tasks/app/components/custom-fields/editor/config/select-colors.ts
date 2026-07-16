import type { SelectColorToken } from "@/hooks/use-custom-fields";

export const SELECT_COLOR_OPTIONS: Array<{
  value: SelectColorToken;
  label: string;
  className: string;
}> = [
  { value: "red", label: "Red", className: "bg-red-500" },
  { value: "orange", label: "Orange", className: "bg-orange-500" },
  { value: "yellow", label: "Yellow", className: "bg-yellow-500" },
  { value: "green", label: "Green", className: "bg-green-500" },
  { value: "blue", label: "Blue", className: "bg-blue-500" },
  { value: "purple", label: "Purple", className: "bg-purple-500" },
  { value: "pink", label: "Pink", className: "bg-pink-500" },
  { value: "gray", label: "Gray", className: "bg-muted-foreground" },
];

export function selectColorClass(color?: SelectColorToken) {
  return (
    SELECT_COLOR_OPTIONS.find((option) => option.value === color)?.className ??
    "bg-muted-foreground"
  );
}
