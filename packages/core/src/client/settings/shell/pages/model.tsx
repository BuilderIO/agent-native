import { useT } from "../../../i18n.js";
import ModelSettingsPage from "../../model/ModelSettingsPage.js";
import { AgentSettingsContent } from "../../SettingsPanel.js";
import { SettingsGroup } from "../../SettingsRow.js";
import type { SettingsPageProps } from "../registry.js";

// Bridge: what today's Agent overview carried that has no page of its own
// yet stays reachable here. Rows a template adds (`agentAdditionalContent`,
// e.g. Analytics' bell sound) until it moves them to its own page, and
// Background agents until Infrastructure's Services list lands.
export default function ModelPage(props: SettingsPageProps) {
  const t = useT();
  const extra = props.bridge.tab("agent")?.shellExtraContent;
  return (
    <div className="flex flex-col gap-8">
      <ModelSettingsPage {...props} />
      {extra ? (
        <SettingsGroup title={t("agentChat.settingsShell.page.notifications")}>
          {extra}
        </SettingsGroup>
      ) : null}
      <AgentSettingsContent sections={["background"]} />
    </div>
  );
}
