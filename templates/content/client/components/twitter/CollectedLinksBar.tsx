import { useState } from "react";
import { Link2, Save, X, ChevronUp, ChevronDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CollectedLink } from "@shared/api";
import { SaveLinksToProjectDialog } from "./SaveLinksToProjectDialog";

interface CollectedLinksBarProps {
  links: CollectedLink[];
  onRemove: (url: string) => void;
  onClear: () => void;
  onSaved: () => void;
  onClosePreview?: () => void;
  inline?: boolean;
  defaultProjectSlug?: string;
  currentWorkspace?: string;
}

export function CollectedLinksBar({
  links,
  onRemove,
  onClear,
  onSaved,
  onClosePreview,
  inline,
  defaultProjectSlug,
  currentWorkspace,
}: CollectedLinksBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [showSave, setShowSave] = useState(false);

  if (links.length === 0) return null;

  if (inline) {
    return (
      <>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <Link2 size={12} className="text-blue-500" />
            <span>{links.length} collected</span>
            {expanded ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
          </button>
          <button
            onClick={onClear}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Clear collected"
          >
            <Trash2 size={11} />
          </button>
          <button
            onClick={() => {
              setShowSave(true);
              onClosePreview?.();
            }}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Save size={10} />
            <span>Save</span>
          </button>
        </div>

        {/* Expanded list dropdown */}
        {expanded && (
          <div className="absolute top-full right-0 mt-1 z-30 w-72 rounded-lg border bg-card shadow-lg overflow-hidden">
            <div className="max-h-48 overflow-y-auto">
              {links.map((link) => (
                <div
                  key={link.url}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50 text-xs"
                >
                  <Link2 size={11} className="text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{link.title}</p>
                    <p className="text-muted-foreground truncate">{link.domain}</p>
                  </div>
                  <button
                    onClick={() => onRemove(link.url)}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <SaveLinksToProjectDialog
          open={showSave}
          onOpenChange={setShowSave}
          links={links}
          onSaved={() => {
            setShowSave(false);
            onSaved();
          }}
          defaultProjectSlug={defaultProjectSlug}
          currentWorkspace={currentWorkspace}
        />
      </>
    );
  }

  return (
    <>
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-[90%] max-w-lg">
        <div className="rounded-xl border bg-card shadow-lg overflow-hidden">
          {/* Expanded list */}
          {expanded && (
            <div className="max-h-48 overflow-y-auto border-b border-border">
              {links.map((link) => (
                <div
                  key={link.url}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50 text-xs"
                >
                  <Link2 size={11} className="text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{link.title}</p>
                    <p className="text-muted-foreground truncate">{link.domain}</p>
                  </div>
                  <button
                    onClick={() => onRemove(link.url)}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Bar */}
          <div className="flex items-center gap-3 px-4 py-2.5">
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-2 text-sm font-medium flex-1"
            >
              <Link2 size={14} className="text-blue-500" />
              <span>
                {links.length} link{links.length !== 1 ? "s" : ""} collected
              </span>
              {expanded ? (
                <ChevronDown size={14} className="text-muted-foreground" />
              ) : (
                <ChevronUp size={14} className="text-muted-foreground" />
              )}
            </button>

            <button
              onClick={onClear}
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Clear collected"
            >
              <Trash2 size={13} />
            </button>

            <Button size="sm" onClick={() => setShowSave(true)}>
              <Save size={12} className="mr-1.5" />
              Save to Project
            </Button>
          </div>
        </div>
      </div>

      <SaveLinksToProjectDialog
        open={showSave}
        onOpenChange={setShowSave}
        links={links}
        onSaved={() => {
          setShowSave(false);
          onSaved();
        }}
        defaultProjectSlug={defaultProjectSlug}
        currentWorkspace={currentWorkspace}
      />
    </>
  );
}
