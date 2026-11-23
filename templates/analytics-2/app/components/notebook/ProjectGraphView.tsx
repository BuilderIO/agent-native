import { relatedCellIds } from "@/lib/model/cell-graph";
import { cellKindDefinition } from "@/lib/model/cell-types";
import type { Cell } from "@/lib/model/contracts";

import { cellIsRunnable } from "./utils";

export function ProjectGraphView({
  cells,
  titles,
}: {
  cells: readonly Cell[];
  titles: ReadonlyMap<string, string>;
}) {
  const nodes = cells.filter((cell) => cellIsRunnable(cell.contents));
  const name = (id: string) => titles.get(id) ?? "Untitled cell";
  return (
    <section
      aria-label="Graph mode"
      data-testid="project-graph-view"
      className="mx-auto w-full max-w-4xl p-6"
    >
      {nodes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No runnable cells</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {nodes.map((cell) => {
            const upstream = relatedCellIds(cells, cell.id, "upstream").filter(
              (id) => id !== cell.id,
            );
            return (
              <li
                key={cell.id}
                className="rounded-md border border-border bg-card px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate font-medium text-foreground">
                    {name(cell.id)}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {cellKindDefinition(cell.contents.kind).name}
                  </span>
                </div>
                <p className="m-0 mt-1 text-xs text-muted-foreground">
                  {upstream.length === 0
                    ? "No upstream cells"
                    : `Depends on ${upstream.map(name).join(", ")}`}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
