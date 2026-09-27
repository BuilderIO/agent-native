export const APPROVED_FIGMA_CHROME_REFERENCE = {
  inspectorTabs: {
    header: { height: 48, paddingY: 8, borderBottom: 1 },
    listHeight: 28,
    trigger: { height: 24, paddingY: 4, lineHeight: 16 },
  },
  layers: {
    sectionHeaderHeight: 28,
    action: { width: 20, height: 20, glyph: 12 },
    row: {
      height: 24,
      chevron: 20,
      chevronGlyph: 10,
      icon: 12,
    },
  },
  autoLayout: {
    sectionHeaderHeight: 40,
    contentPaddingX: 8,
    contentPaddingBottom: 8,
    pairGap: 16,
    pairSlotWidth: 16,
    menuItemHeight: 30,
    menuItemPaddingY: 6,
    menuItemLineHeight: 18,
    menuLeadingSlotWidth: 16,
    menuTrailingSlotWidth: 14,
  },
} as const;
