import { useMemo, useState, useEffect } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  IconChevronDown,
  IconDeviceFloppy,
  IconFolderOpen,
  IconFilePlus,
  IconTrash,
  IconCode,
  IconChevronRight,
} from "@tabler/icons-react";
import { useMetricsQuery } from "@/lib/query-metrics";
import { EventPanel } from "./components/EventPanel";
import { ChartTypePicker } from "./components/ChartTypePicker";
import { ExplorerChart } from "./components/ExplorerChart";
import { DateRangePicker } from "./components/DateRangePicker";
import { SqlPreview } from "./components/SqlPreview";
import { useExplorerConfig } from "./use-explorer-config";
import { buildSql } from "./sql-builder";
import type { DateRange } from "./types";

export default function ExplorerPage() {
  const [searchParams] = useSearchParams();
  const {
    config,
    setConfig,
    currentId,
    savedConfigs,
    loadConfig,
    saveConfig,
    deleteConfig,
    newConfig,
    isSaving,
  } = useExplorerConfig();

  // Support ?config=<id> URL param to auto-load a saved config
  const configParam = searchParams.get("config");
  const [loadedParam, setLoadedParam] = useState<string | null>(null);
  useEffect(() => {
    if (
      configParam &&
      configParam !== loadedParam &&
      configParam !== currentId
    ) {
      loadConfig(configParam);
      setLoadedParam(configParam);
    }
  }, [configParam, loadedParam, currentId, loadConfig]);

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");

  const sql = useMemo(() => buildSql(config), [config]);

  const hasValidEvents = config.events.some((e) => e.event !== "");

  const { data: result, isLoading } = useMetricsQuery(
    ["explorer-query", sql],
    sql,
    { enabled: hasValidEvents && sql.length > 0 },
  );

  const handleSave = () => {
    if (currentId) {
      saveConfig();
    } else {
      setSaveName(config.name || "");
      setSaveDialogOpen(true);
    }
  };

  const handleSaveAs = () => {
    setSaveName(config.name || "");
    setSaveDialogOpen(true);
  };

  const handleSaveConfirm = () => {
    const name = saveName.trim() || "Untitled";
    setConfig({ ...config, name });
    saveConfig(name);
    setSaveDialogOpen(false);
  };

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Explorer</h2>
          {currentId && (
            <span className="text-sm text-muted-foreground">
              — {config.name}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* IconDeviceFloppy */}
          <Button
            size="sm"
            variant="outline"
            onClick={handleSave}
            disabled={isSaving}
          >
            <IconDeviceFloppy className="h-4 w-4 mr-1" />
            {isSaving ? "Saving..." : "IconDeviceFloppy"}
          </Button>

          {/* Load / manage saved configs */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <IconFolderOpen className="h-4 w-4 mr-1" />
                Load
                <IconChevronDown className="h-3 w-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={newConfig}>
                <IconFilePlus className="h-4 w-4 mr-2" />
                New Explorer
              </DropdownMenuItem>
              {currentId && (
                <DropdownMenuItem onClick={handleSaveAs}>
                  <IconDeviceFloppy className="h-4 w-4 mr-2" />
                  IconDeviceFloppy As...
                </DropdownMenuItem>
              )}
              {savedConfigs.length > 0 && <DropdownMenuSeparator />}
              {savedConfigs.map((sc) => (
                <DropdownMenuItem
                  key={sc.id}
                  className="flex items-center justify-between"
                  onClick={() => loadConfig(sc.id)}
                >
                  <span className="truncate">{sc.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 shrink-0 ml-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConfig(sc.id);
                    }}
                  >
                    <IconTrash className="h-3 w-3 text-destructive" />
                  </Button>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Date range */}
          <DateRangePicker
            value={config.dateRange}
            onChange={(dateRange) => setConfig({ ...config, dateRange })}
          />
        </div>
      </div>

      {/* Config panel */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 items-start">
        <div className="space-y-4">
          <EventPanel
            events={config.events}
            onChange={(events) => setConfig({ ...config, events })}
          />

          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Chart Type</span>
            <ChartTypePicker
              value={config.chartType}
              onChange={(chartType) => setConfig({ ...config, chartType })}
            />
          </div>
        </div>
      </div>

      {/* Results */}
      <ExplorerChart
        config={config}
        result={result}
        isLoading={isLoading}
        sql={sql}
      />

      {/* SQL preview */}
      {sql && <SqlPreview sql={sql} />}

      {/* IconDeviceFloppy dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>IconDeviceFloppy Explorer</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Dashboard name..."
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSaveConfirm()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveConfirm}>IconDeviceFloppy</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
