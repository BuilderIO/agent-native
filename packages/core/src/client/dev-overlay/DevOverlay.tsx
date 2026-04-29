/**
 * <DevOverlay /> — the framework dev/configuration panel.
 *
 * Templates render this once at the root of their app. The user toggles it
 * with Cmd+Ctrl+A (also exposed as `useDevOverlayShortcut`). Panels register
 * via `registerDevPanel`; values for option-style controls persist to
 * localStorage via `useDevOption`.
 *
 * Visibility note: the overlay only mounts when the host explicitly opens it
 * via the keybinding (or the `open` prop). It is dev-only by convention —
 * shipping with the keybinding active in prod is fine because nothing renders
 * unless invoked.
 */

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  IconChevronDown,
  IconChevronRight,
  IconLoader2,
  IconRefresh,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { listDevPanels, subscribeDevPanels } from "./registry.js";
import {
  clearAllDevOverlayStorage,
  useDevOption,
  DEV_OVERLAY_STORAGE_PREFIX,
} from "./use-dev-option.js";
import { useDevOverlayShortcut } from "./use-dev-overlay-shortcut.js";
import type {
  DevActionOption,
  DevBooleanOption,
  DevOption,
  DevPanel,
  DevSelectOption,
  DevStringOption,
} from "./types.js";
import "./builtins.js";

const PANEL_OPEN_KEY = `${DEV_OVERLAY_STORAGE_PREFIX}open`;
const COLLAPSED_KEY_PREFIX = `${DEV_OVERLAY_STORAGE_PREFIX}collapsed-`;

