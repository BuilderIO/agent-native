import { useT } from "../../../i18n.js";
import { cn } from "../../../utils.js";
import { useSettingsShell } from "../context.js";
import type { SettingsPageProps } from "../registry.js";

const GENERAL_AREA = "general";

/**
 * The app's own General page. Tabs a template marks
 * `settingsPlacement: "app-area"` render as areas routed `app/<area>`.
 */
export default function AppGeneralSettingsPage({
  bridge,
  sub,
}: SettingsPageProps) {
  const t = useT();
  const { navigate } = useSettingsShell();
  const areas = bridge.appAreas;
  const active = areas.find((area) => area.id === sub) ?? null;
  if (areas.length === 0) return <>{bridge.general}</>;
  const tabs = [
    { id: GENERAL_AREA, label: t("agentChat.settingsShell.page.appGeneral") },
    ...areas.map((area) => ({ id: area.id, label: area.label })),
  ];
  const activeId = active?.id ?? GENERAL_AREA;
  return (
    <div className="flex flex-col gap-6">
      <div
        role="tablist"
        aria-orientation="horizontal"
        className="flex items-center gap-1 overflow-x-auto"
      >
        {tabs.map((tab) => {
          const selected = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() =>
                navigate("app", tab.id === GENERAL_AREA ? null : tab.id)
              }
              className={cn(
                "inline-flex h-8 shrink-0 items-center rounded-md px-3 text-sm font-medium transition-colors",
                selected
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel">{active ? active.content : bridge.general}</div>
    </div>
  );
}
