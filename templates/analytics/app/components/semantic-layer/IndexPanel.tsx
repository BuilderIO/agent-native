import {
  callAction,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { useOrgRole } from "@agent-native/core/client/org";
import { actionErrorMessage } from "@agent-native/core/client/use-action";
import { saveApiKeyValue } from "@agent-native/toolkit/app/settings/api-keys/api-keys-client";
import {
  IconAlertCircle,
  IconCheck,
  IconDownload,
  IconLoader2,
  IconRefresh,
  IconUpload,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  collectDictionaryEntries,
  DICTIONARY_EXPORT_PAGE_SIZE,
  dictionaryEntriesToCsv,
  DictionaryExportError,
} from "@/lib/data-dictionary-export";
import { getDataSourceById } from "@/lib/data-sources";

import type {
  BrainOverview,
  BrainSource,
  BrainSourceStatus,
  IndexRunStatus,
  IndexRunSummary,
  IndexSchedule,
} from "../../../server/lib/brain-contract";
// Pure module (no server imports), so the client shares the server's checks.
import {
  DBT_SEMANTIC_LAYER_TOKEN_KEY,
  validateEnvironmentId,
  validateSemanticLayerBaseUrl,
} from "../../../server/lib/dbt-connection";
import type { SourceIndexBundle } from "../../../server/lib/source-index-schema";

type Translate = ReturnType<typeof useT>;

const DEFAULT_TIMEZONE = "UTC";
const SOURCE_INDEX_MAX_BYTES = 750_000;
const RUN_HISTORY_LIMIT = 10;
const DBT_SOURCE_ID = "dbt";
// Placeholder only: a real host is never prefilled.
const DBT_SEMANTIC_LAYER_URL_PLACEHOLDER =
  "https://<your-host>.semantic-layer.<region>.dbt.com";

interface DbtRepository {
  owner: string;
  repo: string;
}

interface DbtConnection {
  connected: boolean;
  connectionId: string | null;
  status:
    | "connected"
    | "checking"
    | "needs_reauth"
    | "error"
    | "disabled"
    | null;
  environmentId: string | null;
  semanticLayerBaseUrl: string | null;
  tokenConfigured: boolean;
  canManage: boolean;
}

interface DbtConnectionFields {
  environmentId: string;
  semanticLayerBaseUrl: string;
}

type IndexStatusAvailable = {
  status: "available";
  generatedAt: string;
  entryCount: number;
  unresolvedTrackingCallSites: number | null;
  sources: Array<{ id: string; revision?: string }>;
  sourceCounts?: Array<{ source: string; entryCount: number }>;
  ageDays: number;
  staleAfterDays: number;
  stale: boolean;
};

type IndexStatus =
  | IndexStatusAvailable
  | { status: "not-configured" | "unavailable" | "invalid" };

interface PendingSourceIndex {
  fileName: string;
  bundle: SourceIndexBundle;
  entryCount: number;
  generatedAt: string;
  sourceIds: string[];
}

interface SourceStatusRow {
  id: string;
  label: string;
  /** Null for a source the saved index counts but the overview does not list. */
  status: BrainSourceStatus | null;
  /** Null when the saved index has no count for this source. */
  entryCount: number | null;
}

const SOURCE_LABELS: Record<string, string> = {
  amplitude: "Amplitude",
  bigquery: "BigQuery",
  dbt: "dbt Cloud",
  dbt_cloud: "dbt Cloud",
  dbt_semantic_layer: "dbt Cloud",
  github: "GitHub",
  sigma: "Sigma",
};

function indexStatusMessage(
  status: IndexStatus | undefined,
  failed: boolean,
  t: Translate,
): string | null {
  if (failed || !status) return t("dataStatus.indexReadFailed");
  if (status.status === "invalid") return t("dataStatus.indexUnreadable");
  if (status.status === "unavailable") return t("dataStatus.indexReadFailed");
  if (status.status === "not-configured") {
    return t("dataStatus.indexNotImported");
  }
  return null;
}

function sourceStatusRows(
  sources: BrainSource[],
  indexCounts: Array<{ source: string; entryCount: number }>,
): SourceStatusRow[] {
  const counts = new Map(
    indexCounts.map(({ source, entryCount }) => [source, entryCount]),
  );
  const rows: SourceStatusRow[] = sources.map((source) => ({
    id: source.id,
    label: source.label,
    status: source.status,
    entryCount: counts.get(source.id) ?? null,
  }));
  const listed = new Set(sources.map(({ id }) => id));
  for (const [id, entryCount] of counts) {
    if (!listed.has(id)) {
      rows.push({
        id,
        label: SOURCE_LABELS[id] ?? id,
        status: null,
        entryCount,
      });
    }
  }
  return rows;
}

function sourceStateLabel(status: BrainSourceStatus, t: Translate): string {
  switch (status) {
    case "connected":
      return t("dataStatus.connected");
    case "not-connected":
      return t("dataStatus.notConnected");
    case "needs-reauth":
      return t("dataStatus.needsReauth");
    case "error":
      return t("dataStatus.error");
  }
}

function schedulePresets(t: Translate, cron: string) {
  const presets = [
    {
      cron: "0 6 * * *",
      label: t("indexPanel.presetDaily"),
    },
    {
      cron: "0 6 * * 1-5",
      label: t("indexPanel.presetWeekdays"),
    },
    {
      cron: "0 6 * * 1",
      label: t("indexPanel.presetWeekly"),
    },
  ];
  // A cron saved outside the presets keeps its own option, since the Select
  // cannot display a value that has no matching item.
  return presets.some((preset) => preset.cron === cron)
    ? presets
    : [...presets, { cron, label: cron }];
}

function downloadCsv(csv: string) {
  const fileName = `analytics-data-dictionary-${new Date().toISOString().slice(0, 10)}.csv`;
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function RowsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}

function SettingRow({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border/60 py-3 last:border-b-0 last:pb-0">
      <Label htmlFor={htmlFor} className="min-w-0 text-sm font-normal">
        {label}
      </Label>
      <div className="flex min-w-0 items-center justify-end gap-2">
        {children}
      </div>
    </div>
  );
}

function SourceStatusRowView({
  row,
  open,
  onToggle,
}: {
  row: SourceStatusRow;
  /** Set on the dbt row, whose connection form opens below the rows. */
  open?: boolean;
  onToggle?: () => void;
}) {
  const t = useT();
  const formatters = useFormatters();
  const actionLabel =
    row.status === "needs-reauth"
      ? t("dataSources.reconnect")
      : row.status === "connected" || row.status === "error"
        ? t("dataSources.manage")
        : t("dataSources.connect");
  // Only sources with a data-source card have a page to act on.
  const showLink =
    row.status !== null &&
    row.status !== "connected" &&
    getDataSourceById(row.id) !== undefined;

  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border/60 py-3 last:border-b-0 last:pb-0">
      <span className="min-w-0 truncate text-sm">{row.label}</span>
      <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2">
        {row.status !== null ? (
          <Badge variant="outline" className="font-normal">
            {sourceStateLabel(row.status, t)}
          </Badge>
        ) : null}
        {row.entryCount !== null ? (
          <span className="text-sm tabular-nums text-muted-foreground">
            {formatters.formatNumber(row.entryCount)}
          </span>
        ) : null}
        {onToggle ? (
          <Button
            size="sm"
            variant="outline"
            aria-expanded={open}
            onClick={onToggle}
          >
            {actionLabel}
          </Button>
        ) : showLink ? (
          <Button asChild size="sm" variant="outline">
            <Link to={`/data-sources?source=${row.id}`}>{actionLabel}</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function StatusSection() {
  const t = useT();
  const formatters = useFormatters();
  const [dbtOpen, setDbtOpen] = useState(false);
  const indexQuery = useActionQuery(
    "get-data-dictionary-index-status",
    undefined,
    { retry: false, staleTime: 30_000 },
  );
  const overviewQuery = useActionQuery("get-brain-overview", undefined, {
    retry: false,
    staleTime: 30_000,
  });
  const status = indexQuery.data as IndexStatus | undefined;
  const overview = overviewQuery.data as BrainOverview | undefined;
  const title = t("indexPanel.status");

  if (
    (indexQuery.isLoading && !status) ||
    (overviewQuery.isLoading && !overview)
  ) {
    return (
      <Section title={title}>
        <RowsSkeleton rows={3} />
      </Section>
    );
  }

  const message = indexStatusMessage(status, indexQuery.isError, t);
  const available = status?.status === "available" ? status : null;
  const rows = sourceStatusRows(
    overview?.sources ?? [],
    available?.sourceCounts ?? [],
  );

  return (
    <Section title={title}>
      <div className="flex flex-col">
        {available ? (
          <SettingRow label={t("dataStatus.freshness")}>
            <Badge variant="outline">
              {t(available.stale ? "dataStatus.stale" : "dataStatus.fresh", {
                age: formatters.formatRelativeTime(-available.ageDays, "day"),
              })}
            </Badge>
            <Badge variant="outline">
              {t("dataStatus.generatedUnapproved")}
            </Badge>
          </SettingRow>
        ) : null}
        {available ? (
          <SettingRow label={t("indexPanel.unresolvedTrackingCallSites")}>
            <span className="text-sm tabular-nums text-muted-foreground">
              {available.unresolvedTrackingCallSites === null
                ? t("indexPanel.unresolvedTrackingCallSitesUnavailable")
                : formatters.formatNumber(
                    available.unresolvedTrackingCallSites,
                  )}
            </span>
          </SettingRow>
        ) : null}
        {rows.map((row) =>
          row.id === DBT_SOURCE_ID ? (
            <SourceStatusRowView
              key={row.id}
              row={row}
              open={dbtOpen}
              onToggle={() => setDbtOpen((current) => !current)}
            />
          ) : (
            <SourceStatusRowView key={row.id} row={row} />
          ),
        )}
      </div>
      {available ? (
        <p role="note" className="text-sm text-muted-foreground">
          {t("indexPanel.dynamicTrackingCoverageCaveat")}
        </p>
      ) : null}
      {dbtOpen ? <DbtConnectionSection /> : null}
      {available && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("dataStatus.noSourceEntries")}
        </p>
      ) : null}
      {message ? (
        <p
          role={indexQuery.isError ? "alert" : "status"}
          className={
            indexQuery.isError
              ? "text-sm text-destructive"
              : "text-sm text-muted-foreground"
          }
        >
          {message}
        </p>
      ) : null}
      {overviewQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("indexPanel.overviewFailed")}
        </p>
      ) : null}
    </Section>
  );
}

