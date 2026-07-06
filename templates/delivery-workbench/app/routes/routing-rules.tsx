import { useT } from "@agent-native/core/client";
import { IconRoute } from "@tabler/icons-react";

export default function RoutingRulesRoute() {
  const t = useT();
  return (
    <section className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <IconRoute className="size-5 text-primary" />
        <div>
          <h1 className="text-sm font-semibold">{t("routingRules.title")}</h1>
          <p className="text-xs text-muted-foreground">
            {t("routingRules.subtitle")}
          </p>
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        {t("routingRules.body")}
      </div>
    </section>
  );
}
