import { IconList, IconX } from "@tabler/icons-react";

import { cellKindDefinition, type CellKind } from "@/lib/model/cell-types";

export type OutlineCell = {
  id: string;
  label: string;
  kind: CellKind | string;
};

function kindName(kind: string): string {
  if (kind === "input") return "Input";
  try {
    return cellKindDefinition(kind as CellKind).name;
  } catch {
    return kind;
  }
}

/**
 * Table of contents: every cell in the notebook, in order. Clicking an entry
 * scrolls that cell into view; the entries carry the cell's own label, so the
 * panel never invents a title.
 */
export function ProjectOutlinePanel({
  cells,
  onClose,
  onJump,
}: {
  cells: readonly OutlineCell[];
  onClose: () => void;
  onJump: (cellId: string) => void;
}) {
  return (
    <aside className="nb-side-panel" aria-label="Table of contents">
      <header className="nb-side-panel-header">
        <h2 className="nb-side-panel-title">Table of contents</h2>
        <button
          type="button"
          className="nb-side-panel-close"
          aria-label="Close Table of contents"
          onClick={onClose}
        >
          <IconX size={14} aria-hidden="true" />
        </button>
      </header>
      {cells.length === 0 ? (
        <p className="nb-side-panel-note">No cells yet</p>
      ) : (
        <ol className="nb-outline-list">
          {cells.map((cell) => (
            <li key={cell.id}>
              <button
                type="button"
                className="nb-outline-item"
                onClick={() => onJump(cell.id)}
              >
                <IconList size={12} aria-hidden="true" />
                <span className="nb-outline-name">{cell.label}</span>
                <span className="nb-outline-kind">
                  {kindName(String(cell.kind))}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
