import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconLoader2,
  IconRotate,
} from "@tabler/icons-react";
import type { DataSourceType, SqlPanel } from "./types";

const SOURCE_LABELS: Record<DataSourceType, string> = {
  bigquery: "BigQuery",
  ga4: "Google Analytics",
  amplitude: "Amplitude",
  "first-party": "First-party",
};

interface ViewSqlPopoverProps {
  panel: SqlPanel;
  /** SQL with `{{var}}` placeholders interpolated. Used to show what's actually
   *  being executed against the data source. */
  resolvedSql?: string;
  /** Persist a SQL-only edit. Should throw on validation failure so the
   *  popover can keep open and surface the error inline. */
  onSaveSql: (sql: string) => Promise<void>;
  children: ReactNode;
}

export function ViewSqlPopover({
  panel,
  resolvedSql,
  onSaveSql,
  children,
}: ViewSqlPopoverProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(panel.sql);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(panel.sql);
      setError(null);
      setShowResolved(false);
    }
  }, [open, panel.sql]);

  const dirty = draft !== panel.sql;
  const hasResolvedDifference =
    resolvedSql !== undefined && resolvedSql !== panel.sql;
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.userAgent);

  const handleSave = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSaveSql(draft);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    const text = showResolved && resolvedSql ? resolvedSql : draft;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("Couldn't copy SQL");
    }
  };

  const handleReset = () => {
    setDraft(panel.sql);
    setError(null);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        aria-label="View SQL"
        className="w-[calc(100vw-2rem)] sm:w-[640px] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-4"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            handleSave();
          }
        }}
      >
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-sm font-semibold leading-none">SQL</h3>
            <Badge variant="secondary" className="text-[10px] font-normal">
              {SOURCE_LABELS[panel.source]}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            {dirty && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleReset}
                    disabled={saving}
                    className="h-7 px-2 text-xs"
                  >
                    <IconRotate className="h-3.5 w-3.5 mr-1" />
                    Reset
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Discard changes</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleCopy}
                  className="h-7 px-2 text-xs"
                >
                  {copied ? (
                    <IconCheck className="h-3.5 w-3.5 mr-1" />
                  ) : (
                    <IconCopy className="h-3.5 w-3.5 mr-1" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {showResolved && resolvedSql ? "Copy resolved SQL" : "Copy SQL"}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={12}
          spellCheck={false}
          className="font-mono text-xs resize-y min-h-[240px]"
          placeholder="SELECT ..."
        />
        <p className="text-[11px] text-muted-foreground mt-1.5">
          Use <code className="font-mono">{"{{varName}}"}</code> to interpolate
          filter values. Press{" "}
          <kbd className="px-1 rounded border bg-muted font-mono text-[10px]">
            {isMac ? "⌘" : "Ctrl"}+Enter
          </kbd>{" "}
          to save.
        </p>

        {hasResolvedDifference && (
          <div className="mt-3">
            <button
              type="button"
              className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline cursor-pointer"
              onClick={() => setShowResolved((v) => !v)}
            >
              {showResolved ? "Hide" : "Show"} resolved SQL (with filter values)
            </button>
            {showResolved && (
              <pre className="mt-2 p-2.5 rounded bg-muted text-[11px] font-mono whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                {resolvedSql}
              </pre>
            )}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mt-3 flex gap-2 items-start rounded-md border border-destructive/50 bg-destructive/10 p-2.5 text-xs text-destructive"
          >
            <IconAlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="whitespace-pre-wrap break-words font-mono">
              {error}
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={saving}
          >
            Close
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
            {saving ? (
              <>
                <IconLoader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Saving...
              </>
            ) : (
              "Save"
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
