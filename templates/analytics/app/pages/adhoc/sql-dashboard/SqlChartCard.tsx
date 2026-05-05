import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  IconGripVertical,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconDotsVertical,
  IconPencil,
  IconTrash,
  IconCode,
  IconDownload,
} from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SqlChart } from "@/components/dashboard/SqlChart";
import { ViewSqlPopover } from "./ViewSqlPopover";
import type { SqlPanel } from "./types";

interface SqlChartCardProps {
  panel: SqlPanel;
  resolvedSql?: string;
  onRemove: () => void;
  onToggleWidth: () => void;
  onEdit?: () => void;
  /** Persist a SQL-only edit from the inline View SQL popover. Should throw on
   *  validation failure so the popover can stay open and surface the error. */
  onSaveSql?: (sql: string) => Promise<void>;
}

export function SqlChartCard({
  panel,
  resolvedSql,
  onRemove,
  onToggleWidth,
  onEdit,
  onSaveSql,
}: SqlChartCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: panel.id });

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [exportCsv, setExportCsv] = useState<(() => void) | null>(null);

  const handleExportCsvChange = useCallback((handler: (() => void) | null) => {
    setExportCsv(handler ? () => handler : null);
  }, []);

  useEffect(() => {
    setExportCsv(null);
  }, [panel.id]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.7 : 1,
  };

  // Section panels render as a flush header row (no card chrome, full width)
  // so they read as dividers between groups of panels rather than as another
  // tile in the grid.
  if (panel.chartType === "section") {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="group relative mt-2 first:mt-0"
      >
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <h2 className="text-base font-semibold flex-1">{panel.title}</h2>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="p-1 rounded text-muted-foreground hover:text-foreground"
                      aria-label="Section options"
                    >
                      <IconDotsVertical className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Section options</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-40">
                {onEdit && (
                  <DropdownMenuItem onSelect={() => onEdit()}>
                    <IconPencil className="h-4 w-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                )}
                {onEdit && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setConfirmOpen(true);
                  }}
                >
                  <IconTrash className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="p-1 rounded cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground"
                  aria-label="Drag to reorder"
                  {...attributes}
                  {...listeners}
                >
                  <IconGripVertical className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Drag to reorder</TooltipContent>
            </Tooltip>
          </div>
        </div>
        {panel.config?.description && (
          <p className="text-sm text-muted-foreground mt-1">
            {panel.config.description}
          </p>
        )}
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete section?</AlertDialogTitle>
              <AlertDialogDescription>
                Delete &quot;{panel.title}&quot;? This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirmOpen(false);
                  onRemove();
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative h-full hover:z-20 focus-within:z-20"
    >
      <Card className="flex h-full flex-col overflow-visible">
        <CardHeader className="pb-2 flex flex-row items-center gap-2 shrink-0">
          <CardTitle className="text-sm font-medium flex-1 truncate">
            {panel.title}
          </CardTitle>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="p-1 rounded text-muted-foreground hover:text-foreground"
                      aria-label="Panel options"
                    >
                      <IconDotsVertical className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Panel options</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-44">
                {panel.chartType === "table" && (
                  <DropdownMenuItem
                    disabled={!exportCsv}
                    onSelect={() => exportCsv?.()}
                  >
                    <IconDownload className="h-4 w-4 mr-2" />
                    Download CSV
                  </DropdownMenuItem>
                )}
                {onSaveSql && (
                  <ViewSqlPopover
                    panel={panel}
                    resolvedSql={resolvedSql}
                    onSaveSql={onSaveSql}
                  >
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                      <IconCode className="h-4 w-4 mr-2" />
                      View SQL
                    </DropdownMenuItem>
                  </ViewSqlPopover>
                )}
                <DropdownMenuItem onSelect={onToggleWidth}>
                  {panel.width === 2 ? (
                    <IconArrowsMinimize className="h-4 w-4 mr-2" />
                  ) : (
                    <IconArrowsMaximize className="h-4 w-4 mr-2" />
                  )}
                  {panel.width === 2 ? "Half width" : "Full width"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {onEdit && (
                  <DropdownMenuItem onSelect={() => onEdit()}>
                    <IconPencil className="h-4 w-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setConfirmOpen(true);
                  }}
                >
                  <IconTrash className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="p-1 rounded cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground"
                  aria-label="Drag to reorder"
                  {...attributes}
                  {...listeners}
                >
                  <IconGripVertical className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Drag to reorder</TooltipContent>
            </Tooltip>
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col overflow-visible pt-0">
          <SqlChart
            panel={panel}
            resolvedSql={resolvedSql}
            onExportCsvChange={handleExportCsvChange}
          />
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete panel?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{panel.title}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                onRemove();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
