export const CONTACT_PANEL_WIDGET_IDS = [
  "notes",
  "attachments",
  "recent",
] as const;

export type ContactPanelWidgetId = (typeof CONTACT_PANEL_WIDGET_IDS)[number];

export type ContactPanelWidgets = Record<ContactPanelWidgetId, boolean>;

export const DEFAULT_CONTACT_PANEL_WIDGETS: ContactPanelWidgets = {
  notes: true,
  attachments: false,
  recent: true,
};

export function normalizeContactPanelWidgets(
  value: unknown,
  base: ContactPanelWidgets = DEFAULT_CONTACT_PANEL_WIDGETS,
): ContactPanelWidgets {
  const saved =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const widgets = { ...base };
  for (const id of CONTACT_PANEL_WIDGET_IDS) {
    if (typeof saved[id] === "boolean") widgets[id] = saved[id];
  }
  return widgets;
}
