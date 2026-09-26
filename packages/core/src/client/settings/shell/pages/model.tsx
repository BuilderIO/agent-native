import { useT } from "../../../i18n.js";
import ModelSettingsPage from "../../model/ModelSettingsPage.js";
import { SettingsGroup } from "../../SettingsRow.js";
import type { SettingsPageProps } from "../registry.js";

// Bridge: rows a template adds to today's Agent overview
// (`agentAdditionalContent`, e.g. Analytics' bell sound) stay reachable here
// until it moves them to its own page.
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
    </div>
  );
}
