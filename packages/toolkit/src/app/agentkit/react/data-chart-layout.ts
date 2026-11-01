/** Optional shared presentation controls for built-in data charts in chat. */
export interface AgentChatDataChartLayout {
  /** Maximum card width, in CSS pixels. The card remains responsive below it. */
  maxWidth?: number;
  /** Block-axis card margins, in CSS pixels. */
  marginBlockStart?: number;
  marginBlockEnd?: number;
  /** Horizontal position when the card is narrower than its available width. */
  alignment?: "center" | "start";
  /** Signed plot-inset adjustments in CSS pixels, applied only to horizontal bars. */
  horizontalPlotAdjustments?: {
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
  };
  /** Fallback slot gap for horizontal bars when the saved chart has no ratio. */
  horizontalCategoryGapRatio?: number;
  /** Draw faint horizontal guides through horizontal-bar category centers. */
  horizontalCategoryGridlines?: boolean;
  /** Fallback fill for horizontal bars when a series has no explicit color. */
  horizontalBarColor?: string;
  /** Corner radius for horizontal bars, in CSS pixels. */
  horizontalBarRadius?: number;
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
  /** Position of an icon on the primary action. */
  actionIconPosition?: "start" | "end";
  /** Primary action label typography. */
  actionLabelFontSize?: number;
  actionLabelFontWeight?: number;
  actionLabelLineHeight?: number;
}
