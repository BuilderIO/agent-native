import {
  PromptComposer,
  useSendToAgentChat,
  useT,
} from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@agent-native/toolkit/ui/tabs";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@agent-native/toolkit/ui/toggle-group";
import { IconAlertTriangle, IconAlignLeft } from "@tabler/icons-react";
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { toast } from "sonner";

import { SqlEditor } from "@/components/SqlEditor";
import { canFormatPanelSql, formatPanelSql } from "@/lib/format-sql";

import {
  clampDashboardColumns,
  clampPanelWidth,
  DEFAULT_DASHBOARD_COLUMNS,
  MAX_DASHBOARD_COLUMNS,
  type ChartType,
  type DataSourceType,
  type SqlPanel,
} from "./types";

const CHART_TYPES: { value: ChartType; labelKey: string }[] = [
  { value: "line", labelKey: "panelEditor.chartTypeLine" },
  { value: "area", labelKey: "panelEditor.chartTypeArea" },
  { value: "bar", labelKey: "panelEditor.chartTypeBar" },
  { value: "pie", labelKey: "panelEditor.chartTypePie" },
  { value: "metric", labelKey: "panelEditor.chartTypeMetric" },
  { value: "table", labelKey: "panelEditor.chartTypeTable" },
];

const SOURCES: { value: DataSourceType; label: string }[] = [
  { value: "bigquery", label: "BigQuery" },
  { value: "ga4", label: "Google Analytics" }, // i18n-ignore stable provider label
  { value: "amplitude", label: "Amplitude" },
  { value: "first-party", label: "First-party Analytics" }, // i18n-ignore stable source label
  { value: "demo", label: "Demo Prometheus" }, // i18n-ignore stable source label
  { value: "prometheus", label: "Prometheus" },
];

function generatePanelId(title: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "panel";
  return `${slug}-${Math.random().toString(36).slice(2, 7)}`;
}

export interface PanelFormValues {
  title: string;
  chartType: ChartType;
  source: DataSourceType;
  /** Legacy storage field retained for existing dashboards. Row widths are
   *  now inferred from how many panels share the row. */
  width: number;
  /** Section panels only: number of grid columns the panels following this
   *  section should use. Ignored when `chartType` is not `"section"`. */
  columns: number;
  sql: string;
  description: string;
}

function panelToForm(panel: SqlPanel | null): PanelFormValues {
  if (!panel) {
    return {
      title: "",
      chartType: "line",
      source: "bigquery",
      width: 1,
      columns: DEFAULT_DASHBOARD_COLUMNS,
      sql: "",
      description: "",
    };
  }
  return {
    title: panel.title,
    chartType: panel.chartType,
    source: panel.source,
    width: clampPanelWidth(panel.width, MAX_DASHBOARD_COLUMNS),
    columns: clampDashboardColumns(panel.columns ?? DEFAULT_DASHBOARD_COLUMNS),
    sql: panel.sql,
    description: panel.config?.description ?? "",
  };
}

function formToPanel(
  form: PanelFormValues,
  existing: SqlPanel | null,
  untitledPanel: string,
): SqlPanel {
  const id = existing?.id ?? generatePanelId(form.title);
  const description = form.description.trim();
  const existingConfig = existing?.config ?? {};
  const config = { ...existingConfig };
  if (description) {
    config.description = description;
  } else {
    delete config.description;
  }
  const isSection = form.chartType === "section";
  return {
    id,
    title: form.title.trim() || untitledPanel,
    sql: form.sql,
    source: form.source,
    chartType: form.chartType,
    width: clampPanelWidth(form.width, MAX_DASHBOARD_COLUMNS),
    ...(isSection
      ? { columns: clampDashboardColumns(form.columns) }
      : existing?.columns !== undefined
        ? { columns: existing.columns }
        : null),
    config: Object.keys(config).length > 0 ? config : undefined,
  };
}

interface PanelEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing panel when editing; null when adding. */
  panel: SqlPanel | null;
  /** Async save. Should throw on error; dialog stays open and surfaces the
   *  message inline. On success the dialog closes. */
  onSave: (panel: SqlPanel) => Promise<void>;
  /** Dashboard id + existing panel titles used in the agent-chat prompt context
   *  when the user describes a panel instead of writing it manually. */
  dashboardId: string;
  existingPanelTitles: string[];
}

