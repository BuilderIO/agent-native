import { useActionQuery, useT } from "@agent-native/core/client";
import { useTheme } from "next-themes";
import { Link } from "react-router";

export function meta() {
  return [{ title: "{{APP_TITLE}}" }];
}

export default function IndexPage() {
  const { resolvedTheme, setTheme } = useTheme();
  const t = useT();
  const isDark = resolvedTheme === "dark";
  const { data } = useActionQuery("hello", { name: "{{APP_TITLE}}" });

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6">
      <div className="max-w-md w-full space-y-8 text-center">
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t("home.title")}
          </h1>
          <p className="text-[14px] text-muted-foreground leading-relaxed">
            {t("home.intro")}{" "}
            <code className="text-[13px] bg-muted px-1.5 py-0.5 rounded font-mono">
              app/routes/_index.tsx
            </code>
          </p>
        </div>

        <div className="h-px bg-border" />

        <div className="rounded-lg border border-border/50 px-4 py-3 text-left">
          <p className="text-[13px] font-medium text-foreground">
            {t("home.actionCardTitle")}
          </p>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {data?.message ?? t("home.loadingAction")}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 text-left">
          <a
            href="https://agent-native.com/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-lg border border-border/50 px-4 py-3 hover:bg-accent/50 transition-colors"
          >
            <p className="text-[13px] font-medium text-foreground">
              {t("home.docsTitle")}
            </p>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {t("home.docsDescription")}
            </p>
          </a>
          <button
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className="rounded-lg border border-border/50 px-4 py-3 hover:bg-accent/50 transition-colors text-left"
          >
            <p className="text-[13px] font-medium text-foreground">
              {t("home.themeTitle")}
            </p>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {t("home.themeDescription")}
            </p>
          </button>
          <Link
            to="/settings"
            className="group rounded-lg border border-border/50 px-4 py-3 hover:bg-accent/50 transition-colors"
          >
            <p className="text-[13px] font-medium text-foreground">
              {t("home.settingsTitle")}
            </p>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {t("home.settingsDescription")}
            </p>
          </Link>
          <Link
            to="/agent"
            className="group rounded-lg border border-border/50 px-4 py-3 hover:bg-accent/50 transition-colors"
          >
            <p className="text-[13px] font-medium text-foreground">
              {t("settings.agentTitle")}
            </p>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {t("settings.agentDescription")}
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
