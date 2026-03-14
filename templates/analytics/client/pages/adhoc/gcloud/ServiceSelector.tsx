import { useState, useMemo, useRef, useEffect } from "react";
import { useGCloudServices } from "./hooks";
import type { SelectedService } from "./types";
import { ChevronDown, Search, X } from "lucide-react";

interface Props {
  selected: SelectedService | null;
  onChange: (service: SelectedService | null) => void;
}

function relativeTime(dateStr: string): string {
  if (!dateStr) return "";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return "";
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

export function ServiceSelector({ selected, onChange }: Props) {
  const { data, isLoading, error } = useGCloudServices();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const cloudRun = data?.cloudRun ?? [];
  const cloudFunctions = data?.cloudFunctions ?? [];

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();

    // Sort by updateTime descending (most recently deployed first)
    const sortByUpdate = <T extends { displayName: string; updateTime: string }>(
      list: T[]
    ) =>
      [...list].sort((a, b) => {
        if (!a.updateTime && !b.updateTime) return a.displayName.localeCompare(b.displayName);
        if (!a.updateTime) return 1;
        if (!b.updateTime) return -1;
        return b.updateTime.localeCompare(a.updateTime);
      });

    if (!q) {
      return {
        cloudRun: sortByUpdate(cloudRun),
        cloudFunctions: sortByUpdate(cloudFunctions),
      };
    }
    return {
      cloudRun: sortByUpdate(
        cloudRun.filter((s) => s.displayName.toLowerCase().includes(q))
      ),
      cloudFunctions: sortByUpdate(
        cloudFunctions.filter((f) => f.displayName.toLowerCase().includes(q))
      ),
    };
  }, [cloudRun, cloudFunctions, search]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground">Loading services...</div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
        Failed to load services: {(error as Error).message}
      </div>
    );
  }

  const totalServices = cloudRun.length + cloudFunctions.length;

  return (
    <div className="relative" ref={containerRef}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-card text-sm text-foreground hover:bg-muted/50 transition-colors w-full max-w-md"
      >
        {selected ? (
          <span className="flex-1 text-left truncate">
            <span className="text-muted-foreground text-xs mr-1.5">
              {selected.type === "cloud_function" ? "CF" : "CR"}
            </span>
            {selected.name}
          </span>
        ) : (
          <span className="flex-1 text-left text-muted-foreground">
            Select a service ({totalServices} available)
          </span>
        )}
        {selected ? (
          <X
            className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
          />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full max-w-md rounded-lg border border-border bg-card shadow-xl">
          {/* Search */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search services..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
                className="w-full pl-8 pr-3 py-1.5 rounded-md border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Service list */}
          <div className="max-h-[300px] overflow-y-auto p-1.5">
            {filtered.cloudRun.length > 0 && (
              <div className="mb-1">
                <div className="px-2 py-1 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                  Cloud Run ({filtered.cloudRun.length})
                </div>
                {filtered.cloudRun.map((svc) => {
                  const isSelected =
                    selected?.name === svc.displayName &&
                    selected?.type === "cloud_run";
                  const ago = relativeTime(svc.updateTime);
                  return (
                    <button
                      key={svc.name}
                      onClick={() => {
                        onChange(
                          isSelected
                            ? null
                            : { name: svc.displayName, type: "cloud_run" }
                        );
                        setOpen(false);
                        setSearch("");
                      }}
                      className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors ${
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "text-foreground hover:bg-muted"
                      }`}
                    >
                      <span className="truncate">{svc.displayName}</span>
                      {ago && (
                        <span
                          className={`ml-2 flex-shrink-0 text-[10px] ${
                            isSelected
                              ? "text-primary-foreground/70"
                              : "text-muted-foreground"
                          }`}
                        >
                          {ago}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {filtered.cloudFunctions.length > 0 && (
              <div>
                <div className="px-2 py-1 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                  Cloud Functions ({filtered.cloudFunctions.length})
                </div>
                {filtered.cloudFunctions.map((fn) => {
                  const isSelected =
                    selected?.name === fn.displayName &&
                    selected?.type === "cloud_function";
                  const ago = relativeTime(fn.updateTime);
                  return (
                    <button
                      key={fn.name}
                      onClick={() => {
                        onChange(
                          isSelected
                            ? null
                            : {
                                name: fn.displayName,
                                type: "cloud_function",
                              }
                        );
                        setOpen(false);
                        setSearch("");
                      }}
                      className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors ${
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "text-foreground hover:bg-muted"
                      }`}
                    >
                      <span className="truncate">{fn.displayName}</span>
                      {ago && (
                        <span
                          className={`ml-2 flex-shrink-0 text-[10px] ${
                            isSelected
                              ? "text-primary-foreground/70"
                              : "text-muted-foreground"
                          }`}
                        >
                          {ago}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {!filtered.cloudRun.length &&
              !filtered.cloudFunctions.length &&
              search && (
                <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                  No services matching "{search}"
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
