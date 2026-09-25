import { Switch } from "@agent-native/toolkit/design-system";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@agent-native/toolkit/ui/tabs";

import { setBrowserDemoModeEnabled } from "../../../../demo/browser-state.js";
import { useT } from "../../../i18n.js";
import { useDemoModeStatus } from "../../../use-demo-mode-status.js";
import { AppDefaultModelRow } from "../../app-group/AppDefaultModelRow.js";
import { SettingsGroup, SettingsRow } from "../../SettingsRow.js";
import { useSettingsShell } from "../context.js";
import type { SettingsPageProps } from "../registry.js";

const GENERAL_AREA = "general";

function DemoModeRow() {
  const t = useT();
  const { enabled } = useDemoModeStatus();
  const label = t("agentChat.settingsShell.appGroup.demoMode");
  return (
    <SettingsRow
      id="demo-mode"
      label={label}
      description={t("agentChat.settingsShell.appGroup.demoModeDescription")}
      control={
        <Switch
          checked={enabled}
          onChange={setBrowserDemoModeEnabled}
          aria-label={label}
          className="shrink-0"
        />
      }
    />
  );
}

/** Core's Agent group, the app's own groups, then This browser. */
function AppGeneralArea({ bridge }: Pick<SettingsPageProps, "bridge">) {
  const t = useT();
  const appName =
    bridge.appName ?? t("agentChat.settingsShell.appFallbackName");
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup
        id="agent"
        title={t("agentChat.settingsShell.group.agent")}
      >
        <AppDefaultModelRow appName={appName} />
      </SettingsGroup>
      {bridge.general}
      <SettingsGroup
        id="this-browser"
        title={t("agentChat.settingsShell.appGroup.thisBrowser")}
      >
        <DemoModeRow />
      </SettingsGroup>
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
