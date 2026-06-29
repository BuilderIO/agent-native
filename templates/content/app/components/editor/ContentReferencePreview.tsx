import { IconExternalLink, IconFileText } from "@tabler/icons-react";
import { lazy, Suspense, useMemo } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { useDocument, useDocuments } from "@/hooks/use-documents";
import { cn } from "@/lib/utils";

const ReadonlyReferenceEditor = lazy(async () => {
  const module = await import("./VisualEditor");
  return { default: module.VisualEditor };
});

function trimSlashes(path: string) {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function dirname(path: string) {
  const normalized = trimSlashes(path);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

function normalizePathParts(path: string) {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

export function resolveContentReferencePath(
  sourcePath: string | null | undefined,
  currentPath?: string | null,
) {
  if (typeof sourcePath !== "string" || !sourcePath.trim()) return null;
  const normalized = sourcePath.replace(/\\/g, "/").trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) return null;
  const base =
    normalized.startsWith("./") || normalized.startsWith("../")
      ? dirname(currentPath ?? "")
      : "";
  return normalizePathParts(base ? `${base}/${normalized}` : normalized);
}

export function ContentReferencePreview({
  sourcePath,
  currentPath,
  title,
  className,
}: {
  sourcePath?: string | null;
  currentPath?: string | null;
  title?: string | null;
  className?: string;
}) {
  const navigate = useNavigate();
  const documentsQuery = useDocuments();
  const resolvedPath = useMemo(
    () => resolveContentReferencePath(sourcePath, currentPath),
    [currentPath, sourcePath],
  );
  const document = useMemo(() => {
    if (!resolvedPath) return null;
    return (documentsQuery.data ?? []).find(
      (candidate) =>
        candidate.source?.mode === "local-files" &&
        trimSlashes(candidate.source.path ?? "") === resolvedPath,
    );
  }, [documentsQuery.data, resolvedPath]);
  const documentQuery = useDocument(document?.id ?? null);
  const body = documentQuery.data?.content ?? "";
  const displayTitle =
    title?.trim() ||
    documentQuery.data?.title ||
    document?.title ||
    "Reference";

  return (
    <section
      className={cn(
        "content-reference-preview my-4 rounded-md border border-dashed bg-muted/20 text-sm",
        className,
      )}
      data-content-reference={resolvedPath ?? sourcePath ?? ""}
    >
      <div className="flex min-h-10 items-center gap-2 border-b px-3 py-2">
        <IconFileText className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground">
            {displayTitle}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {resolvedPath ?? sourcePath ?? "Reference path missing"}
          </div>
        </div>
        {document ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 px-2 text-xs"
            onClick={() =>
              navigate(`/page/${document.id}`, { flushSync: true })
            }
          >
            <IconExternalLink className="size-3.5" />
            Open
          </Button>
        ) : null}
      </div>
      <div className="max-h-[520px] overflow-auto px-3 py-3">
        {!resolvedPath ? (
          <div className="text-sm text-muted-foreground">
            Reference path missing or unsupported.
          </div>
        ) : documentsQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">
            Loading reference...
          </div>
        ) : !document ? (
          <div className="text-sm text-muted-foreground">
            Referenced document not found.
          </div>
        ) : documentQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">
            Loading reference...
          </div>
        ) : documentQuery.isError ? (
          <div className="text-sm text-muted-foreground">
            Could not load referenced document.
          </div>
        ) : body.trim() ? (
          <Suspense
            fallback={
              <div className="text-sm text-muted-foreground">
                Loading reference...
              </div>
            }
          >
            <ReadonlyReferenceEditor
              key={document.id}
              documentId={document.id}
              content={body}
              onChange={() => {}}
              editable={false}
              localFileMode
              localFilePath={resolvedPath}
            />
          </Suspense>
        ) : (
          <div className="text-sm text-muted-foreground">
            Referenced document is empty.
          </div>
        )}
      </div>
    </section>
  );
}
