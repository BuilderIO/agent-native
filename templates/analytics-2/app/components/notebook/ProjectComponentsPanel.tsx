import { useT } from "@agent-native/core/client/i18n";
import { IconBox, IconPlus, IconX } from "@tabler/icons-react";

/**
 * Components: the reusable cell snapshots this workspace can import.
 *
 * The source keeps components as first-class objects and offers them from the
 * notebook's sidebar (components/sidebar/SidebarOptions.tsx - the Components tab
 * beside Variables and Files), with an import cell that holds the component's
 * version. This panel lists what exists; the snapshot itself is captured by
 * `manage-component`, so a component always has at least one cell in it.
 */
export type ComponentSummary = {
  id: string;
  name: string;
  sourceProjectId: string;
  cellCount: number;
  updatedAt: string;
};

export function ProjectComponentsPanel({
  components,
  loading = false,
  onClose,
  onInsert,
}: {
  components: readonly ComponentSummary[];
  loading?: boolean | undefined;
  onClose: () => void;
  /** Places the component in the notebook; absent when the reader cannot edit it. */
  onInsert?: ((componentId: string, name: string) => void) | undefined;
}) {
  const t = useT();
  return (
    <aside className="nb-side-panel" aria-label="Components">
      <header className="nb-side-panel-header">
        <h2 className="nb-side-panel-title">Components</h2>
        <button
          type="button"
          className="nb-side-panel-close"
          aria-label="Close Components"
          onClick={onClose}
        >
          <IconX size={14} aria-hidden="true" />
        </button>
      </header>
      {loading ? (
        <p className="nb-panel-empty">Loading components…</p>
      ) : components.length === 0 ? (
        <p className="nb-panel-empty">
          No components yet. Select cells in a project and create a component to
          reuse them here.
        </p>
      ) : (
        <ul className="nb-component-list m-0 flex list-none flex-col gap-1 p-2">
          {components.map((component) => (
            <li
              key={component.id}
              className="nb-component-row flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted/60"
            >
              <IconBox
                size={14}
                className="shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="nb-component-name min-w-0 flex-1 truncate font-medium">
                {component.name}
              </span>
              <span className="nb-component-detail shrink-0 text-xs text-muted-foreground">
                {component.cellCount === 1
                  ? "1 cell"
                  : `${component.cellCount} cells`}
              </span>
              {onInsert ? (
                <button
                  type="button"
                  className="nb-side-panel-close shrink-0"
                  aria-label={t("notebook.component.insert", {
                    name: component.name,
                  })}
                  title={t("notebook.component.insert", {
                    name: component.name,
                  })}
                  onClick={() => onInsert(component.id, component.name)}
                >
                  <IconPlus size={14} aria-hidden="true" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
