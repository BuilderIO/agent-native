import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Activity, FileText, FilePlus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_EVENTS = 100;

type FeedItem = { type: string; path: string; id: string; receivedAt: number };

function normalizeWorkspacePath(fsPath: string): string {
  const n = fsPath.replace(/\\/g, "/");
  const dataIdx = n.lastIndexOf("/data/");
  if (dataIdx !== -1) return n.slice(dataIdx + "/data/".length);
  return n;
}

function eventMeta(type: string): {
  icon: typeof FileText;
  label: string;
} {
  switch (type) {
    case "add":
    case "addDir":
      return { icon: FilePlus, label: type === "addDir" ? "Folder added" : "Added" };
    case "unlink":
    case "unlinkDir":
      return { icon: Trash2, label: type === "unlinkDir" ? "Folder removed" : "Removed" };
    case "change":
      return { icon: FileText, label: "Changed" };
    default:
      return { icon: FileText, label: "Updated" };
  }
}

export function ActivityFeed() {
  const [events, setEvents] = useState<FeedItem[]>([]);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/events");
    sourceRef.current = source;

    source.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data) as { path?: unknown; type?: unknown };
        if (typeof parsed.path !== "string" || typeof parsed.type !== "string") {
          return;
        }
        const item: FeedItem = {
          type: parsed.type,
          path: parsed.path,
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          receivedAt: Date.now(),
        };
        setEvents((prev) => [item, ...prev].slice(0, MAX_EVENTS));
      } catch {
        /* ignore malformed */
      }
    };

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-card/30">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Activity className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium text-foreground">Activity</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {events.length === 0 ? (
          <p className="px-1 py-8 text-center text-sm text-muted-foreground">
            Waiting for agent activity...
          </p>
        ) : (
          <ul className="space-y-2">
            {events.map((ev) => {
              const rel = normalizeWorkspacePath(ev.path);
              const { icon: Icon, label } = eventMeta(ev.type);
              return (
                <li key={ev.id}>
                  <Link
                    to={`/file/${rel}`}
                    className={cn(
                      "block rounded-md border border-transparent px-2 py-2 text-left transition-colors",
                      "hover:border-border hover:bg-accent/30",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-foreground">{label}</div>
                        <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                          {rel}
                        </div>
                        <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/80">
                          {format(ev.receivedAt, "HH:mm:ss")}
                        </div>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
