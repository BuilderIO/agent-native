import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  IconGripVertical,
  IconTrash,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconExternalLink,
} from "@tabler/icons-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Link } from "react-router";
import { SqlChart } from "@/components/dashboard/SqlChart";
import type { SqlPanel } from "./types";

interface SqlChartCardProps {
  panel: SqlPanel;
  onRemove: () => void;
  onToggleWidth: () => void;
}

export function SqlChartCard({
  panel,
  onRemove,
  onToggleWidth,
}: SqlChartCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: panel.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.7 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative ${panel.width === 2 ? "md:col-span-2" : ""}`}
    >
      <Card className="h-full">
        <CardHeader className="pb-2 flex flex-row items-center gap-2">
          <button
            className="cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground/60 shrink-0 opacity-0 group-hover:opacity-100"
            {...attributes}
            {...listeners}
          >
            <IconGripVertical className="h-4 w-4" />
          </button>
          <CardTitle className="text-sm font-medium flex-1 truncate">
            {panel.title}
          </CardTitle>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
            <button
              onClick={onToggleWidth}
              className="p-1 rounded text-muted-foreground hover:text-foreground"
              title={panel.width === 2 ? "Half width" : "Full width"}
            >
              {panel.width === 2 ? (
                <IconArrowsMinimize className="h-3.5 w-3.5" />
              ) : (
                <IconArrowsMaximize className="h-3.5 w-3.5" />
              )}
            </button>
            {panel.sql && (
              <Link
                to={`/query?sql=${encodeURIComponent(panel.sql)}`}
                className="p-1 rounded text-muted-foreground hover:text-foreground"
                title="Open in Query Explorer"
              >
                <IconExternalLink className="h-3.5 w-3.5" />
              </Link>
            )}
            <button
              onClick={onRemove}
              className="p-1 rounded text-muted-foreground hover:text-destructive"
              title="Remove panel"
            >
              <IconTrash className="h-3.5 w-3.5" />
            </button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <SqlChart panel={panel} />
        </CardContent>
      </Card>
    </div>
  );
}
