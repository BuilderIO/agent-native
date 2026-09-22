import type { CSSProperties } from "react";

export const chartAxisStroke = "hsl(var(--muted-foreground))";
export const chartGridStroke = "hsl(var(--border))";
export const chartTooltipCursorStroke = "hsl(var(--muted-foreground) / 0.25)";
export const chartTooltipCursorFill = "hsl(var(--muted) / 0.5)";

export const chartTooltipContentStyle = {
  backgroundColor: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  color: "hsl(var(--popover-foreground))",
} satisfies CSSProperties;
