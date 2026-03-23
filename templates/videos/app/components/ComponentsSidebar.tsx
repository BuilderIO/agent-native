import { libraryComponents } from "@/remotion/componentRegistry";
import { cn } from "@/lib/utils";
import { Box, Layers } from "lucide-react";

type ComponentsSidebarProps = {
  open: boolean;
  selectedComponentId: string | null;
  onSelectComponent: (id: string) => void;
};

export function ComponentsSidebar({
  open,
  selectedComponentId,
  onSelectComponent,
}: ComponentsSidebarProps) {
  if (!open) return null;

  return (
    <div className="w-64 border-r border-border bg-secondary/30 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Layers className="w-4 h-4" />
          Components
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Reusable UI components
        </p>
      </div>

      {/* Component List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {libraryComponents.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <Box className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No components yet</p>
            <p className="text-xs mt-1">Components will appear here</p>
          </div>
        ) : (
          libraryComponents.map((component) => (
            <button
              key={component.id}
              onClick={() => onSelectComponent(component.id)}
              className={cn(
                "w-full text-left px-3 py-2 rounded-md transition-colors",
                "hover:bg-secondary",
                selectedComponentId === component.id
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "bg-secondary/50 text-foreground",
              )}
            >
              <div className="font-medium text-sm">{component.title}</div>
              {component.description && (
                <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  {component.description}
                </div>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
