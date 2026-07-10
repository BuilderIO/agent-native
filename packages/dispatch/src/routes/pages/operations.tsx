import {
  DbAdminPage,
  ObservabilityDashboard,
  useT,
} from "@agent-native/core/client";
import {
  IconActivity,
  IconArrowUpRight,
  IconDatabase,
  IconHistory,
  IconMessages,
  IconSend,
} from "@tabler/icons-react";
import { Link, useSearchParams } from "react-router";

import { DispatchShell } from "../../components/dispatch-shell";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../components/ui/tabs";

type OperationsView = "monitoring" | "database";

function selectedView(value: string | null): OperationsView {
  return value === "database" ? "database" : "monitoring";
}

function OperationsShortcuts() {
  const t = useT();

  const tools = [
    {
      to: "/thread-debug",
      icon: IconMessages,
      title: t("dispatch.nav.threadDebug", { defaultValue: "Thread debug" }),
    },
    {
      to: "/audit",
      icon: IconHistory,
      title: t("dispatch.nav.audit"),
    },
    {
      to: "/destinations",
      icon: IconSend,
      title: t("dispatch.pages.deliveryQueue"),
    },
  ];

  return (
    <section className="border-t pt-5">
      <h2 className="text-sm font-semibold text-foreground">
        {t("dispatch.nav.advanced", { defaultValue: "Related tools" })}
      </h2>
      <div className="mt-2 grid gap-x-6 gap-y-1 lg:grid-cols-3">
        {tools.map(({ to, icon: Icon, title }) => (
          <Link
            key={to}
            to={to}
            className="group flex min-w-0 items-start gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted"
          >
            <Icon
              size={16}
              className="mt-0.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1 font-medium text-foreground">
                <span className="truncate">{title}</span>
                <IconArrowUpRight
                  size={13}
                  className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                />
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function meta() {
  return [{ title: "Operations — Dispatch" }];
}

export default function OperationsRoute() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = selectedView(searchParams.get("view"));

  function setView(nextView: OperationsView) {
    const next = new URLSearchParams(searchParams);
    if (nextView === "monitoring") next.delete("view");
    else next.set("view", nextView);
    setSearchParams(next, { replace: true });
  }

  return (
    <DispatchShell title={t("dispatch.nav.operations")}>
      <Tabs
        value={view}
        onValueChange={(value) => {
          if (value === "monitoring" || value === "database") setView(value);
        }}
        className="flex min-w-0 flex-col gap-5"
      >
        <TabsList className="w-fit">
          <TabsTrigger value="monitoring">
            <IconActivity size={15} />
            {t("dispatch.pages.monitoring")}
          </TabsTrigger>
          <TabsTrigger value="database">
            <IconDatabase size={15} />
            {t("dispatch.pages.database")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="monitoring" className="mt-0 min-w-0">
          <ObservabilityDashboard />
          <div className="mt-8">
            <OperationsShortcuts />
          </div>
        </TabsContent>

        <TabsContent value="database" className="mt-0 min-w-0">
          <div className="min-h-[620px] overflow-hidden rounded-lg border bg-background">
            <DbAdminPage title={t("dispatch.pages.database")} />
          </div>
        </TabsContent>
      </Tabs>
    </DispatchShell>
  );
}
