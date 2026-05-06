import { useMemo, useState } from "react";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconAlertTriangle,
  IconClipboardList,
  IconDownload,
  IconLoader2,
  IconShieldCheck,
  IconX,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { IMAGE_MODELS, type ImageModel } from "../../shared/api";

const RUN_SOURCES = ["chat", "ui", "a2a"] as const;
const RUN_STATUSES = ["pending", "running", "completed", "failed"] as const;

type SourceFilter = (typeof RUN_SOURCES)[number] | "all";
type StatusFilter = (typeof RUN_STATUSES)[number] | "all";
type ModelFilter = ImageModel | "all";

interface AuditRun {
  runId: string;
  libraryId: string;
  libraryTitle: string;
  ownerEmail?: string | null;
  source: string;
  callerAppId?: string | null;
  model: string;
  aspectRatio?: string | null;
  imageSize?: string | null;
  userPrompt: string;
  status: string;
  errorMessage?: string | null;
  childCount: number;
  savedCount: number;
  createdAt: string;
  completedAt?: string | null;
}

export default function AuditPage() {
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [ownerEmail, setOwnerEmail] = useState<string>("");
  const [model, setModel] = useState<ModelFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [callerAppId, setCallerAppId] = useState<string>("");
  const [promptSearch, setPromptSearch] = useState<string>("");
  const [openRunId, setOpenRunId] = useState<string | null>(null);

  // First admin check — gates the whole page.
  const { data: adminCheck, isLoading: adminLoading } = useActionQuery(
    "is-audit-admin",
    {},
  ) as { data: { allowed?: boolean } | undefined; isLoading: boolean };

  const queryArgs = useMemo(
    () => ({
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      ownerEmail: ownerEmail.trim() || undefined,
      model: model === "all" ? undefined : model,
      status: status === "all" ? undefined : status,
      source: source === "all" ? undefined : source,
      callerAppId: callerAppId.trim() || undefined,
      promptSearch: promptSearch.trim() || undefined,
      limit: 50,
    }),
    [
      dateFrom,
      dateTo,
      ownerEmail,
      model,
      status,
      source,
      callerAppId,
      promptSearch,
    ],
  );
  const { data, isLoading, error } = useActionQuery(
    "list-audit-runs",
    queryArgs as any,
    {
      enabled: adminCheck?.allowed === true,
    } as any,
  ) as {
    data:
      | {
          count: number;
          runs: AuditRun[];
          scope: { orgScoped: boolean; ownerScoped: boolean };
          hasMore: boolean;
        }
      | undefined;
    isLoading: boolean;
    error: any;
  };

  const exportCsv = useActionMutation("export-audit-csv");

  if (adminLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!adminCheck?.allowed) {
    return <ForbiddenPage />;
  }

  function clearFilters() {
    setDateFrom("");
    setDateTo("");
    setOwnerEmail("");
    setModel("all");
    setStatus("all");
    setSource("all");
    setCallerAppId("");
    setPromptSearch("");
  }

  function handleExport() {
    const from = dateFrom || isoDaysAgo(90);
    const to = dateTo || nowIsoDateOnly();
    exportCsv.mutate(
      {
        ...queryArgs,
        dateFrom: from,
        dateTo: to,
      } as any,
      {
        onSuccess: (result: any) => {
          if (result?.downloadUrl) {
            window.open(result.downloadUrl, "_blank", "noopener");
          }
        },
      },
    );
  }

  const runs = data?.runs ?? [];
  const ownerScoped = data?.scope?.ownerScoped;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border bg-card/40 px-6 py-4">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <IconClipboardList className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-xl font-semibold tracking-tight">
                Audit log
              </h1>
              {ownerScoped ? (
                <Badge variant="outline" className="ml-1">
                  Owner-only fallback
                </Badge>
              ) : (
                <Badge variant="secondary" className="ml-1">
                  Org-wide
                </Badge>
              )}
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {ownerScoped
                ? "No org context detected, so this view is restricted to runs you triggered. Org admins see the full org-wide audit feed."
                : "Viewing org-wide audit data. This is intended for governance review only — every generation across the workspace is listed below."}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={exportCsv.isPending}
            className="cursor-pointer gap-2"
          >
            <IconDownload className="h-4 w-4" />
            {exportCsv.isPending ? "Exporting…" : "Export CSV"}
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <FilterField label="Date from">
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </FilterField>
          <FilterField label="Date to">
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </FilterField>
          <FilterField label="Owner email">
            <Input
              value={ownerEmail}
              placeholder="user@example.com"
              onChange={(e) => setOwnerEmail(e.target.value)}
            />
          </FilterField>
          <FilterField label="Prompt search">
            <Input
              value={promptSearch}
              placeholder="cold-start latency"
              onChange={(e) => setPromptSearch(e.target.value)}
            />
          </FilterField>
          <FilterField label="Model">
            <Select
              value={model}
              onValueChange={(v) => setModel(v as ModelFilter)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All models</SelectItem>
                {IMAGE_MODELS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Status">
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as StatusFilter)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {RUN_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Source">
            <Select
              value={source}
              onValueChange={(v) => setSource(v as SourceFilter)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {RUN_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Calling app (A2A)">
            <Input
              value={callerAppId}
              placeholder="slides"
              onChange={(e) => setCallerAppId(e.target.value)}
            />
          </FilterField>
        </div>

        {hasAnyFilter(queryArgs) && (
          <div className="mt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="cursor-pointer gap-2"
            >
              <IconX className="h-3.5 w-3.5" />
              Clear filters
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {error ? (
          <ErrorBlock error={error} />
        ) : isLoading ? (
          <SkeletonRows />
        ) : runs.length === 0 ? (
          <EmptyState />
        ) : (
          <RunTable runs={runs} onSelect={setOpenRunId} />
        )}
      </div>

      <Sheet
        open={Boolean(openRunId)}
        onOpenChange={(v) => !v && setOpenRunId(null)}
      >
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {openRunId && <RunDetail runId={openRunId} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function RunTable({
  runs,
  onSelect,
}: {
  runs: AuditRun[];
  onSelect: (runId: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2">When</th>
            <th className="px-3 py-2">Owner</th>
            <th className="px-3 py-2">Library</th>
            <th className="px-3 py-2">Source</th>
            <th className="px-3 py-2">Model</th>
            <th className="px-3 py-2">Prompt</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2 text-right">Saved / Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {runs.map((run) => (
            <tr
              key={run.runId}
              onClick={() => onSelect(run.runId)}
              className="cursor-pointer hover:bg-muted/30"
            >
              <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                {formatRelative(run.createdAt)}
              </td>
              <td className="px-3 py-2 align-top text-xs">
                {run.ownerEmail ?? "—"}
              </td>
              <td className="px-3 py-2 align-top text-xs">
                {run.libraryTitle}
              </td>
              <td className="px-3 py-2 align-top">
                <SourceBadge
                  source={run.source}
                  callerAppId={run.callerAppId}
                />
              </td>
              <td className="px-3 py-2 align-top text-xs">{run.model}</td>
              <td className="px-3 py-2 align-top">
                <div className="line-clamp-2 max-w-md text-xs">
                  {run.userPrompt}
                </div>
              </td>
              <td className="px-3 py-2 align-top">
                <StatusPill status={run.status} />
              </td>
              <td className="px-3 py-2 align-top text-right text-xs tabular-nums">
                {run.savedCount} / {run.childCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunDetail({ runId }: { runId: string }) {
  const { data, isLoading, error } = useActionQuery("get-audit-run", {
    runId,
  } as any) as {
    data: any;
    isLoading: boolean;
    error: any;
  };
  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error) return <ErrorBlock error={error} />;
  if (!data) return null;

  const run = data.run;
  const references: any[] = data.references ?? [];
  const children: any[] = data.children ?? [];
  const parentRun = data.parentRun;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              {run.libraryTitle}
            </h2>
            <p className="text-xs text-muted-foreground">
              Run {run.runId.slice(0, 12)}… · {formatRelative(run.createdAt)}
            </p>
          </div>
          <StatusPill status={run.status} />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <SourceBadge source={run.source} callerAppId={run.callerAppId} />
          <Badge variant="outline">{run.model}</Badge>
          {run.aspectRatio && (
            <Badge variant="outline">{run.aspectRatio}</Badge>
          )}
          {run.imageSize && <Badge variant="outline">{run.imageSize}</Badge>}
          {run.ownerEmail && (
            <Badge variant="outline">by {run.ownerEmail}</Badge>
          )}
        </div>
      </div>

      <Section title="User prompt">
        <p className="whitespace-pre-wrap text-sm">{run.userPrompt}</p>
      </Section>

      {run.compiledPrompt && (
        <Section title="Compiled prompt">
          <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
            {run.compiledPrompt}
          </pre>
        </Section>
      )}

      {run.errorMessage && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <div className="flex items-center gap-2 font-medium">
            <IconAlertTriangle className="h-4 w-4" />
            Failed
          </div>
          <p className="mt-1 text-xs">{run.errorMessage}</p>
        </div>
      )}

      {parentRun && (
        <Section title="Parent run (refinement source)">
          <div className="rounded-md border border-border p-3 text-xs">
            <div className="font-medium">{parentRun.prompt}</div>
            <div className="mt-1 text-muted-foreground">
              {parentRun.model} · {formatRelative(parentRun.createdAt)}
            </div>
          </div>
        </Section>
      )}

      {references.length > 0 && (
        <Section title={`References (${references.length})`}>
          <div className="grid grid-cols-3 gap-2">
            {references.map((ref) => (
              <AssetThumb key={ref.id} asset={ref} label={ref.role} />
            ))}
          </div>
        </Section>
      )}

      <Section title={`Generated children (${children.length})`}>
        {children.length === 0 ? (
          <p className="text-xs text-muted-foreground">No children produced.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {children.map((c) => (
              <AssetThumb key={c.id} asset={c} label={c.status} />
            ))}
          </div>
        )}
      </Section>

      <Separator />
      <div>
        <a
          href={`/library/${run.libraryId}`}
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          Open library →
        </a>
      </div>
    </div>
  );
}

function AssetThumb({ asset, label }: { asset: any; label?: string }) {
  return (
    <a
      href={`/image/${asset.id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="group block overflow-hidden rounded-md border border-border bg-card"
    >
      <div className="aspect-square bg-muted">
        {asset.thumbnailUrl ? (
          <img
            src={asset.thumbnailUrl}
            alt={asset.altText || asset.title || ""}
            className="h-full w-full object-cover transition group-hover:scale-[1.02]"
          />
        ) : null}
      </div>
      {label && (
        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
      )}
    </a>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function SourceBadge({
  source,
  callerAppId,
}: {
  source: string;
  callerAppId?: string | null;
}) {
  if (source === "a2a") {
    return (
      <Badge variant="outline" className="capitalize">
        via {callerAppId || "a2a"}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="capitalize">
      {source}
    </Badge>
  );
}

function StatusPill({ status }: { status: string }) {
  const variant: "secondary" | "outline" | "destructive" =
    status === "completed"
      ? "secondary"
      : status === "failed"
        ? "destructive"
        : "outline";
  return (
    <Badge variant={variant} className="capitalize">
      {status}
    </Badge>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-md border border-dashed border-border bg-muted/20 p-8 text-center">
      <IconShieldCheck className="h-10 w-10 text-muted-foreground" />
      <h2 className="mt-3 text-base font-semibold">
        No runs match these filters
      </h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Try widening the date range or clearing filters. Generation runs from
        the last 90 days are typically a good starting view.
      </p>
    </div>
  );
}

function ErrorBlock({ error }: { error: any }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
      <div className="flex items-center gap-2 font-medium">
        <IconAlertTriangle className="h-4 w-4" />
        Could not load audit log
      </div>
      <p className="mt-1 text-xs">
        {error?.message || "Unknown error. Try refreshing."}
      </p>
    </div>
  );
}

function ForbiddenPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
      <IconAlertTriangle className="h-10 w-10 text-muted-foreground" />
      <h1 className="mt-4 text-xl font-semibold">Audit log is admin-only</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Only org admins can view the audit log. If you believe you should have
        access, ask an org owner to upgrade your role.
      </p>
    </div>
  );
}

function nowIsoDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days: number): string {
  const t = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(t).toISOString().slice(0, 10);
}

function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const diffMs = Date.now() - ts;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return iso.slice(0, 10);
}

function hasAnyFilter(args: Record<string, unknown>): boolean {
  return Object.entries(args).some(
    ([k, v]) => k !== "limit" && v !== undefined && v !== "",
  );
}
