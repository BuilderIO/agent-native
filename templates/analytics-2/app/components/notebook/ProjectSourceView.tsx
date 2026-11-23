import { cellKindDefinition } from "@/lib/model/cell-types";
import type { Cell } from "@/lib/model/contracts";

import { editableCellText } from "./utils";

export function ProjectSourceView({
  cells,
  titles,
}: {
  cells: readonly Cell[];
  titles: ReadonlyMap<string, string>;
}) {
  return (
    <section
      aria-label="Source"
      data-testid="project-source-view"
      className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6"
    >
      {cells.map((cell) => {
        const text = editableCellText(cell.contents);
        return (
          <article
            key={cell.id}
            className="overflow-hidden rounded-md border border-border bg-card"
          >
            <header className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-sm">
              <span className="truncate font-medium text-foreground">
                {titles.get(cell.id) ?? "Untitled cell"}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {cellKindDefinition(cell.contents.kind).name}
              </span>
            </header>
            {text != null && text !== "" ? (
              <pre className="m-0 overflow-x-auto whitespace-pre-wrap p-3 font-mono text-xs text-foreground">
                {text}
              </pre>
            ) : (
              <p className="m-0 p-3 text-xs text-muted-foreground">No source</p>
            )}
          </article>
        );
      })}
    </section>
  );
}
