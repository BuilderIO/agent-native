import { useT } from "@agent-native/core/client";
import { IconArrowUpRight, IconBooks } from "@tabler/icons-react";

export function CreativeContextSettingsLink({
  href = "/agent#library",
}: {
  href?: string;
}) {
  const t = useT();
  return (
    <a
      id="creative-context-library"
      href={href}
      className="group flex scroll-mt-16 items-start gap-4 rounded-lg border border-border bg-card p-5 transition-colors hover:bg-accent/40"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <IconBooks className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold">
          {t("creativeContext.title")}
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {t("creativeContext.description")}
        </p>
      </div>
      <IconArrowUpRight className="mt-1 size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
    </a>
  );
}
