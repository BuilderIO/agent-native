import { useT } from "@agent-native/core/client/i18n";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  IconCheck,
  IconChevronDown,
  IconDatabase,
  IconPlus,
  IconSearch,
} from "@tabler/icons-react";
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";

import type { NotebookConnection } from "./types";

interface ConnectionOption {
  id: string | null;
  name: string;
  type?: string;
  description?: string | null;
}

export function ConnectionPicker({
  connections,
  value,
  loading = false,
  error = null,
  selectionStatus,
  pending = false,
  disabled = false,
  importedConnectionIds,
  addConnectionHref,
  onSelect,
}: {
  connections: readonly NotebookConnection[];
  value: string | null | undefined;
  loading?: boolean;
  error?: string | null;
  selectionStatus?: "missing" | "unavailable" | undefined;
  pending?: boolean;
  disabled?: boolean;
  importedConnectionIds?: ReadonlySet<string> | undefined;
  addConnectionHref?: string | undefined;
  onSelect: (connectionId: string | null) => void;
}) {
  const t = useT();
  const groupId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const options = useMemo<ConnectionOption[]>(
    () => [
      {
        id: null,
        name: t("notebook.dataframes"),
        description: t("notebook.dataframesDescription"),
      },
      ...connections.map((connection) => ({
        id: connection.id,
        name: connection.name,
        ...(connection.type === undefined ? {} : { type: connection.type }),
        description: connection.description ?? null,
      })),
    ],
    [connections, t],
  );
  const selected =
    value === null ? options[0] : options.find((option) => option.id === value);
  const unresolved = typeof value === "string" && selected === undefined;
  const loadingSelection =
    loading &&
    (value === undefined || (unresolved && selectionStatus === undefined));
  const unavailableSelection =
    unresolved &&
    (selectionStatus === "unavailable" ||
      (!loading && error != null && selectionStatus !== "missing"));
  const name = loadingSelection
    ? t("analytics.settings.loading")
    : unavailableSelection
      ? t("analytics.settings.loadError")
      : value === undefined
        ? t("notebook.selectSource", { defaultValue: "Select a source" })
        : (selected?.name ?? "Unknown connection");
  const normalizedQuery = query.trim().toLowerCase();
  const filtered =
    normalizedQuery === ""
      ? options
      : options.filter((option) =>
          `${option.name} ${option.description ?? ""} ${option.type ?? ""}`
            .toLowerCase()
            .includes(normalizedQuery),
        );
  const dataframes = filtered.find((option) => option.id === null);
  const imported: ConnectionOption[] = [];
  const available: ConnectionOption[] = [];
  for (const option of filtered) {
    if (option.id === null) continue;
    if (option.id === value || importedConnectionIds?.has(option.id))
      imported.push(option);
    else available.push(option);
  }

  const renderOption = (option: ConnectionOption) => {
    const active = option.id === value;
    return (
      <button
        key={option.id ?? "__chained__"}
        type="button"
        role="menuitemradio"
        aria-label={option.name}
        aria-description={
          [option.description, option.type].filter(Boolean).join(", ") ||
          undefined
        }
        aria-checked={active}
        className="nb-menu-item nb-connection-item"
        disabled={pending}
        onClick={() => {
          setOpen(false);
          if (!active) onSelect(option.id);
        }}
      >
        {option.id !== null && <IconDatabase size={14} aria-hidden="true" />}
        <span className="nb-connection-copy">
          <span className="nb-connection-title">{option.name}</span>
          {option.description && (
            <span className="nb-connection-description">
              {option.description}
            </span>
          )}
          {option.type && (
            <span className="nb-connection-description">{option.type}</span>
          )}
        </span>
        {active && (
          <IconCheck
            className="nb-connection-check"
            size={14}
            aria-hidden="true"
          />
        )}
      </button>
    );
  };

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        '[role="menuitemradio"]:not(:disabled), [role="menuitem"]',
      ),
    );
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "ArrowDown"
        ? current < 0
          ? 0
          : (current + 1) % items.length
        : current <= 0
          ? items.length - 1
          : current - 1;
    items[next]?.focus();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="nb-connection"
          aria-label={`Data connection: ${name}`}
          aria-busy={loadingSelection || undefined}
          aria-expanded={open}
          aria-haspopup="menu"
          disabled={disabled || pending}
          title={name}
        >
          {pending ? (
            <span className="nb-spinner" aria-hidden="true" />
          ) : value !== null ? (
            <IconDatabase size={14} aria-hidden="true" />
          ) : null}
          <span className="nb-connection-name">
            {loadingSelection ? (
              <Skeleton className="h-3 w-24" aria-hidden="true" />
            ) : (
              name
            )}
          </span>
          {value === undefined && (
            <IconChevronDown
              className="nb-connection-chevron"
              size={12}
              aria-hidden="true"
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="nb-popover nb-connection-menu"
        sideOffset={4}
        style={{ padding: 0, width: 288, maxWidth: "calc(100vw - 16px)" }}
        onKeyDown={(event) => moveFocus(event)}
      >
        {open && (
          <label className="nb-connection-search">
            <IconSearch size={14} aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder={t("notebook.filterSources")}
              aria-label="Search data connections"
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        )}
        <div role="menu" aria-label="Data connections" className="nb-menu-list">
          {filtered.length === 0 && (
            <p className="nb-menu-empty">No connection matches search</p>
          )}
          {dataframes && renderOption(dataframes)}
          {imported.length > 0 && (
            <div role="group" aria-labelledby={`${groupId}-imported`}>
              <div className="nb-connection-group" id={`${groupId}-imported`}>
                {t("notebook.importedWorkspaceConnections")}
              </div>
              {imported.map(renderOption)}
            </div>
          )}
          {available.length > 0 && (
            <div role="group" aria-labelledby={`${groupId}-available`}>
              <div className="nb-connection-group" id={`${groupId}-available`}>
                {t("notebook.availableWorkspaceConnections")}
              </div>
              {available.map(renderOption)}
            </div>
          )}
          {addConnectionHref && (
            <Link
              className="nb-menu-item nb-connection-add"
              role="menuitem"
              to={addConnectionHref}
              onClick={() => setOpen(false)}
            >
              <IconPlus size={14} aria-hidden="true" />
              {t("notebook.addDataConnection")}
            </Link>
          )}
        </div>
        {(loading || error != null) && (
          <p className="nb-connection-footer">
            {loading
              ? "Loading workspace connections…"
              : "Couldn’t load workspace connections"}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