function BuildSection() {
  const t = useT();
  const overviewQuery = useActionQuery("get-brain-overview", undefined, {
    retry: false,
    staleTime: 30_000,
  });
  const build = useActionMutation("build-data-index");
  const overview = overviewQuery.data as BrainOverview | undefined;
  const building = build.isPending || overview?.index.state === "running";

  return (
    <Section title={t("indexPanel.build")}>
      <div className="flex flex-col items-start gap-2">
        <Button
          size="sm"
          disabled={building}
          onClick={() => build.mutate({ trigger: "manual" })}
        >
          {building ? (
            <Spinner className="size-4" />
          ) : (
            <IconRefresh aria-hidden="true" className="size-4" />
          )}
          {building ? t("indexPanel.building") : t("indexPanel.buildNow")}
        </Button>
        {build.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {actionErrorMessage(build.error) ?? t("indexPanel.buildFailed")}
          </p>
        ) : null}
      </div>
    </Section>
  );
}

function ScheduleSection() {
  const t = useT();
  const queryClient = useQueryClient();
  const { canManageOrg } = useOrgRole();
  const enabledId = useId();
  const frequencyId = useId();
  const timezoneId = useId();
  const query = useActionQuery("get-index-schedule", undefined, {
    retry: false,
    staleTime: 30_000,
  });
  const save = useActionMutation("set-index-schedule");
  const saved = query.data as IndexSchedule | undefined;
  // Keyed on the saved value, not dataUpdatedAt: saving the other form
  // invalidates every action query, and that must not drop this unsaved edit.
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState<{
    basedOn: string;
    schedule: IndexSchedule;
  } | null>(null);
  const draftSchedule =
    draft && draft.basedOn === savedKey ? draft.schedule : null;
  const shown = draftSchedule ?? saved;
  const title = t("indexPanel.schedule");

  if (!shown) {
    return (
      <Section title={title}>
        {query.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t("indexPanel.scheduleReadFailed")}
          </p>
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
      </Section>
    );
  }

  const presets = schedulePresets(t, shown.cron);
  const presetLabel =
    presets.find((preset) => preset.cron === shown.cron)?.label ?? shown.cron;
  const enabledLabel = t("indexPanel.scheduleEnabled");
  const frequencyLabel = t("indexPanel.frequency");
  const timezoneLabel = t("indexPanel.timezone");

  if (!canManageOrg) {
    return (
      <Section title={title}>
        <div className="flex flex-col">
          <SettingRow label={enabledLabel}>
            <Badge variant="outline">
              {shown.enabled ? t("indexPanel.on") : t("indexPanel.off")}
            </Badge>
          </SettingRow>
          <SettingRow label={frequencyLabel}>
            <span className="text-sm">{presetLabel}</span>
          </SettingRow>
          <SettingRow label={timezoneLabel}>
            <span className="text-sm">{shown.timezone}</span>
          </SettingRow>
        </div>
      </Section>
    );
  }

  const update = (patch: Partial<IndexSchedule>) =>
    setDraft({
      basedOn: savedKey,
      schedule: { ...shown, ...patch },
    });
  const timezone = shown.timezone.trim();

  return (
    <Section title={title}>
      <div className="flex flex-col">
        <SettingRow label={enabledLabel} htmlFor={enabledId}>
          <Switch
            id={enabledId}
            checked={shown.enabled}
            disabled={save.isPending}
            onCheckedChange={(enabled) => update({ enabled })}
          />
        </SettingRow>
        <SettingRow label={frequencyLabel} htmlFor={frequencyId}>
          <Select
            value={shown.cron}
            disabled={save.isPending}
            onValueChange={(cron) => update({ cron })}
          >
            <SelectTrigger id={frequencyId} className="w-56 max-w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {presets.map((preset) => (
                <SelectItem key={preset.cron} value={preset.cron}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow label={timezoneLabel} htmlFor={timezoneId}>
          <Input
            id={timezoneId}
            value={shown.timezone}
            disabled={save.isPending}
            placeholder={DEFAULT_TIMEZONE}
            onChange={(e) => update({ timezone: e.target.value })}
            className="w-40"
          />
        </SettingRow>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {save.isError ? (
          <p role="alert" className="me-auto text-sm text-destructive">
            {actionErrorMessage(save.error) ?? t("indexPanel.scheduleFailed")}
          </p>
        ) : null}
        <Button
          size="sm"
          disabled={save.isPending || !timezone}
          onClick={() =>
            save.mutate(
              { enabled: shown.enabled, cron: shown.cron, timezone },
              {
                onSuccess: (next) => {
                  // Write the saved schedule into the cache now so the previous
                  // value does not flash back while the refetch runs.
                  queryClient.setQueriesData<IndexSchedule>(
                    { queryKey: ["action", "get-index-schedule"] },
                    next as IndexSchedule,
                  );
                  setDraft(null);
                },
              },
            )
          }
        >
          {save.isPending ? <Spinner className="size-4" /> : null}
          {save.isPending
            ? t("indexPanel.saving")
            : t("indexPanel.saveSchedule")}
        </Button>
      </div>
    </Section>
  );
}

