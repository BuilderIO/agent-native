import { useT } from "../../../i18n.js";
import { ResourceCollection } from "./resource-collection.js";

export default function MemorySettingsPage() {
  const t = useT();
  return (
    <div className="flex flex-col gap-10">
      <ResourceCollection view="memory" />
      <section id="learnings" className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          {t("agentChat.settingsShell.learnings")}
        </h2>
        <ResourceCollection view="learnings" />
      </section>
    </div>
  );
}
