import { PARTS, type PartDefinition } from "@agent-native/design-system";
import { IconCheck } from "@tabler/icons-react";
import { useState } from "react";

import { Badge } from "../../src/ui/base-ui/badge.js";
import { Toggle } from "../../src/ui/base-ui/toggle.js";
import type { Cell, MigrationStatus, Site, Usage } from "./scan.js";

const KIND_LABELS: Record<PartDefinition["kind"], string> = {
  component: "Components",
  pattern: "Patterns",
};

const USAGE_LABELS: Record<Usage, string> = {
  legacy: "Old source",
  custom: "Hand-built",
  native: "Design system",
};

interface Row {
  name: string;
  status: PartDefinition["status"] | "uncatalogued";
}

interface Group {
  label: string;
  rows: Row[];
}

function used(status: MigrationStatus, part: string) {
  return status.apps.some((app) => status.cells[app.id]?.[part] !== undefined);
}

function groups(status: MigrationStatus): Group[] {
  const kinds: Group[] = (["component", "pattern"] as const).map((kind) => ({
    label: KIND_LABELS[kind],
    rows: PARTS.filter(
      (part) =>
        part.kind === kind &&
        (kind === "component" ||
          part.status !== "planned" ||
          used(status, part.name)),
    ).map((part) => ({ name: part.name, status: part.status })),
  }));
  const known = new Set(PARTS.map((part) => part.name));
  const extra = [
    ...new Set(
      status.apps.flatMap((app) => Object.keys(status.cells[app.id] ?? {})),
    ),
  ]
    .filter((name) => !known.has(name))
    .sort()
    .map((name): Row => ({ name, status: "uncatalogued" }));
  return extra.length
    ? [...kinds, { label: "Not in the catalog", rows: extra }]
    : kinds;
}

const remaining = (cell: Cell) => cell.legacy.length + cell.custom.length;

function progress(status: MigrationStatus, appId: string) {
  let native = 0;
  let total = 0;
  for (const cell of Object.values(status.cells[appId] ?? {})) {
    if (!cell) continue;
    native += cell.native.length;
    total += cell.native.length + remaining(cell);
  }
  return total === 0 ? null : Math.round((native / total) * 100);
}

function CellToggle({
  cell,
  pressed,
  onPressedChange,
  label,
}: {
  cell: Cell | undefined;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  label: string;
}) {
  if (!cell) {
    return (
      <>
        <span className="text-fg-subtle" aria-hidden>
          –
        </span>
        <span className="sr-only">{`${label}: not used`}</span>
      </>
    );
  }
  const left = remaining(cell);
  return (
    <Toggle
      size="sm"
      color="gray"
      pressed={pressed}
      onPressedChange={onPressedChange}
      aria-label={
        left === 0
          ? `${label}: all ${cell.native.length} files on the design system`
          : `${label}: ${left} of ${left + cell.native.length} files left`
      }
    >
      {left === 0 ? (
        <Badge color="success">
          <IconCheck aria-hidden />
          {cell.native.length}
        </Badge>
      ) : (
        <Badge color="warning">{left} left</Badge>
      )}
    </Toggle>
  );
}

function SiteList({ usage, sites }: { usage: Usage; sites: Site[] }) {
  if (sites.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">
        {USAGE_LABELS[usage]} · {sites.length}
      </h3>
      <ul className="flex flex-col gap-1">
        {sites.map((site) => (
          <li key={site.file} className="flex flex-col text-xs">
            <code>{site.file}</code>
            <span className="text-fg-muted">{site.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MigrationStatusPage({ status }: { status: MigrationStatus }) {
  const [selected, setSelected] = useState<{
    app: string;
    part: string;
  } | null>(null);
  const tableGroups = groups(status);
  const selectedCell = selected
    ? status.cells[selected.app]?.[selected.part]
    : undefined;
  const selectedApp = status.apps.find((app) => app.id === selected?.app);

  return (
    <div className="flex flex-col gap-6">
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
        <li>
          Each cell counts the files in an app that use a component, read from
          the source when Storybook loads it and again on every edit.
        </li>
        <li>
          <strong>✓</strong> every one of those files gets it from the design
          system. <strong>Left</strong> counts the files still on an old source
          (Radix, cmdk, sonner, vaul, a shadcn file in toolkit/ui or a wrapper)
          or hand-built from raw elements and ARIA roles.
        </li>
        <li>
          <strong>Planned</strong> components have no design-system part yet, so
          their files can't move until it ships.
        </li>
        <li>Select a cell to see its files.</li>
      </ul>

      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-max min-w-full border-collapse text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 bg-surface-canvas px-3 py-2 text-left font-medium"
              >
                Component
              </th>
              {status.apps.map((app) => {
                const percent = progress(status, app.id);
                return (
                  <th
                    key={app.id}
                    scope="col"
                    className="px-2 py-2 text-center font-medium"
                  >
                    <div>{app.label}</div>
                    <div className="text-xs font-normal text-fg-muted">
                      {percent === null ? "–" : `${percent}%`}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          {tableGroups.map((group) => (
            <tbody key={group.label}>
              <tr>
                <th
                  scope="rowgroup"
                  colSpan={status.apps.length + 1}
                  className="sticky left-0 bg-surface-canvas px-3 pt-4 pb-1 text-left text-xs font-medium text-fg-muted"
                >
                  {group.label}
                </th>
              </tr>
              {group.rows.map((row) => (
                <tr key={row.name} className="border-t border-line">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-surface-canvas px-3 py-1 text-left font-normal"
                  >
                    <span className="flex items-center gap-2">
                      {row.name}
                      {row.status === "planned" ? (
                        <Badge color="warning" variant="outline">
                          Planned
                        </Badge>
                      ) : null}
                    </span>
                  </th>
                  {status.apps.map((app) => {
                    const isSelected =
                      selected?.app === app.id && selected.part === row.name;
                    return (
                      <td key={app.id} className="px-2 py-1 text-center">
                        <CellToggle
                          cell={status.cells[app.id]?.[row.name]}
                          label={`${app.label} ${row.name}`}
                          pressed={isSelected}
                          onPressedChange={(pressed) =>
                            setSelected(
                              pressed ? { app: app.id, part: row.name } : null,
                            )
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {selected && selectedCell && selectedApp ? (
        <section
          aria-label={`${selectedApp.label} ${selected.part} files`}
          className="flex flex-col gap-4"
        >
          <h2 className="text-base font-medium">
            {selectedApp.label} · {selected.part}
          </h2>
          {(["legacy", "custom", "native"] as const).map((usage) => (
            <SiteList key={usage} usage={usage} sites={selectedCell[usage]} />
          ))}
        </section>
      ) : null}

      {status.unresolved.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-medium">
            Imports the scan couldn't follow · {status.unresolved.length}
          </h2>
          <ul className="flex flex-col gap-1 text-xs">
            {status.unresolved.map((entry) => (
              <li key={`${entry.file}:${entry.specifier}`}>
                <code>{entry.file}</code> {entry.specifier}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
