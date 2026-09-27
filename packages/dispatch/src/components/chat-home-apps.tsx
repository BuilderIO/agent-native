import { useT } from "@agent-native/core/client/i18n";

import { ActionQueryError } from "./action-query-error";
import { AppIcon } from "./app-icon";
import { useDispatchWorkspaceAppLauncher } from "./layout/Layout";
import { Skeleton } from "./ui/skeleton";

export function DispatchChatHomeApps() {
  const t = useT();
  const launcher = useDispatchWorkspaceAppLauncher();
  if (!launcher) return null;

  if (launcher.error && launcher.apps.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[1000px]">
        <ActionQueryError error={launcher.error} onRetry={launcher.retry} />
      </div>
    );
  }
  if (!launcher.isLoading && launcher.apps.length === 0) return null;

  return (
    <section
      aria-label={t("dispatch.pages.workspaceApps", {
        defaultValue: "Workspace apps",
      })}
      className="mx-auto w-full max-w-[1000px]"
    >
      <div className="max-h-[32vh] overflow-y-auto overscroll-contain">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6">
          {launcher.isLoading && launcher.apps.length === 0
            ? Array.from({ length: 6 }, (_, index) => (
                <div
                  key={index}
                  className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl px-3 py-3"
                >
                  <Skeleton className="size-11 rounded-xl" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))
            : launcher.apps.map((app) => (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => launcher.openApp(app)}
                  className="group flex min-h-24 min-w-0 flex-col items-center justify-center gap-2 rounded-xl border border-transparent px-3 py-3 text-center transition-colors hover:border-border hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <AppIcon
                    id={app.id}
                    name={app.name}
                    size="md"
                    className="size-11 rounded-xl shadow-sm transition-transform group-hover:scale-105"
                  />
                  <span className="max-w-full truncate text-xs font-medium text-muted-foreground group-hover:text-foreground">
                    {app.name}
                  </span>
                </button>
              ))}
        </div>
      </div>
    </section>
  );
}
