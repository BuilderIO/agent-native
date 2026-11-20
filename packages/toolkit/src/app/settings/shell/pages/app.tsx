import { useDemoModeStatus } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { setBrowserDemoModeEnabled } from "@agent-native/core/demo/browser-state";
import { Switch } from "@agent-native/toolkit/design-system";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@agent-native/toolkit/ui/tabs";

import {
  type ModelFragment,
  ModelSurface,
} from "../../../../design-system/parts.js";
import { useAppDefaultModelRow } from "../../app-group/AppDefaultModelRow.js";
import { useSettingsShell } from "../context.js";
import type { SettingsPageProps } from "../registry.js";

const GENERAL_AREA = "general";

function useDemoModeRow(): ModelFragment {
  const t = useT();
  const { enabled } = useDemoModeStatus();
  const label = t("agentChat.settingsShell.appGroup.demoMode");
  return {
    rows: [
      {
        id: "settings.app.this-browser.demo-mode",
        part: "settings.row",
        label,
        description: t("agentChat.settingsShell.appGroup.demoModeDescription"),
        anchor: "demo-mode",
        state: { checked: enabled },
        slot: "demo-mode-switch",
      },
    ],
    slots: {
      "demo-mode-switch": (
        <Switch
          checked={enabled}
          onChange={setBrowserDemoModeEnabled}
          aria-label={label}
        />
      ),
    },
  };
}

/** Core's Agent group, the app's own groups, then This browser. */
function AppGeneralArea({ bridge }: Pick<SettingsPageProps, "bridge">) {
  const t = useT();
  const appName =
    bridge.appName ?? t("agentChat.settingsShell.appFallbackName");
  const agent = useAppDefaultModelRow(appName);
  const browser = useDemoModeRow();
  return (
    <div className="flex flex-col gap-8">
      <ModelSurface
        model={{
          id: "settings",
          rows: [
            {
              id: "settings.app.agent",
              part: "settings.group",
              label: t("agentChat.settingsShell.group.agent"),
              anchor: "agent",
              rows: agent.rows,
            },
          ],
        }}
        actions={agent.actions}
        slots={agent.slots}
      />
      {bridge.general}
      <ModelSurface
        model={{
          id: "settings",
          rows: [
            {
              id: "settings.app.this-browser",
              part: "settings.group",
              label: t("agentChat.settingsShell.appGroup.thisBrowser"),
              anchor: "this-browser",
              rows: browser.rows,
            },
          ],
        }}
        slots={browser.slots}
      />
    </div>
  );
}

/**
 * The app's own General page. App areas (`appAreas`, or tabs a template marks
 * `settingsPlacement: "app-area"`) are tabs here, routed `app/<area>`.
 */
export default function AppGeneralSettingsPage({
  bridge,
  sub,
}: SettingsPageProps) {
  const t = useT();
  const { navigate } = useSettingsShell();
  const areas = bridge.appAreas;
  if (areas.length === 0) return <AppGeneralArea bridge={bridge} />;
  const activeId =
    sub && areas.some((area) => area.id === sub) ? sub : GENERAL_AREA;
  return (
    <Tabs
      value={activeId}
      onValueChange={(next) =>
        navigate("app", next === GENERAL_AREA ? null : next)
      }
      className="flex flex-col gap-6"
    >
      <TabsList className="max-w-full justify-start self-start overflow-x-auto">
        <TabsTrigger value={GENERAL_AREA}>
          {t("agentChat.settingsShell.page.appGeneral")}
        </TabsTrigger>
        {areas.map((area) => (
          <TabsTrigger key={area.id} value={area.id}>
            {area.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={GENERAL_AREA} className="mt-0">
        <AppGeneralArea bridge={bridge} />
      </TabsContent>
      {areas.map((area) => (
        <TabsContent key={area.id} value={area.id} className="mt-0">
          {area.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