function EditorFooter({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col-reverse gap-2 sm:flex-row sm:justify-end ${className}`}
    >
      {children}
    </div>
  );
}

function PanelEditorContent({
  open,
  onOpenChange,
  panel,
  onSave,
  dashboardId,
  existingPanelTitles,
}: PanelEditorDialogProps) {
  const t = useT();
  const [form, setForm] = useState<PanelFormValues>(() => panelToForm(panel));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"describe" | "manual">("describe");
  const { send, isGenerating } = useSendToAgentChat();

  // Reset form whenever the dialog opens or the target panel changes.
  useEffect(() => {
    if (open) {
      setForm(panelToForm(panel));
      setError(null);
      setSaving(false);
      // Editing an existing panel always goes straight to the manual form.
      setTab(panel ? "manual" : "describe");
    }
  }, [open, panel]);

  const isEdit = !!panel;
  const canSave = form.title.trim().length > 0 && form.sql.trim().length > 0;
  const canFormat = canFormatPanelSql(form.source);

  const handleSubmit = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(formToPanel(form, panel, t("panelEditor.untitledPanel")));
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("panelEditor.failedToSavePanel");
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDescribe = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isGenerating) return;
    const titlesLine = existingPanelTitles.length
      ? `Existing panels on this dashboard: ${existingPanelTitles.join(", ")}.`
      : "This dashboard has no panels yet.";
    send({
      message: trimmed,
      context:
        `The user wants to add a new panel to SQL dashboard "${dashboardId}". ${titlesLine} ` +
        `REAL_DATA_REQUIRED: before saving or answering, run at least one real data-source query action for this panel; \`data-source-status\`, \`list-data-dictionary\`, \`update-dashboard\`, \`mutate-dashboard\`, and dry-run validation do not count as data queries. ` +
        `The \`demo\` source is reserved for the built-in Node Exporter demo and does not satisfy REAL_DATA_REQUIRED unless the user explicitly asks to work on that demo dashboard. ` +
        `If no source can answer, report the exact unavailable/error result instead of saving a panel with guessed schema or metrics. ` +
        `Use the \`mutate-dashboard\` action with code like \`dashboard.insertPanel({"id":"new-panel","title":"New Panel","source":"first-party","chartType":"metric","width":1,"sql":"SELECT COUNT(*) AS value FROM analytics_events"}).atBottom();\` ` +
        `to append, or \`.nextTo("panel-id")\`, \`.atRow(2)\`, \`.atRowStart(2)\`, \`.before("panel-id")\`, \`.after("panel-id")\`, or \`.atIndex(n)\` to place the panel. Prefer \`.nextTo("panel-id")\` or \`.atRow(rowNumber)\` for visible row placement requests; they keep the chart in the intended rendered row and expand/rebalance that row when needed. ` +
        `Panel shape: { id (unique slug), title, sql, source ('bigquery'|'ga4'|'amplitude'|'first-party'|'demo'|'prometheus'), chartType ('line'|'area'|'bar'|'metric'|'table'|'pie'|'section'), width (legacy integer 1..6; set to 1 unless editing existing data), tab? (use 'Group / Tab' for grouped tabs), columns? (section panels only - 1..6 max panels per row for panels following this section), config? }. ` +
        `Visible layout auto-fits by row: one panel in a row spans the row, two split it, three split it into thirds, up to the section column limit. ` +
        `For amplitude panels, sql is a JSON descriptor: {"event":"event name","groupBy":"property","days":30}. ` +
        `For first-party panels, sql is read-only SQL over analytics_events only; use source 'first-party' and do not call db-query for this datasource. ` +
        `For demo panels, sql uses the same Prometheus JSON descriptor shape as source 'prometheus': {"promql":"rate(http_requests_total[5m])","mode":"range","range":"1h","step":"30s"}. ` +
        `For prometheus panels, sql is a JSON descriptor: {"promql":"rate(http_requests_total[5m])","mode":"range","range":"1h","step":"30s"}. mode defaults to "range"; range defaults to "1h"; step is auto if omitted. Returned rows have shape {timestamp, series, value} — set config.xKey="timestamp", config.yKey="value", and a single series in config.yKeys for clean charting. ` +
        `Config is optional: { xKey, yKey, yKeys, yFormatter ('number'|'currency'|'percent'), description, columns, pivot, limit, color, colors, stacked, legend, valueLabels }. ` +
        `Chart legends render automatically; set config.legend=false only when the user explicitly asks to hide the legend. ` +
        `Use \`get-sql-dashboard.layout.groups[].rows[].rowNumber/panelIds\` to identify and verify visible rows. ` +
        `Consult the data dictionary first via \`list-data-dictionary --search <topic>\`, then use AGENTS.md, .agents/skills, and connected data-source instructions before writing SQL. ` +
        `Every BigQuery panel is dry-run validated on save — if columns/tables are wrong the save returns a 400 with the BQ error and you must fix the SQL and retry. ` +
        `After the mutation saves, verify the returned panelCount, appliedOps, and insertedPanelIds; the UI refreshes automatically.`,
      submit: true,
    });
    onOpenChange(false);
  };

  const handleFormatSql = () => {
    if (!canFormat) return;
    try {
      setForm((f) => ({ ...f, sql: formatPanelSql(f.sql, f.source) }));
      setError(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("panelEditor.failedToFormatSql");
      setError(message);
      toast.error(message);
    }
  };

  const manualForm = (
    <div className="grid gap-4 py-2">
      <div className="grid gap-1.5">
        <Label htmlFor="panel-title">{t("panelEditor.title")}</Label>
        <Input
          id="panel-title"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder={t("panelEditor.titlePlaceholder")}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="panel-chart-type">{t("panelEditor.chartType")}</Label>
          <Select
            value={form.chartType}
            onValueChange={(v: ChartType) =>
              setForm((f) => ({ ...f, chartType: v }))
            }
          >
            <SelectTrigger id="panel-chart-type" className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHART_TYPES.map((chartType) => (
                <SelectItem key={chartType.value} value={chartType.value}>
                  {t(chartType.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="panel-source">{t("panelEditor.source")}</Label>
          <Select
            value={form.source}
            onValueChange={(v: DataSourceType) =>
              setForm((f) => ({ ...f, source: v }))
            }
          >
            <SelectTrigger id="panel-source" className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {form.chartType === "section" ? (
          <div className="grid gap-1.5">
            <Label>{t("panelEditor.sectionColumns")}</Label>
            <ToggleGroup
              type="single"
              value={String(form.columns)}
              onValueChange={(v) => {
                if (!v) return;
                const next = clampDashboardColumns(Number(v));
                setForm((f) => ({ ...f, columns: next }));
              }}
              className="justify-start h-9"
            >
              {Array.from(
                { length: MAX_DASHBOARD_COLUMNS },
                (_, i) => i + 1,
              ).map((n) => (
                <ToggleGroupItem
                  key={n}
                  value={String(n)}
                  className="h-9 w-9 px-0 text-xs"
                >
                  {n}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        ) : null}
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="panel-sql">SQL</Label>
          {canFormat && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleFormatSql}
              disabled={!form.sql.trim()}
              className="h-7 px-2 text-xs"
            >
              <IconAlignLeft className="h-3.5 w-3.5 mr-1" />
              {t("panelEditor.format")}
            </Button>
          )}
        </div>
        <SqlEditor
          id="panel-sql"
          value={form.sql}
          onChange={(e) => setForm((f) => ({ ...f, sql: e.target.value }))}
          rows={10}
          placeholder="SELECT ..."
        />
        <p className="text-xs text-muted-foreground">
          {t("panelEditor.filterInterpolation", {
            example: "{{varName}}",
          })}
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="panel-description">
          {t("panelEditor.descriptionOptional")}
        </Label>
        <Input
          id="panel-description"
          value={form.description}
          onChange={(e) =>
            setForm((f) => ({ ...f, description: e.target.value }))
          }
          placeholder={t("panelEditor.descriptionPlaceholder")}
        />
      </div>

      {error && (
        <div
          role="alert"
          className="flex gap-2 items-start rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive"
        >
          <IconAlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="whitespace-pre-wrap break-words font-mono">
            {error}
          </div>
        </div>
      )}
    </div>
  );

  if (isEdit) {
    return (
      <>
        {manualForm}
        <EditorFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t("panelEditor.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!canSave || saving}
          >
            {saving ? t("panelEditor.saving") : t("panelEditor.saveChanges")}
          </Button>
        </EditorFooter>
      </>
    );
  }

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as "describe" | "manual")}>
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="describe">{t("panelEditor.describe")}</TabsTrigger>
        <TabsTrigger value="manual">{t("panelEditor.manual")}</TabsTrigger>
      </TabsList>

      <TabsContent value="describe" className="mt-4">
        <div className="grid gap-3">
          <Label>{t("panelEditor.whatToChart")}</Label>
          <PromptComposer
            autoFocus
            disabled={isGenerating}
            placeholder={t("panelEditor.promptPlaceholder")}
            draftScope="analytics:add-panel"
            onSubmit={handleDescribe}
          />
        </div>
        <EditorFooter className="mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isGenerating}
          >
            {t("panelEditor.cancel")}
          </Button>
        </EditorFooter>
      </TabsContent>

      <TabsContent value="manual" className="mt-2">
        {manualForm}
        <EditorFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t("panelEditor.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!canSave || saving}
          >
            {saving ? t("panelEditor.saving") : t("panelEditor.addPanel")}
          </Button>
        </EditorFooter>
      </TabsContent>
    </Tabs>
  );
}

export function PanelEditorDialog(props: PanelEditorDialogProps) {
  const t = useT();
  if (!props.panel) return null;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("panelEditor.editPanel")}</DialogTitle>
        </DialogHeader>

        <PanelEditorContent {...props} />
      </DialogContent>
    </Dialog>
  );
}

interface AddPanelPopoverProps {
  children: ReactElement;
  onSave: (panel: SqlPanel) => Promise<void>;
  dashboardId: string;
  existingPanelTitles: string[];
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
}

export function AddPanelPopover({
  children,
  onSave,
  dashboardId,
  existingPanelTitles,
  align = "end",
  side = "bottom",
}: AddPanelPopoverProps) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        sideOffset={8}
        aria-label={t("panelEditor.addPanel")}
        className="w-[calc(100vw-2rem)] sm:w-[640px] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-5"
      >
        <div className="mb-4">
          <h2 className="text-base font-semibold leading-none tracking-tight">
            {t("panelEditor.addPanel")}
          </h2>
        </div>
        <PanelEditorContent
          open={open}
          onOpenChange={setOpen}
          panel={null}
          onSave={onSave}
          dashboardId={dashboardId}
          existingPanelTitles={existingPanelTitles}
        />
      </PopoverContent>
    </Popover>
  );
}
