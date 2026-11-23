import { useActionQuery } from "@agent-native/core/client/hooks";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { IconBox } from "@tabler/icons-react";
import { Link } from "react-router";

type ComponentRow = {
  id: string;
  name: string;
  sourceProjectId: string;
  cellCount: number;
  updatedAt: string;
};

/**
 * The workspace's components: reusable cell snapshots captured from a project and
 * imported into others. Same list the notebook's Components panel reads.
 */
export function ComponentsPage() {
  const query = useActionQuery<{ components?: ComponentRow[] }>(
    "list-components",
    {},
  );
  const rows = query.data?.components ?? [];

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold text-foreground">Components</h1>
      {query.isError ? (
        <div className="flex items-center gap-3 py-6" role="alert">
          <p className="text-sm text-destructive">
            There was an error loading components.
          </p>
          <button
            type="button"
            className="text-sm underline"
            onClick={() => void query.refetch()}
          >
            Retry
          </button>
        </div>
      ) : query.isPending ? (
        <ul
          className="divide-y divide-border rounded-lg border border-border bg-card"
          aria-busy="true"
        >
          {[0, 1, 2].map((index) => (
            <li className="flex items-center gap-3 px-4 py-3" key={index}>
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="ml-auto h-3 w-16" />
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card px-6 py-12 text-center">
          <IconBox
            aria-hidden="true"
            className="text-muted-foreground"
            size={28}
            stroke={1.6}
          />
          <p className="text-sm font-medium text-foreground">
            No components yet
          </p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Select cells in a project and create a component to reuse them in
            other projects.
          </p>
          <Link className="text-sm underline" to="/home/all">
            Open projects
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {rows.map((component) => (
            <li key={component.id}>
              <Link
                className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40"
                to={`/project/${encodeURIComponent(component.sourceProjectId)}/latest`}
              >
                <IconBox
                  aria-hidden="true"
                  className="text-muted-foreground"
                  size={16}
                  stroke={1.8}
                />
                <span className="truncate text-sm text-foreground">
                  {component.name}
                </span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {component.cellCount === 1
                    ? "1 cell"
                    : `${component.cellCount} cells`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
