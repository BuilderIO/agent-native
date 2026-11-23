import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconChevronDown } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CellContents } from "@/lib/model/contracts";

import type { PublishPreview } from "./PublishProjectDialog";
import { toNotebookError } from "./utils";

function config(contents: CellContents) {
  const { id: _id, order: _order, kind, ...settings } = contents;
  return [
    `cellType: ${kind.toUpperCase()}`,
    ...Object.entries(settings).map(
      ([key, value]) => `${key}: ${JSON.stringify(value)}`,
    ),
  ].join("\n");
}

function display(contents: CellContents) {
  if (contents.kind === "sql" || contents.kind === "code")
    return contents.source;
  if (contents.kind === "markdown") return contents.markdown;
  if (contents.kind === "text") return contents.text;
  if (contents.kind === "input") return contents.defaultValueString;
  return contents.label;
}

export function PublishNotebookDiff({ preview }: { preview: PublishPreview }) {
  const t = useT();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [next, setNext] = useState<Pick<
    PublishPreview,
    "diff" | "nextDiffCursor"
  > | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = next ? [...preview.diff, ...next.diff] : preview.diff;
  const cursor = next ? next.nextDiffCursor : preview.nextDiffCursor;
  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const more = await callAction<PublishPreview>(
        "get-project-publish-preview",
        {
          projectId: preview.projectId,
          previewId: preview.previewId,
          diffAfter: cursor,
        },
        { method: "GET" },
      );
      setNext((current) => ({
        diff: [...(current?.diff ?? []), ...more.diff],
        nextDiffCursor: more.nextDiffCursor,
      }));
    } catch (cause) {
      setError(toNotebookError(cause).message);
    } finally {
      setLoading(false);
    }
  }
  const all = (open: boolean) =>
    setExpanded(Object.fromEntries(rows.map(({ cellId }) => [cellId, open])));
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{t("publishedApp.currentVersion")}</h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              {t("publishedApp.resetView")}
              <IconChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setExpanded({})}>
              {t("publishedApp.expandChanged")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => all(true)}>
              {t("publishedApp.expandAll")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => all(false)}>
              {t("publishedApp.collapseAll")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {rows.map(({ cellId, previous, current, changes }) => (
        <details
          className="rounded-md border"
          key={cellId}
          open={expanded[cellId] ?? changes.length > 0}
        >
          <summary
            className="cursor-pointer px-3 py-2"
            onClick={(event) => {
              event.preventDefault();
              setExpanded((state) => ({
                ...state,
                [cellId]: !(state[cellId] ?? changes.length > 0),
              }));
            }}
          >
            <span className="me-2 text-sm">
              {current?.label ??
                previous?.label ??
                current?.kind ??
                previous?.kind}
            </span>
            {changes.map((change) => (
              <span
                key={change}
                className="me-2 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
              >
                {t(`publishedApp.diff.${change}`)}
              </span>
            ))}
          </summary>
          <Tabs defaultValue="display" className="border-t p-3">
            <TabsList>
              <TabsTrigger value="display">
                {t("publishedApp.display")}
              </TabsTrigger>
              <TabsTrigger value="config">
                {t("publishedApp.config")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="display" className="mt-2">
              <DiffValues
                previous={previous}
                current={current}
                showPrevious={Boolean(preview.compared)}
                render={display}
              />
            </TabsContent>
            <TabsContent value="config" className="mt-2">
              <DiffValues
                previous={previous}
                current={current}
                showPrevious={Boolean(preview.compared)}
                render={config}
              />
            </TabsContent>
          </Tabs>
        </details>
      ))}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {cursor ? (
        <Button
          type="button"
          variant="outline"
          disabled={loading}
          aria-busy={loading}
          onClick={() => void loadMore()}
        >
          {t("publishedApp.loadMoreChanges")}
        </Button>
      ) : null}
    </section>
  );
}

function DiffValues({
  previous,
  current,
  showPrevious,
  render,
}: {
  previous: CellContents | null;
  current: CellContents | null;
  showPrevious: boolean;
  render: (contents: CellContents) => string | null;
}) {
  const t = useT();
  return (
    <div className={showPrevious ? "grid gap-2 md:grid-cols-2" : "grid gap-2"}>
      {showPrevious ? (
        <div className="min-w-0 rounded-sm bg-destructive/10 p-2">
          <p className="text-xs text-muted-foreground">
            {t("publishedApp.publishedVersion")}
          </p>
          <pre className="mt-1 whitespace-pre-wrap break-words text-xs">
            {previous ? render(previous) : null}
          </pre>
        </div>
      ) : null}
      <div className="min-w-0 rounded-sm bg-accent p-2">
        <p className="text-xs text-muted-foreground">
          {t("publishedApp.currentVersion")}
        </p>
        <pre className="mt-1 whitespace-pre-wrap break-words text-xs">
          {current ? render(current) : null}
        </pre>
      </div>
    </div>
  );
}
