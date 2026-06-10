import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import {
  IconArrowLeft,
  IconDatabaseOff,
  IconFileText,
} from "@tabler/icons-react";
import { useActionQuery } from "@agent-native/core/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { PlanContentRenderer } from "@/components/plan/PlanContentRenderer";
import type { PlanVisualSurfaceMode } from "@/components/plan/PlanVisualSurface";
import type { PlanBundle } from "@shared/types";

type LocalPlanResult = PlanBundle & {
  localOnly: true;
  slug: string;
  folder: string;
  html?: string;
  mdx?: {
    "plan.mdx": string;
    "canvas.mdx"?: string;
    "prototype.mdx"?: string;
    ".plan-state.json"?: string;
  };
};

export function meta() {
  return [
    { title: "Local Plan Preview" },
    {
      name: "description",
      content:
        "Preview an Agent-Native Plan from local MDX files without Plan app database writes.",
    },
  ];
}

export function HydrateFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center">
      <Spinner className="size-8 text-foreground" />
    </div>
  );
}

export default function LocalPlanRoute() {
  const params = useParams<{ slug?: string }>();
  const slug = params.slug ?? "";
  const [visualSurfaceMode, setVisualSurfaceMode] =
    useState<PlanVisualSurfaceMode>("none");
  const query = useActionQuery<LocalPlanResult>(
    "get-local-plan-folder",
    { slug },
    { enabled: Boolean(slug), refetchInterval: false },
  );
  const sourceFiles = useMemo(
    () =>
      query.data?.mdx
        ? (Object.keys(query.data.mdx) as Array<keyof LocalPlanResult["mdx"]>)
            .filter((key) => Boolean(query.data?.mdx?.[key]))
            .map((key) => String(key))
        : [],
    [query.data?.mdx],
  );

  if (query.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="size-8 text-foreground" />
      </div>
    );
  }

  if (query.error || !query.data) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 px-6 py-12">
        <Badge variant="outline" className="w-fit gap-2">
          <IconDatabaseOff className="size-4" />
          Local-files mode
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight">
          Local plan not found
        </h1>
        <p className="text-muted-foreground">
          {query.error?.message ??
            "The local MDX folder could not be read from PLAN_LOCAL_DIR."}
        </p>
        <Button asChild variant="outline" className="w-fit gap-2">
          <Link to="/plans">
            <IconArrowLeft className="size-4" />
            Back to plans
          </Link>
        </Button>
      </main>
    );
  }

  const bundle = query.data;
  const content = bundle.plan.content;

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b bg-background/95">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-5 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="gap-2">
                <IconDatabaseOff className="size-4" />
                Local-files mode
              </Badge>
              <Badge variant="outline">
                {bundle.plan.kind === "recap" ? "Visual recap" : "Visual plan"}
              </Badge>
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {bundle.plan.title}
              </h1>
              {bundle.plan.brief && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {bundle.plan.brief}
                </p>
              )}
            </div>
          </div>
          <Button asChild variant="outline" className="gap-2">
            <Link to="/plans">
              <IconArrowLeft className="size-4" />
              Plans
            </Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-5">
        <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2 text-foreground">
            <IconFileText className="size-4" />
            <span className="font-medium">{bundle.folder}</span>
          </div>
          <p className="mt-2">
            This preview is read from local MDX files and does not create, read,
            or update rows in the Plan app database. Editing, comments, sharing,
            publishing, and history are intentionally unavailable here.
          </p>
          {sourceFiles.length > 0 && (
            <p className="mt-2">Loaded files: {sourceFiles.join(", ")}</p>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-12">
        {content ? (
          <PlanContentRenderer
            content={content}
            fallbackTitle={bundle.plan.title}
            fallbackBrief={bundle.plan.brief}
            editingDisabled
            planId={bundle.plan.id}
            isRecap={bundle.plan.kind === "recap"}
            visualSurfaceMode={visualSurfaceMode}
            onVisualSurfaceModeChange={setVisualSurfaceMode}
          />
        ) : bundle.html ? (
          <iframe
            title={bundle.plan.title}
            className="min-h-[70vh] w-full rounded-lg border bg-background"
            sandbox="allow-same-origin"
            srcDoc={bundle.html}
          />
        ) : null}
      </section>
    </main>
  );
}
