import { useT } from "@agent-native/core/client/i18n";
import { NewWorkspaceAppFlow } from "@agent-native/toolkit/app/onboarding";

import {
  BuildInBuilderPanel,
  useBuilderWorkspaceUrl,
} from "../../components/build-in-builder";
import { DispatchShell } from "../../components/dispatch-shell";

export function meta() {
  return [{ title: "New App — Dispatch" }];
}

export default function NewAppRoute() {
  const t = useT();
  const builderWorkspaceUrl = useBuilderWorkspaceUrl();
  return (
    <DispatchShell
      title={t("dispatch.pages.newApp")}
      description={t("dispatch.pages.newAppDescription")}
    >
      {builderWorkspaceUrl ? (
        <BuildInBuilderPanel url={builderWorkspaceUrl} />
      ) : (
        <NewWorkspaceAppFlow sourceApp="dispatch" className="px-0 py-0" />
      )}
    </DispatchShell>
  );
}