function DbtRepositorySection() {
  const t = useT();
  const queryClient = useQueryClient();
  const { canManageOrg } = useOrgRole();
  const query = useActionQuery("get-dbt-repository", undefined, {
    retry: false,
    staleTime: 30_000,
  });
  const save = useActionMutation("set-dbt-repository");
  const saved = query.data as DbtRepository | null | undefined;
  // Keyed on the saved value so a save elsewhere does not drop this unsaved edit.
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState<{
    basedOn: string;
    repository: DbtRepository;
  } | null>(null);
  const draftRepository =
    draft && draft.basedOn === savedKey ? draft.repository : null;
  const title = t("indexPanel.dbtRepository");
  const ownerLabel = t("dataDictionary.owner");
  const repoLabel = t("indexPanel.repository");

  if (saved === undefined) {
    return (
      <Section title={title}>
        {query.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t("indexPanel.repositoryReadFailed")}
          </p>
        ) : (
          <Skeleton className="h-16 w-full" />
        )}
      </Section>
    );
  }

  const shown: DbtRepository = draftRepository ??
    saved ?? {
      owner: "",
      repo: "",
    };
  const update = (patch: Partial<DbtRepository>) =>
    setDraft({
      basedOn: savedKey,
      repository: { ...shown, ...patch },
    });

  if (!canManageOrg) {
    return (
      <Section title={title}>
        <SettingRow label={repoLabel}>
          <span className="truncate text-sm">
            {shown.owner && shown.repo
              ? `${shown.owner}/${shown.repo}`
              : t("indexPanel.notSet")}
          </span>
        </SettingRow>
      </Section>
    );
  }

  return (
    <Section title={title}>
      <div className="flex flex-col gap-2">
        <div className="data-source-inline-form">
          <Input
            aria-label={ownerLabel}
            placeholder={ownerLabel}
            value={shown.owner}
            disabled={save.isPending}
            onChange={(e) => update({ owner: e.target.value })}
            className="min-w-0 flex-1"
          />
          <Input
            aria-label={repoLabel}
            placeholder={repoLabel}
            value={shown.repo}
            disabled={save.isPending}
            onChange={(e) => update({ repo: e.target.value })}
            className="min-w-0 flex-1"
          />
          <Button
            size="sm"
            className="data-source-inline-form-button"
            disabled={save.isPending}
            onClick={() =>
              save.mutate(
                { owner: shown.owner.trim(), repo: shown.repo.trim() },
                {
                  onSuccess: (next) => {
                    // Write the saved repository into the cache now so the
                    // previous value does not flash back during the refetch.
                    queryClient.setQueriesData<DbtRepository | null>(
                      { queryKey: ["action", "get-dbt-repository"] },
                      next as DbtRepository,
                    );
                    setDraft(null);
                  },
                },
              )
            }
          >
            {save.isPending ? <Spinner className="size-4" /> : null}
            {t("indexPanel.saveRepository")}
          </Button>
        </div>
        {save.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {actionErrorMessage(save.error) ?? t("indexPanel.repositoryFailed")}
          </p>
        ) : null}
      </div>
    </Section>
  );
}

