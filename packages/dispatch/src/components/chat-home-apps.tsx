import { appPath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import { Link } from "react-router";

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
    <div className="mx-auto w-full max-w-[1000px]">
      {launcher.error ? (
        <ActionQueryError
          error={launcher.error}
          onRetry={launcher.retry}
          className="mb-3"
        />
      ) : null}
      <section aria-label={t("dispatch.pages.chatFirstWorkspaceApps")}>
        <div className="max-h-[32vh] overflow-y-auto overscroll-contain">
          <div className="grid grid-cols-2 gap-1.5">
            {launcher.isLoading && launcher.apps.length === 0
              ? Array.from({ length: 6 }, (_, index) => (
                  <div
                    key={index}
                    className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5"
                  >
                    <Skeleton className="size-7 rounded-md" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                ))
              : launcher.apps.slice(0, 6).map((app) => (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => launcher.openApp(app)}
                    className="group flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <AppIcon
                      id={app.id}
                      name={app.name}
                      size="sm"
                      className="rounded-md"
                    />
                    <span className="min-w-0 truncate text-sm font-medium text-muted-foreground group-hover:text-foreground">
                      {app.name}
                    </span>
                  </button>
                ))}
          </div>
        </div>
        <Link
          to={appPath("/apps")}
          className="mt-2 inline-flex text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {t("dispatch.pages.allApps")}
        </Link>
      </section>
    </div>
  );
}
