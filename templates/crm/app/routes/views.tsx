import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import { IconBookmark, IconPlus } from "@tabler/icons-react";
import { Link } from "react-router";

import {
  LoadingRows,
  PageHeader,
  SetupEmptyState,
} from "@/components/crm/Surface";
import { asText, type CrmSavedView } from "@/lib/types";

function savedViews(data: unknown): CrmSavedView[] {
  const entries = Array.isArray(data)
    ? data
    : data &&
        typeof data === "object" &&
        Array.isArray((data as { views?: unknown[] }).views)
      ? (data as { views: unknown[] }).views
      : [];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const id = asText(item.id) ?? asText(item.viewId);
    const name = asText(item.name);
    return id && name
      ? [
          {
            id,
            name,
            kind:
              item.kind === "account" ||
              item.kind === "person" ||
              item.kind === "opportunity"
                ? item.kind
                : undefined,
            query: asText(item.query),
          },
        ]
      : [];
  });
}

export default function SavedViewsRoute() {
  const viewsQuery = useActionQuery<unknown>(
    "list-crm-saved-views" as never,
    {} as never,
  );
  const saveView = useActionMutation("save-crm-saved-view" as never);
  const views = savedViews(viewsQuery.data);
  return (
    <>
      <PageHeader
        eyebrow="CRM"
        title="Saved views"
        description="Reusable, permission-aware slices of your connected records."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={saveView.isPending}
            onClick={() => saveView.mutate({ name: "Untitled view" } as never)}
          >
            <IconPlus className="size-4" />
            New view
          </Button>
        }
      />
      {viewsQuery.isLoading ? (
        <LoadingRows rows={5} />
      ) : views.length ? (
        <div className="grid gap-2 p-5 sm:grid-cols-2 sm:p-7 xl:grid-cols-3">
          {views.map((view) => (
            <Link
              key={view.id}
              to={`/${view.kind === "person" ? "people" : view.kind === "opportunity" ? "opportunities" : "accounts"}?view=${encodeURIComponent(view.id)}`}
              className="group rounded-lg border border-border/70 bg-card p-4 transition-colors hover:bg-muted/50"
            >
              <div className="flex items-start gap-3">
                <IconBookmark className="mt-0.5 size-4 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{view.name}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {view.query || "Saved CRM view"}
                  </p>
                  {view.kind ? (
                    <Badge
                      variant="secondary"
                      className="mt-3 capitalize font-normal"
                    >
                      {view.kind}s
                    </Badge>
                  ) : null}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <SetupEmptyState
          title="No saved views yet"
          description="Create a focused view after your CRM connection has records to explore."
        />
      )}
    </>
  );
}
