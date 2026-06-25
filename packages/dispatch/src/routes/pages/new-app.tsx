import { NewWorkspaceAppFlow, useT } from "@agent-native/core/client";

import { DispatchShell } from "@/components/dispatch-shell";

export function meta() {
  return [{ title: "New App — Dispatch" }];
}

export default function NewAppRoute() {
  const t = useT();
  return (
    <DispatchShell
      title={t("dispatch.pages.newApp")}
      description={t("dispatch.pages.newAppDescription")}
    >
      <NewWorkspaceAppFlow sourceApp="dispatch" className="px-0 py-0" />
    </DispatchShell>
  );
}