export interface DevOverlayProps {
  /**
   * Force-control the overlay's visibility. When omitted the overlay manages
   * its own state and listens to Cmd+Ctrl+A.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function DevOverlay({ open, onOpenChange }: DevOverlayProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  useDevOverlayShortcut(useCallback(() => setOpen(!isOpen), [isOpen, setOpen]));

  // Esc closes (only when overlay is the topmost UI — skip when typing).
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, setOpen]);

  if (!isOpen) return null;
  return <DevOverlayPanel onClose={() => setOpen(false)} />;
}

function DevOverlayPanel({ onClose }: { onClose: () => void }) {
  const panels = useSyncExternalStore(
    subscribeDevPanels,
    listDevPanels,
    listDevPanels,
  );

  return (
    <div style={styles.shell} role="dialog" aria-label="Dev overlay">
      <div style={styles.header}>
        <div>
          <div style={styles.headerTitle}>Dev Overlay</div>
          <div style={styles.headerSub}>Cmd+Ctrl+A · localStorage-backed</div>
        </div>
        <button
          type="button"
          style={styles.iconBtn}
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)"
        >
          <IconX size={16} />
        </button>
      </div>

      <div style={styles.body}>
        {panels.length === 0 ? (
          <div style={styles.empty}>
            No panels registered. Call <code>registerDevPanel(...)</code> from
            your template to add options here.
          </div>
        ) : (
          panels.map((panel) => <DevPanelCard key={panel.id} panel={panel} />)
        )}
      </div>

      <div style={styles.footer}>
        <button
          type="button"
          style={{ ...styles.footerBtn, ...styles.footerBtnDanger }}
          onClick={() => {
            clearAllDevOverlayStorage();
          }}
          title="Reset every dev-overlay value back to its default"
        >
          <IconTrash size={13} />
          Clear all dev-overlay values
        </button>
      </div>
    </div>
  );
}

function DevPanelCard({ panel }: { panel: DevPanel }) {
  const [collapsedRaw, setCollapsedRaw] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return (
        window.localStorage.getItem(`${COLLAPSED_KEY_PREFIX}${panel.id}`) ===
        "1"
      );
    } catch {
      return false;
    }
  });
  const setCollapsed = (next: boolean) => {
    setCollapsedRaw(next);
    try {
      window.localStorage.setItem(
        `${COLLAPSED_KEY_PREFIX}${panel.id}`,
        next ? "1" : "0",
      );
    } catch {
      // ignore — collapsed state is just UX sugar
    }
  };

  return (
    <div style={styles.panel}>
      <button
        type="button"
        style={styles.panelHeader}
        onClick={() => setCollapsed(!collapsedRaw)}
      >
        {collapsedRaw ? (
          <IconChevronRight size={14} />
        ) : (
          <IconChevronDown size={14} />
        )}
        <span style={styles.panelLabel}>{panel.label}</span>
      </button>
      {!collapsedRaw && (
        <div style={styles.panelBody}>
          {panel.description && (
            <div style={styles.panelDesc}>{panel.description}</div>
          )}
          {(panel.options ?? []).map((option) => (
            <DevOptionRow key={option.id} panelId={panel.id} option={option} />
          ))}
          {panel.render ? (
            <div style={styles.customRender}>{panel.render()}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function DevOptionRow({
  panelId,
  option,
}: {
  panelId: string;
  option: DevOption;
}) {
  if (option.type === "boolean") {
    return <DevBooleanRow panelId={panelId} option={option} />;
  }
  if (option.type === "select") {
    return <DevSelectRow panelId={panelId} option={option} />;
  }
  if (option.type === "string") {
    return <DevStringRow panelId={panelId} option={option} />;
  }
  return <DevActionRow option={option} />;
}

function DevBooleanRow({
  panelId,
  option,
}: {
  panelId: string;
  option: DevBooleanOption;
}) {
  const [value, setValue] = useDevOption(
    panelId,
    option.id,
    option.default ?? false,
  );
  return (
    <label style={styles.row}>
      <div style={styles.rowLabels}>
        <div style={styles.rowLabel}>{option.label}</div>
        {option.description && (
          <div style={styles.rowDesc}>{option.description}</div>
        )}
      </div>
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => {
          const next = e.target.checked;
          setValue(next);
          option.onChange?.(next);
        }}
        style={styles.checkbox}
      />
    </label>
  );
}

function DevSelectRow({
  panelId,
  option,
}: {
  panelId: string;
  option: DevSelectOption;
}) {
  const [value, setValue] = useDevOption(
    panelId,
    option.id,
    option.default ?? option.choices[0]?.value ?? "",
  );
  return (
    <div style={styles.row}>
      <div style={styles.rowLabels}>
        <div style={styles.rowLabel}>{option.label}</div>
        {option.description && (
          <div style={styles.rowDesc}>{option.description}</div>
        )}
      </div>
      <select
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          option.onChange?.(next);
        }}
        style={styles.select}
      >
        {option.choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function DevStringRow({
  panelId,
  option,
}: {
  panelId: string;
  option: DevStringOption;
}) {
  const [value, setValue] = useDevOption(
    panelId,
    option.id,
    option.default ?? "",
  );
  return (
    <div
      style={{ ...styles.row, alignItems: "stretch", flexDirection: "column" }}
    >
      <div style={styles.rowLabels}>
        <div style={styles.rowLabel}>{option.label}</div>
        {option.description && (
          <div style={styles.rowDesc}>{option.description}</div>
        )}
      </div>
      <input
        type="text"
        value={value}
        placeholder={option.placeholder}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          option.onChange?.(next);
        }}
        style={styles.input}
      />
    </div>
  );
}

function DevActionRow({ option }: { option: DevActionOption }) {
  const [busy, setBusy] = useState(false);
  return (
    <div style={styles.row}>
      <div style={styles.rowLabels}>
        <div style={styles.rowLabel}>{option.label}</div>
        {option.description && (
          <div style={styles.rowDesc}>{option.description}</div>
        )}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await option.onClick();
          } finally {
            setBusy(false);
          }
        }}
        style={{
          ...styles.actionBtn,
          ...(option.destructive ? styles.actionBtnDanger : {}),
        }}
      >
        {busy ? (
          <IconLoader2
            size={13}
            style={{ animation: "spin 1s linear infinite" }}
          />
        ) : (
          <IconRefresh size={13} />
        )}
        {option.buttonLabel ?? option.label}
      </button>
    </div>
  );
}

// Shadow / border styles tuned to read well over both light and dark app
// chrome — the overlay is dev-only so we don't bother with theme tokens.
const styles: Record<string, React.CSSProperties> = {
  shell: {
    position: "fixed",
    top: 16,
    right: 16,
    bottom: 16,
    width: 380,
    maxWidth: "calc(100vw - 32px)",
    background: "rgba(20, 20, 23, 0.96)",
    color: "#f4f4f5",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12,
    boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', sans-serif",
    fontSize: 13,
    zIndex: 2147483646,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    padding: "14px 16px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
  },
  headerTitle: { fontWeight: 600, fontSize: 14 },
  headerSub: { fontSize: 11, opacity: 0.55, marginTop: 2 },
  iconBtn: {
    background: "transparent",
    border: "none",
    color: "inherit",
    cursor: "pointer",
    padding: 4,
    borderRadius: 6,
    display: "inline-flex",
    alignItems: "center",
  },
  body: {
    padding: 12,
    overflowY: "auto",
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  empty: {
    padding: 16,
    fontSize: 12,
    opacity: 0.7,
    background: "rgba(255,255,255,0.03)",
    borderRadius: 8,
    border: "1px dashed rgba(255,255,255,0.1)",
  },
  panel: {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 8,
    overflow: "hidden",
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    background: "transparent",
    border: "none",
    color: "inherit",
    padding: "10px 12px",
    cursor: "pointer",
    fontSize: 13,
    textAlign: "left",
  },
  panelLabel: { fontWeight: 600 },
  panelBody: {
    padding: "0 12px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  panelDesc: { fontSize: 11, opacity: 0.65, lineHeight: 1.4 },
  customRender: { marginTop: 4 },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  rowLabels: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    flex: 1,
    minWidth: 0,
  },
  rowLabel: { fontSize: 13 },
  rowDesc: { fontSize: 11, opacity: 0.6, lineHeight: 1.4 },
  checkbox: {
    width: 16,
    height: 16,
    cursor: "pointer",
    accentColor: "#3b82f6",
  },
  select: {
    background: "rgba(255,255,255,0.06)",
    color: "inherit",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 6,
    padding: "4px 8px",
    fontSize: 12,
    minWidth: 120,
    cursor: "pointer",
  },
  input: {
    background: "rgba(255,255,255,0.06)",
    color: "inherit",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 6,
    padding: "6px 8px",
    fontSize: 12,
    width: "100%",
    boxSizing: "border-box",
  },
  actionBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "rgba(59,130,246,0.15)",
    color: "#bfdbfe",
    border: "1px solid rgba(59,130,246,0.3)",
    borderRadius: 6,
    padding: "5px 10px",
    fontSize: 12,
    cursor: "pointer",
    fontWeight: 500,
  },
  actionBtnDanger: {
    background: "rgba(239,68,68,0.15)",
    color: "#fecaca",
    border: "1px solid rgba(239,68,68,0.3)",
  },
  footer: {
    padding: 10,
    borderTop: "1px solid rgba(255,255,255,0.06)",
    display: "flex",
    justifyContent: "flex-end",
  },
  footerBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "transparent",
    color: "inherit",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 6,
    padding: "5px 10px",
    fontSize: 11,
    cursor: "pointer",
  },
  footerBtnDanger: { color: "#fecaca", borderColor: "rgba(239,68,68,0.3)" },
};

// Inject keyframes for the spinner once.
if (
  typeof document !== "undefined" &&
  !document.getElementById("agent-native-dev-overlay-keyframes")
) {
  const styleEl = document.createElement("style");
  styleEl.id = "agent-native-dev-overlay-keyframes";
  styleEl.textContent = "@keyframes spin { to { transform: rotate(360deg); } }";
  document.head.appendChild(styleEl);
}

// `ReactNode` is intentionally re-imported here so the file is self-contained
// when consumed via the package's exports map.
export type { ReactNode };
