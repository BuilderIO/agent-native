import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { useSendToAgentChat } from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-react";
import type { ChartType, DataSourceType, SqlPanel } from "./types";

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "bar", label: "Bar" },
  { value: "pie", label: "Pie" },
  { value: "metric", label: "Metric" },
  { value: "table", label: "Table" },
];

const SOURCES: { value: DataSourceType; label: string }[] = [
  { value: "bigquery", label: "BigQuery" },
  { value: "ga4", label: "Google Analytics" },
  { value: "amplitude", label: "Amplitude" },
  { value: "first-party", label: "First-party Analytics" },
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
  width: 1 | 2;
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
      sql: "",
      description: "",
    };
  }
  return {
    title: panel.title,
    chartType: panel.chartType,
    source: panel.source,
    width: panel.width,
    sql: panel.sql,
    description: panel.config?.description ?? "",
  };
}

function formToPanel(
  form: PanelFormValues,
  existing: SqlPanel | null,
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
  return {
    id,
    title: form.title.trim() || "Untitled panel",
    sql: form.sql,
    source: form.source,
    chartType: form.chartType,
    width: form.width,
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

interface PanelEditorContentProps extends PanelEditorDialogProps {}

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
}: PanelEditorContentProps) {
  const [form, setForm] = useState<PanelFormValues>(() => panelToForm(panel));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [tab, setTab] = useState<"describe" | "manual">("describe");
  const { send, isGenerating } = useSendToAgentChat();

  // Reset form whenever the dialog opens or the target panel changes.
  useEffect(() => {
    if (open) {
      setForm(panelToForm(panel));
      setError(null);
      setSaving(false);
      setPrompt("");
      // Editing an existing panel always goes straight to the manual form.
      setTab(panel ? "manual" : "describe");
    }
  }, [open, panel]);

  const isEdit = !!panel;
  const canSave = form.title.trim().length > 0 && form.sql.trim().length > 0;
  const canGenerate = prompt.trim().length > 0 && !isGenerating;

  const handleSubmit = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(formToPanel(form, panel));
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save panel";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDescribe = () => {
    if (!canGenerate) return;
    const titlesLine = existingPanelTitles.length
      ? `Existing panels on this dashboard: ${existingPanelTitles.join(", ")}.`
      : "This dashboard has no panels yet.";
    send({
      message: prompt.trim(),
      context:
        `The user wants to add a new panel to SQL dashboard "${dashboardId}". ${titlesLine} ` +
        `Use the \`update-dashboard\` action with ops=[{op:'insert', path:'/panels/-', value: <panel>}] ` +
        `to append, or an appropriate index to place the panel in the right spot. ` +
        `Panel shape: { id (unique slug), title, sql, source ('bigquery'|'ga4'|'amplitude'|'first-party'), chartType ('line'|'area'|'bar'|'metric'|'table'|'pie'), width (1 half | 2 full), config? }. ` +
        `For amplitude panels, sql is a JSON descriptor: {"event":"event name","groupBy":"property","days":30}. ` +
        `For first-party panels, sql is read-only SQL over analytics_events only; use source 'first-party' and do not call db-query for this datasource. ` +
        `Config is optional: { xKey, yKey, yKeys, yFormatter ('number'|'currency'|'percent'), description, columns, pivot, limit }. ` +
        `Consult the data dictionary first via \`list-data-dictionary --search <topic>\`, then read the relevant \`.builder/skills/<provider>/SKILL.md\` before writing SQL. ` +
        `Every BigQuery panel is dry-run validated on save — if columns/tables are wrong the save returns a 400 with the BQ error and you must fix the SQL and retry. ` +
        `After the panel saves, call \`refresh-screen\` so the UI picks up the change.`,
      submit: true,
    });
    setPrompt("");
    onOpenChange(false);
  };

  const manualForm = (
    <div className="grid gap-4 py-2">
      <div className="grid gap-1.5">
        <Label htmlFor="panel-title">Title</Label>
        <Input
          id="panel-title"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="e.g. Weekly signups"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="panel-chart-type">Chart type</Label>
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
              {CHART_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="panel-source">Source</Label>
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

        <div className="grid gap-1.5">
          <Label>Width</Label>
          <ToggleGroup
            type="single"
            value={String(form.width)}
            onValueChange={(v) => {
              if (v === "1" || v === "2") {
                setForm((f) => ({ ...f, width: Number(v) as 1 | 2 }));
              }
            }}
            className="justify-start h-9"
          >
            <ToggleGroupItem value="1" className="h-9 px-3 text-xs">
              Half
            </ToggleGroupItem>
            <ToggleGroupItem value="2" className="h-9 px-3 text-xs">
              Full
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="panel-sql">SQL</Label>
        <Textarea
          id="panel-sql"
          value={form.sql}
          onChange={(e) => setForm((f) => ({ ...f, sql: e.target.value }))}
          rows={10}
          spellCheck={false}
          className="font-mono text-xs resize-y min-h-[200px]"
          placeholder="SELECT ..."
        />
        <p className="text-xs text-muted-foreground">
          Use <code className="font-mono">{"{{varName}}"}</code> to interpolate
          filter values.
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="panel-description">Description (optional)</Label>
        <Input
          id="panel-description"
          value={form.description}
          onChange={(e) =>
            setForm((f) => ({ ...f, description: e.target.value }))
          }
          placeholder="Short description shown under the panel title"
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
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!canSave || saving}
          >
            {saving ? "Saving..." : "Save changes"}
          </Button>
        </EditorFooter>
      </>
    );
  }

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as "describe" | "manual")}>
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="describe">Describe</TabsTrigger>
        <TabsTrigger value="manual">Manual</TabsTrigger>
      </TabsList>

      <TabsContent value="describe" className="mt-4">
        <div className="grid gap-3">
          <Label htmlFor="panel-prompt">What do you want to chart?</Label>
          <Textarea
            id="panel-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Weekly signups by channel over the last 6 months, stacked area"
            className="min-h-[140px] resize-y text-sm"
            autoFocus
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                handleDescribe();
              }
            }}
          />
          <p className="text-xs text-muted-foreground">
            The agent will consult the data dictionary, write the SQL, and
            append the panel. Press{" "}
            <kbd className="px-1 rounded border bg-muted font-mono text-[10px]">
              {/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl"}
              +Enter
            </kbd>{" "}
            to submit.
          </p>
        </div>
        <EditorFooter className="mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isGenerating}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleDescribe} disabled={!canGenerate}>
            {isGenerating ? (
              <>
                <IconLoader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Generating...
              </>
            ) : (
              "Generate"
            )}
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
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!canSave || saving}
          >
            {saving ? "Saving..." : "Add panel"}
          </Button>
        </EditorFooter>
      </TabsContent>
    </Tabs>
  );
}

export function PanelEditorDialog(props: PanelEditorDialogProps) {
  if (!props.panel) return null;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit panel</DialogTitle>
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
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        sideOffset={8}
        aria-label="Add panel"
        className="w-[calc(100vw-2rem)] sm:w-[640px] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-5"
      >
        <div className="mb-4">
          <h2 className="text-base font-semibold leading-none tracking-tight">
            Add panel
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