function dbtStatusLabel(connection: DbtConnection, t: Translate): string {
  if (connection.connected) return t("dataStatus.connected");
  switch (connection.status) {
    case "needs_reauth":
      return t("dataStatus.needsReauth");
    case "error":
      return t("dataStatus.error");
    case "checking":
      return t("indexPanel.dbtChecking");
    case "disabled":
      return t("indexPanel.dbtDisabled");
    // A "connected" row whose token was removed is not connected.
    case "connected":
    case null:
      return t("dataStatus.notConnected");
  }
}

function DbtConnectionSection() {
  const t = useT();
  const queryClient = useQueryClient();
  const { canManageOrg, isLoading } = useOrgRole();
  const environmentIdFieldId = useId();
  const semanticLayerUrlFieldId = useId();
  const tokenFieldId = useId();
  const query = useActionQuery("get-dbt-connection", undefined, {
    retry: false,
    staleTime: 30_000,
  });
  const save = useActionMutation("save-dbt-connection");
  const connection = query.data as DbtConnection | undefined;
  // Keyed on the saved value so a save elsewhere does not drop this unsaved edit.
  const savedKey = JSON.stringify(connection);
  const [draft, setDraft] = useState<{
    basedOn: string;
    fields: DbtConnectionFields;
  } | null>(null);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  if (isLoading || (!connection && !query.isError)) {
    return <Skeleton className="h-24 w-full" />;
  }
  if (!connection) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("indexPanel.dbtReadFailed")}
      </p>
    );
  }

  const saved: DbtConnectionFields = {
    environmentId: connection.environmentId ?? "",
    semanticLayerBaseUrl: connection.semanticLayerBaseUrl ?? "",
  };
  const statusLabel = t("indexPanel.dbtStatus");

  if (!canManageOrg) {
    return (
      <div className="flex flex-col">
        <SettingRow label={statusLabel}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline">{dbtStatusLabel(connection, t)}</Badge>
            </TooltipTrigger>
            <TooltipContent>{t("indexPanel.dbtAdminOnly")}</TooltipContent>
          </Tooltip>
        </SettingRow>
        <SettingRow label={t("indexPanel.dbtEnvironmentId")}>
          <span className="truncate text-sm">
            {saved.environmentId || t("indexPanel.notSet")}
          </span>
        </SettingRow>
        <SettingRow label={t("indexPanel.dbtSemanticLayerUrl")}>
          <span className="truncate text-sm">
            {saved.semanticLayerBaseUrl || t("indexPanel.notSet")}
          </span>
        </SettingRow>
      </div>
    );
  }

  const shown = draft && draft.basedOn === savedKey ? draft.fields : saved;
  const update = (patch: Partial<DbtConnectionFields>) =>
    setDraft({
      basedOn: savedKey,
      fields: { ...shown, ...patch },
    });
  const busy = saving || save.isPending;
  const canSave =
    !busy &&
    shown.environmentId.trim() !== "" &&
    shown.semanticLayerBaseUrl.trim() !== "" &&
    (connection.tokenConfigured || token.trim() !== "");

  async function saveConnection() {
    setSaveError("");
    // Checked before the token write: saveApiKeyValue overwrites the stored
    // token, and a bad field would otherwise leave that new token in place.
    const environment = validateEnvironmentId(shown.environmentId);
    if (!environment.ok) {
      setSaveError(environment.message);
      return;
    }
    const baseUrl = validateSemanticLayerBaseUrl(shown.semanticLayerBaseUrl);
    if (!baseUrl.ok) {
      setSaveError(baseUrl.message);
      return;
    }
    setSaving(true);
    try {
      // The token goes to the secrets route, never through an action, so it
      // stays out of agent tool history. It must exist before the connection
      // is saved; save-dbt-connection rejects the save when it does not.
      const value = token.trim();
      if (value) {
        await saveApiKeyValue({
          name: DBT_SEMANTIC_LAYER_TOKEN_KEY,
          value,
          registered: true,
        });
      }
      await save.mutateAsync({
        environmentId: environment.value,
        semanticLayerBaseUrl: baseUrl.value,
      });
      setToken("");
      for (const name of [
        "get-dbt-connection",
        "get-brain-overview",
        "data-source-status",
      ]) {
        void queryClient.invalidateQueries({ queryKey: ["action", name] });
      }
    } catch (error) {
      setSaveError(
        actionErrorMessage(error) ??
          (error instanceof Error && error.message
            ? error.message
            : t("indexPanel.dbtSaveFailed")),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingRow label={statusLabel}>
        <Badge variant="outline">{dbtStatusLabel(connection, t)}</Badge>
      </SettingRow>
      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={environmentIdFieldId}>
          {t("indexPanel.dbtEnvironmentId")}
        </Label>
        <Input
          id={environmentIdFieldId}
          inputMode="numeric"
          autoComplete="off"
          value={shown.environmentId}
          disabled={busy}
          placeholder={t("indexPanel.dbtEnvironmentPlaceholder")}
          onChange={(e) => update({ environmentId: e.target.value })}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={semanticLayerUrlFieldId}>
          {t("indexPanel.dbtSemanticLayerUrl")}
        </Label>
        <Input
          id={semanticLayerUrlFieldId}
          type="url"
          autoComplete="off"
          value={shown.semanticLayerBaseUrl}
          disabled={busy}
          placeholder={DBT_SEMANTIC_LAYER_URL_PLACEHOLDER}
          onChange={(e) => update({ semanticLayerBaseUrl: e.target.value })}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={tokenFieldId}>{t("indexPanel.dbtToken")}</Label>
        <Input
          id={tokenFieldId}
          type="password"
          autoComplete="new-password"
          value={token}
          disabled={busy}
          placeholder={
            connection.tokenConfigured
              ? t("indexPanel.dbtTokenStored")
              : t("indexPanel.dbtTokenPlaceholder")
          }
          onChange={(e) => setToken(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {saveError ? (
          <p role="alert" className="me-auto text-sm text-destructive">
            {saveError}
          </p>
        ) : null}
        <Button
          size="sm"
          disabled={!canSave}
          onClick={() => void saveConnection()}
        >
          {busy ? <Spinner className="size-4" /> : null}
          {busy ? t("indexPanel.saving") : t("indexPanel.dbtSave")}
        </Button>
      </div>
    </div>
  );
}

function runStatusView(status: IndexRunStatus, t: Translate) {
  switch (status) {
    case "running":
      return {
        label: t("indexPanel.runRunning"),
        icon: (
          <IconLoader2
            aria-hidden="true"
            className="size-3.5 animate-spin text-muted-foreground"
          />
        ),
      };
    case "succeeded":
      return {
        label: t("indexPanel.runSucceeded"),
        icon: (
          <IconCheck aria-hidden="true" className="size-3.5 text-foreground" />
        ),
      };
    case "failed":
      return {
        label: t("indexPanel.runFailed"),
        icon: (
          <IconAlertCircle
            aria-hidden="true"
            className="size-3.5 text-destructive"
          />
        ),
      };
  }
}

function RunRow({ run }: { run: IndexRunSummary }) {
  const t = useT();
  const formatters = useFormatters();
  const view = runStatusView(run.status, t);
  const trigger =
    run.trigger === "scheduled"
      ? t("indexPanel.triggerScheduled")
      : t("indexPanel.triggerManual");
  const revisions = Object.entries(run.sourceRevisions).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <li className="flex min-w-0 flex-col gap-1.5 border-b border-border/60 py-3 last:border-b-0 last:pb-0">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <Badge variant="outline" className="shrink-0 gap-1.5 font-normal">
          {view.icon}
          {view.label}
        </Badge>
        <span className="min-w-0 truncate text-xs tabular-nums text-muted-foreground">
          {formatters.formatDate(run.startedAt, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
      </div>
      {revisions.length > 0 ? (
        <ul className="flex min-w-0 flex-col text-xs text-muted-foreground">
          {revisions.map(([id, revision]) => (
            <li key={id} className="min-w-0 break-all font-mono">
              {`${SOURCE_LABELS[id] ?? id} ${revision}`}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        <span>{trigger}</span>
        {run.entryCount !== null ? (
          <span>
            {t("indexPanel.runEntries", {
              count: formatters.formatNumber(run.entryCount),
            })}
          </span>
        ) : null}
      </div>
      {run.error ? (
        <p className="break-words text-xs text-destructive">{run.error}</p>
      ) : null}
    </li>
  );
}

function RunHistorySection() {
  const t = useT();
  const query = useActionQuery(
    "list-index-runs",
    { limit: RUN_HISTORY_LIMIT },
    { retry: false, staleTime: 15_000 },
  );
  const runs = query.data as IndexRunSummary[] | undefined;
  const title = t("indexPanel.runHistory");

  if (query.isError) {
    return (
      <Section title={title}>
        <p role="alert" className="text-sm text-destructive">
          {t("indexPanel.runsReadFailed")}
        </p>
      </Section>
    );
  }
  if (!runs) {
    return (
      <Section title={title}>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </Section>
    );
  }
  if (runs.length === 0) {
    return (
      <Section title={title}>
        <p className="text-sm text-muted-foreground">
          {t("indexPanel.noRuns")}
        </p>
      </Section>
    );
  }
  return (
    <Section title={title}>
      <ul className="flex flex-col">
        {runs.map((run) => (
          <RunRow key={run.id} run={run} />
        ))}
      </ul>
    </Section>
  );
}

function DictionarySection() {
  const t = useT();
  const formatters = useFormatters();
  const { canManageOrg } = useOrgRole();
  const importIndex = useActionMutation("import-data-dictionary-index");
  const fileInput = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [pendingIndex, setPendingIndex] = useState<PendingSourceIndex | null>(
    null,
  );
  const [indexError, setIndexError] = useState("");

  async function exportDictionary() {
    setExportError("");
    setExporting(true);
    try {
      const entries = await collectDictionaryEntries(async (nextPage) =>
        callAction(
          "list-data-dictionary",
          {
            limit: DICTIONARY_EXPORT_PAGE_SIZE,
            ...(nextPage ? { nextPage } : {}),
          },
          { method: "GET" },
        ),
      );
      if (entries.length === 0) {
        setExportError(t("dataStatus.exportEmpty"));
        return;
      }
      downloadCsv(dictionaryEntriesToCsv(entries));
    } catch (error) {
      setExportError(
        error instanceof DictionaryExportError && error.kind === "page_limit"
          ? t("dataStatus.exportLimitReached")
          : t("dataStatus.exportFailed"),
      );
    } finally {
      setExporting(false);
    }
  }

  async function chooseSourceIndex(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setIndexError("");
    if (!file) return;
    if (file.size > SOURCE_INDEX_MAX_BYTES) {
      setIndexError(t("dataDictionary.indexFileInvalid"));
      return;
    }
    try {
      const bundle: unknown = JSON.parse(await file.text());
      if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
        throw new Error("invalid source index");
      }
      const candidate = bundle as Record<string, unknown>;
      const entries = Array.isArray(candidate.entries) ? candidate.entries : [];
      const sources = Array.isArray(candidate.sources) ? candidate.sources : [];
      if (
        candidate.schemaVersion !== 1 ||
        typeof candidate.generatedAt !== "string" ||
        entries.length === 0 ||
        sources.length === 0
      ) {
        throw new Error("invalid source index");
      }
      const sourceIds = sources.flatMap((source) => {
        if (!source || typeof source !== "object") return [];
        const id = (source as Record<string, unknown>).id;
        const revision = (source as Record<string, unknown>).revision;
        return typeof id === "string"
          ? [typeof revision === "string" ? `${id}@${revision}` : id]
          : [];
      });
      setPendingIndex({
        fileName: file.name,
        bundle: bundle as SourceIndexBundle,
        entryCount: entries.length,
        generatedAt: candidate.generatedAt,
        sourceIds,
      });
    } catch {
      setIndexError(t("dataDictionary.indexFileInvalid"));
    }
  }

  async function replaceIndex() {
    if (!pendingIndex) return;
    setIndexError("");
    try {
      await importIndex.mutateAsync({ bundle: pendingIndex.bundle });
      setPendingIndex(null);
    } catch (error) {
      setIndexError(
        actionErrorMessage(error) ?? t("dataDictionary.indexImportFailed"),
      );
    }
  }

  return (
    <Section title={t("indexPanel.dictionary")}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void exportDictionary()}
          disabled={exporting}
        >
          {exporting ? (
            <IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <IconDownload aria-hidden="true" className="size-4" />
          )}
          {exporting
            ? t("dataStatus.exportingDictionary")
            : t("dataStatus.exportDictionary")}
        </Button>
        {/* The server rejects import from non-admins; this gate only hides it. */}
        {canManageOrg ? (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInput.current?.click()}
            >
              <IconUpload aria-hidden="true" className="size-4" />
              {t("dataDictionary.importIndex")}
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              onChange={chooseSourceIndex}
              className="hidden"
            />
          </>
        ) : null}
      </div>
      {exportError ? (
        <p role="alert" className="text-sm text-destructive">
          {exportError}
        </p>
      ) : null}
      {indexError && !pendingIndex ? (
        <p role="alert" className="text-sm text-destructive">
          {indexError}
        </p>
      ) : null}

      <Dialog
        open={!!pendingIndex}
        onOpenChange={(open) => {
          if (!open && !importIndex.isPending) {
            setPendingIndex(null);
            setIndexError("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dataDictionary.replaceIndexTitle")}</DialogTitle>
            <DialogDescription>
              {t("dataDictionary.replaceIndexDescription")}
            </DialogDescription>
          </DialogHeader>
          {pendingIndex ? (
            <div className="space-y-2 text-sm">
              <p className="font-medium">{pendingIndex.fileName}</p>
              <p className="text-muted-foreground">
                {t("dataDictionary.indexPreview", {
                  count: pendingIndex.entryCount,
                  sources: pendingIndex.sourceIds.join(", "),
                  date: formatters.formatDate(pendingIndex.generatedAt, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  }),
                })}
              </p>
            </div>
          ) : null}
          {indexError ? (
            <p role="alert" className="text-sm text-destructive">
              {indexError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingIndex(null)}
              disabled={importIndex.isPending}
            >
              {t("sidebar.cancel")}
            </Button>
            <Button
              disabled={!pendingIndex || importIndex.isPending}
              onClick={() => void replaceIndex()}
            >
              {importIndex.isPending
                ? t("dataDictionary.importingIndex")
                : t("dataDictionary.replaceIndex")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

export function IndexPanel() {
  const { canManageOrg, isLoading } = useOrgRole();

  // Admin controls render only after the org role loads; before that they would
  // show read-only and then flip to editable.
  if (isLoading) {
    return (
      <div className="data-source-card flex min-w-0 flex-col gap-3">
        <RowsSkeleton rows={5} />
      </div>
    );
  }

  return (
    <div className="data-source-card flex min-w-0 flex-col gap-8">
      <StatusSection />
      {canManageOrg ? <BuildSection /> : null}
      <ScheduleSection />
      <DbtRepositorySection />
      <RunHistorySection />
      <DictionarySection />
    </div>
  );
}
