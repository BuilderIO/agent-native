import { useCallback, useEffect, useRef, useState } from "react";
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
  /** Toggle between "span 1 column" and "span all columns of the current
   *  section". Optional because section panels never expose this control. */
  onToggleWidth?: () => void;
  /** Number of columns in the section this panel currently lives in. Used to
   *  decide the toggle label / icon: when the panel already spans the full
   *  row, we offer to shrink; otherwise we offer to expand. */
  gridColumns?: number;
  onEdit?: () => void;
  /** Persist a SQL-only edit from the inline View SQL popover. Should throw on
   *  validation failure so the popover can stay open and surface the error. */
  onSaveSql?: (sql: string) => Promise<void>;
  editable?: boolean;
}

export function SqlChartCard({
  panel,
  resolvedSql,
  onRemove,
  onToggleWidth,
  gridColumns,
  onEdit,
  onSaveSql,
  editable = true,
}: SqlChartCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: panel.id, disabled: !editable });

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [exportCsv, setExportCsv] = useState<(() => void) | null>(null);
  const [shouldLoadData, setShouldLoadData] = useState(
    panel.chartType === "section",
  );
  const cardRef = useRef<HTMLDivElement | null>(null);

  const setCardNodeRef = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      cardRef.current = node;
    },
    [setNodeRef],
  );

  const handleExportCsvChange = useCallback((handler: (() => void) | null) => {
    setExportCsv(handler ? () => handler : null);
  }, []);

  useEffect(() => {
    if (panel.chartType === "section") {
      setShouldLoadData(true);
      return;
    }

    setShouldLoadData(false);
    const node = cardRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setShouldLoadData(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoadData(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: "800px 0px",
        threshold: 0.01,
      },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [panel.chartType, panel.id]);

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
        ref={setCardNodeRef}
        style={style}
        className="group relative mt-2 first:mt-0"
      >
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <h2 className="text-base font-semibold flex-1">{panel.title}</h2>
          {editable ? (
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
          ) : null}
        </div>
        {panel.config?.description && (
          <p className="text-sm text-muted-foreground mt-1">
            {panel.config.description}
          </p>
        )}
        {editable ? (
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
        ) : null}
      </div>
    );
  }

  const showPanelMenu = editable || panel.chartType === "table";

  return (
    <div
      ref={setCardNodeRef}
      style={style}
      className="group relative h-full hover:z-20 focus-within:z-20"
    >
      <Card className="flex h-full flex-col overflow-visible">
        <CardHeader className="pb-2 flex flex-row items-center gap-2 shrink-0">
          <CardTitle className="text-sm font-medium flex-1 truncate">
            {panel.title}
          </CardTitle>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
            {showPanelMenu ? (
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
                  {editable && panel.chartType === "table" ? (
                    <DropdownMenuSeparator />
                  ) : null}
                  {editable && onSaveSql ? (
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
                  ) : null}
                  {editable && onToggleWidth && (gridColumns ?? 2) > 1 && (
                    <DropdownMenuItem onSelect={onToggleWidth}>
                      {panel.width >= (gridColumns ?? 2) ? (
                        <>
                          <IconArrowsMinimize className="h-4 w-4 mr-2" />
                          Span 1 column
                        </>
                      ) : (
                        <>
                          <IconArrowsMaximize className="h-4 w-4 mr-2" />
                          Span full row
                        </>
                      )}
                    </DropdownMenuItem>
                  )}
                  {editable ? <DropdownMenuSeparator /> : null}
                  {editable && onEdit && (
                    <DropdownMenuItem onSelect={() => onEdit()}>
                      <IconPencil className="h-4 w-4 mr-2" />
                      Edit
                    </DropdownMenuItem>
                  )}
                  {editable ? (
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        setConfirmOpen(true);
                      }}
                    >
                      <IconTrash className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {editable ? (
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
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col overflow-visible pt-0">
          <SqlChart
            panel={panel}
            resolvedSql={resolvedSql}
            loadData={shouldLoadData}
            onExportCsvChange={handleExportCsvChange}
          />
        </CardContent>
      </Card>

      {editable ? (
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
      ) : null}
    </div>
  );
}
