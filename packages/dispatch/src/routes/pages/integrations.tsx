import { useT } from "@agent-native/core/client/i18n";
import { McpIntegrationsLanding } from "@agent-native/core/client/integrations";
import { Link } from "react-router";

import { DispatchShell } from "../../components/dispatch-shell";

export function meta() {
  return [{ title: "Integrations — Dispatch" }];
}

export default function IntegrationsRoute() {
  const t = useT();

  return (
    <DispatchShell
      title="Integrations"
      description="Connect the tools and services available to your agent."
    >
      <div className="mx-auto w-full max-w-5xl">
        <McpIntegrationsLanding showTitle={false} showDescription={false} />
        <p className="mt-5 text-right text-xs text-muted-foreground">
          <Link
            className="underline-offset-4 hover:text-foreground hover:underline"
            to="/integrations"
          >
            {t("integrations.connectedAccounts")}
          </Link>
        </p>
      </div>
    </DispatchShell>
  );
}
