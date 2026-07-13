import { AgentTabsPage, useT } from "@agent-native/core/client";
import { Link } from "react-router";

export function meta() {
  return [{ title: "Agent - {{APP_TITLE}}" }];
}

export default function AgentPage() {
  const t = useT();

  return (
    <main className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <div className="space-y-2">
          <Link
            to="/settings"
            className="text-[13px] text-muted-foreground hover:text-foreground"
          >
            {t("settings.title")}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t("settings.agentTitle")}
          </h1>
          <p className="text-[14px] leading-relaxed text-muted-foreground">
            {t("settings.agentDescription")}
          </p>
        </div>

        <AgentTabsPage className="min-h-[640px] rounded-lg border border-border/50" />
      </div>
    </main>
  );
}
