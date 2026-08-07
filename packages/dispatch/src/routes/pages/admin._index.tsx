import { useT } from "@agent-native/core/client/i18n";

import { DispatchShell } from "../../components/dispatch-shell";

export function meta() {
  return [{ title: "Admin — Dispatch" }];
}

export default function AdminOverviewRoute() {
  const t = useT();

  return (
    <DispatchShell
      title={t("dispatch.nav.admin", { defaultValue: "Admin" })}
      description={t("dispatch.pages.adminDescription", {
        defaultValue: "Workspace controls and operations",
      })}
    >
      <section className="max-w-2xl space-y-2">
        <h2 className="text-base font-semibold text-foreground">
          {t("dispatch.pages.adminWelcome", {
            defaultValue: "Workspace control plane",
          })}
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          {t("dispatch.pages.adminChooseArea", {
            defaultValue:
              "Manage apps, connections, automations, and operational tools from one place.",
          })}
        </p>
        <p className="text-sm leading-6 text-muted-foreground">
          {t("dispatch.pages.adminChooseAreaHint", {
            defaultValue: "Choose an area from the Admin navigation.",
          })}
        </p>
      </section>
    </DispatchShell>
  );
}
