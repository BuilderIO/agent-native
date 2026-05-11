import { useEffect, useMemo } from "react";
import {
  Link,
  Navigate,
  redirect,
  useParams,
  type ClientLoaderFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { useActionQuery, appPath } from "@agent-native/core/client";
import {
  IconArrowLeft,
  IconArrowUpRight,
  IconClockHour4,
} from "@tabler/icons-react";
import { DispatchShell } from "@/components/dispatch-shell";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { resolveCatchAllTarget } from "@/lib/catch-all-target";
import {
  workspaceAppHref,
  type WorkspaceAppSummary,
} from "@/lib/workspace-apps";

export function meta() {
  return [{ title: "Workspace app - Dispatch" }];
}

/**
 * Catch-all for `/dispatch/<segment>` paths that don't match an explicit
 * Dispatch route. When `<segment>` is the id of a workspace app sibling
 * (e.g. `/dispatch/todo` after Builder.io routes a "navigate to /todo"
 * call through Dispatch's mount point), bounce to the absolute `/<appId>`
 * so the user lands on the actual app instead of a 404 inside Dispatch.
 *
 * Server-side redirect: we resolve the workspace app manifest via the
 * shared `loadWorkspaceAppsManifest()` helper, which checks the
 * `AGENT_NATIVE_WORKSPACE_APPS_JSON` env var, then the
 * `.agent-native/workspace-apps.json` file written by `workspace-deploy.ts`,
 * then a live filesystem scan of `apps/` for local dev. We then throw
 * `redirect("/<appId>")`. React Router 7 does not prepend the basename to
 * absolute paths returned from a loader, so the redirect escapes Dispatch's
 * `/dispatch` mount cleanly.
 *
 * Why a catch-all instead of fixing the agent prompt: Builder.io currently
 * resolves "navigate to /todo" relative to Dispatch's mount, sending the
 * user to /dispatch/todo. The same wrong path then gets captured as the
 * OAuth callbackURL, so Google sign-in completes back at /dispatch/todo
 * and looks broken. This route fixes both the post-creation navigation
 * and the OAuth round-trip from a single place.
 *
 * Built-in template fallback: when no workspace manifest is available
 * (framework dev with each template on its own port, hosted dispatch with
 * no sibling apps), redirect to the matching first-party template's deploy
 * URL — `http://localhost:<devPort>` in dev, `https://<id>.agent-native.com`
 * in production. Without this, a user visiting `/forms` on dispatch is
 * forced to sign in (auth guard) and then lands on this route's "Page not
 * found" pane after the post-login reload.
 *
 * `appId === "dispatch"` short-circuit: when the segment matches Dispatch
 * itself (e.g. `/dispatch/dispatch`), we go straight to the overview rather
 * than chaining through `/dispatch` (which polled `useActionQuery` re-fired
 * `window.location.assign` against and looped forever in production).
 */
function dispatchSelfRedirect(appId: string | undefined): string | null {
  if (appId === "dispatch") return appPath("/overview");
  return null;
}

export function loader({ params }: LoaderFunctionArgs) {
  const appId = params.appId;
  if (!appId) return null;
  const selfTarget = dispatchSelfRedirect(appId);
  if (selfTarget) throw redirect(selfTarget);
  const target = resolveCatchAllTarget(appId);
  if (target) throw redirect(target);
  return null;
}

export async function clientLoader({
  params,
  serverLoader,
}: ClientLoaderFunctionArgs) {
  const selfTarget = dispatchSelfRedirect(params.appId);
  if (selfTarget) throw redirect(selfTarget);
  // Defer to the server loader so the built-in template fallback runs on
  // SPA navigations too (e.g. clicking a `/<template-id>` link inside
  // dispatch). Without this the client side would only check the workspace
  // apps query, which never lists the static first-party templates and so
  // the user would land on the "Page not found" pane.
  return serverLoader();
}

export default function WorkspaceAppCatchAllRoute() {
  const { appId } = useParams();
  const { data: apps = [], isLoading } = useActionQuery(
    "list-workspace-apps",
    { includeAgentCards: false },
    { refetchInterval: 2_000 },
  );
  const app = useMemo(
    () =>
      (apps as WorkspaceAppSummary[]).find((item) => item.id === appId) ?? null,
    [appId, apps],
  );
  const href = app ? workspaceAppHref(app) : null;
  const isSelfReference = appId === "dispatch";

  useEffect(() => {
    if (isSelfReference) return;
    if (!app || app.status === "pending" || !href) return;
    window.location.assign(href);
  }, [app, href, isSelfReference]);

  if (isSelfReference) {
    return <Navigate to={appPath("/overview")} replace />;
  }

  if ((isLoading && !app) || (app && app.status !== "pending" && href)) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }

  return (
    <DispatchShell
      title={app?.name || "Page not found"}
      description="This route is not in the workspace app list yet."
    >
      <div className="max-w-2xl rounded-lg border bg-card p-5">
        <Button asChild size="sm" variant="ghost" className="-ml-2 mb-4">
          <Link to={appPath("/overview")}>
            <IconArrowLeft size={15} className="mr-1.5" />
            Overview
          </Link>
        </Button>

        {app?.status === "pending" ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">
                {app.name}
              </h2>
              <Badge
                variant="outline"
                className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              >
                <IconClockHour4 size={12} />
                Building
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              This app is being created. It will be available at{" "}
              <span className="font-mono text-foreground">{app.path}</span>{" "}
              after its branch is merged and the workspace deploy finishes.
            </p>
            {app.branchName ? (
              <p className="text-xs text-muted-foreground">
                Branch: {app.branchName}
              </p>
            ) : null}
            {app.builderUrl ? (
              <Button asChild>
                <a href={app.builderUrl} target="_blank" rel="noreferrer">
                  Open Builder branch
                  <IconArrowUpRight size={15} className="ml-1.5" />
                </a>
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              Page not found
            </h2>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono text-foreground">/{appId}</span> isn't
              a Dispatch tab or a workspace app in this workspace.
            </p>
            <Button asChild>
              <Link to={appPath("/apps")}>Browse apps</Link>
            </Button>
          </div>
        )}
      </div>
    </DispatchShell>
  );
}
