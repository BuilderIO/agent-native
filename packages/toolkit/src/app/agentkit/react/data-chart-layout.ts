/** Optional shared presentation controls for built-in data charts in chat. */
export interface AgentChatDataChartLayout {
  /** Maximum card width, in CSS pixels. The card remains responsive below it. */
  maxWidth?: number;
  /** Plot spacing in CSS pixels. The left inset remains data-driven. */
  plotInsets?: { top?: number; right?: number; bottom?: number };
  /** CSS font family for chart labels. */
  labelFontFamily?: string;
  /** Chart label font size, in CSS pixels. */
  labelFontSize?: number;
  /** Chart label color treatment. */
  labelTone?: "foreground" | "muted";
  /** CSS font family for the chart title. */
  titleFontFamily?: string;
  /** Chart title font size, in CSS pixels. */
  titleFontSize?: number;
  /** Chart title font weight. */
  titleFontWeight?: number;
  /** Chart title line height, in CSS pixels. */
  titleLineHeight?: number;
  /** Chart title color treatment. */
  titleTone?: "foreground" | "muted";
  /** Visual weight of chart display actions. */
  actionsVariant?: "primary" | "secondary" | "quiet";
}
