import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { IconPlus, IconTool } from "@tabler/icons-react";
import { cn } from "../utils.js";

interface Tool {
  id: string;
  name: string;
  description?: string;
  icon?: string;
}

export function ToolsListPage() {
  useEffect(() => {
    fetch("/_agent-native/application-state/navigation", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: { view: "tools" } }),
    }).catch(() => {});
  }, []);

  const { data: tools, isLoading } = useQuery<Tool[]>({
    queryKey: ["tools"],
    queryFn: async () => {
      const res = await fetch("/_agent-native/tools");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const toolList = tools ?? [];

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <h1 className="text-lg font-semibold">Tools</h1>
        <Link
          to="/tools/new"
          className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <IconPlus className="h-4 w-4" />
          New Tool
        </Link>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-lg border border-border bg-card p-5"
              >
                <div className="mb-3 h-10 w-10 animate-pulse rounded-lg bg-muted" />
                <div className="mb-2 h-4 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-3 w-full animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : toolList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
              <IconTool className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="mb-1 text-lg font-semibold">No tools yet</h2>
            <p className="mb-6 max-w-sm text-sm text-muted-foreground">
              Tools are mini apps that live in your workspace. Create one
              yourself or ask the agent to build one for you.
            </p>
            <Link
              to="/tools/new"
              className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <IconPlus className="h-4 w-4" />
              Create your first tool
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {toolList.map((tool) => (
              <Link
                key={tool.id}
                to={`/tools/${tool.id}`}
                className={cn(
                  "group cursor-pointer rounded-lg border border-border bg-card p-5",
                  "hover:border-primary/30 hover:shadow-sm",
                )}
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary">
                  <IconTool className="h-5 w-5" />
                </div>
                <h3 className="mb-1 text-sm font-semibold text-foreground">
                  {tool.name}
                </h3>
                {tool.description && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {tool.description}
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
