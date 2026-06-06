import { useId, useMemo, useState } from "react";
import { IconChevronRight } from "@tabler/icons-react";
import type { BlockEditProps, BlockReadProps } from "@agent-native/core/blocks";
import type { JsonExplorerData } from "@shared/blocks/json-explorer.config";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Read + Edit renderers for a `json-explorer` block — a browser-devtools /
 * Postman-style collapsible JSON tree. The raw JSON TEXT (`data.json`) is the
 * source of truth; the Read renderer parses it defensively and, on any parse
 * error, falls back to the raw text plus the error message (it never throws).
 *
 * Progressive disclosure is the whole point: object/array nodes show a chevron
 * and a one-line summary ("{…} 3 keys" / "[…] 5 items"); each node tracks its
 * own open/closed state (`useState`) seeded by `collapsedDepth` so deep payloads
 * stay scannable. Leaf values are type-colored (string = green, number = blue,
 * boolean = violet, null = muted); keys use a stable accent color; subtle indent
 * guide lines mark nesting.
 *
 * DARK/LIGHT: the plan editor toggles `next-themes` (adding `.dark` on <html>).
 * Every color token — value types, keys, guide lines, chrome — uses Tailwind
 * `dark:` variants or the theme-aware plan CSS-var utilities, so the tree reads
 * correctly in BOTH modes (no hardcoded dark-only palette).
 */

/* ── Theme-aware value-type color tokens ───────────────────────────────────── */

/** String leaves: green in both modes. */
const STRING_CLASS = "text-emerald-700 dark:text-emerald-300";
/** Number leaves: blue in both modes. */
const NUMBER_CLASS = "text-blue-700 dark:text-blue-300";
/** Boolean leaves: violet in both modes. */
const BOOLEAN_CLASS = "text-violet-700 dark:text-violet-300";
/** `null`/`undefined` leaves: muted (theme-aware plan var). */
const NULL_CLASS = "text-plan-muted italic";
/** Object keys: a stable, saturated accent that reads in both modes. */
const KEY_CLASS = "text-rose-700 dark:text-rose-300";
/** Structural punctuation (braces, brackets, commas, colons). */
const PUNCT_CLASS = "text-plan-muted";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

interface ParseResult {
  ok: boolean;
  value?: JsonValue;
  error?: string;
}

function parseJson(raw: string): ParseResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "Empty payload — add some JSON to explore." };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) as JsonValue };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid JSON",
    };
  }
}

function isContainer(value: JsonValue): value is JsonValue[] | JsonObject {
  return value !== null && typeof value === "object";
}

/** One-line summary for a collapsed container, devtools style. */
function containerSummary(value: JsonValue[] | JsonObject): string {
  if (Array.isArray(value)) {
    const count = value.length;
    return `[…] ${count} ${count === 1 ? "item" : "items"}`;
  }
  const count = Object.keys(value).length;
  return `{…} ${count} ${count === 1 ? "key" : "keys"}`;
}

/** Render a leaf (primitive) value with its type color. */
function LeafValue({ value }: { value: string | number | boolean | null }) {
  if (value === null) {
    return <span className={NULL_CLASS}>null</span>;
  }
  if (typeof value === "string") {
    return <span className={STRING_CLASS}>{JSON.stringify(value)}</span>;
  }
  if (typeof value === "number") {
    return <span className={NUMBER_CLASS}>{String(value)}</span>;
  }
  // boolean
  return <span className={BOOLEAN_CLASS}>{String(value)}</span>;
}

interface JsonNodeProps {
  /** The object key or array index label for this node (root has none). */
  label?: string | number;
  value: JsonValue;
  depth: number;
  /** Depth beyond which nodes start collapsed. */
  collapsedDepth: number;
  /** Global expand/collapse pulse — overrides per-node seed when changed. */
  forceOpen: boolean | null;
  /** True when this node is followed by a sibling (renders a trailing comma). */
  trailingComma?: boolean;
}

/**
 * A single tree node. Containers (object/array) get their own collapse state,
 * seeded from `collapsedDepth` and re-seeded whenever the global expand/collapse
 * "pulse" (`forceOpen`) flips. Leaves render inline with their type color.
 */
function JsonNode({
  label,
  value,
  depth,
  collapsedDepth,
  forceOpen,
  trailingComma,
}: JsonNodeProps) {
  const seededOpen = depth < collapsedDepth;
  // `forceOpen` is the global pulse: when the user hits expand/collapse all we
  // flip every node, but per-node toggles still win afterward (the pulse is part
  // of the state key via `useMemo` reseed below).
  const [open, setOpen] = useState(seededOpen);
  // Re-seed when the global pulse changes. Keyed by `forceOpen` identity.
  useMemo(() => {
    if (forceOpen !== null) setOpen(forceOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceOpen]);

  const keyEl =
    label !== undefined ? (
      <>
        <span className={KEY_CLASS}>
          {typeof label === "number" ? label : JSON.stringify(label)}
        </span>
        <span className={PUNCT_CLASS}>: </span>
      </>
    ) : null;

  if (!isContainer(value)) {
    return (
      <div className="flex items-start py-0.5 leading-relaxed">
        <span className="select-none whitespace-pre">{keyEl}</span>
        <LeafValue value={value} />
        {trailingComma && <span className={PUNCT_CLASS}>,</span>}
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: Array<[string | number, JsonValue]> = isArray
    ? (value as JsonValue[]).map((item, index) => [index, item])
    : Object.entries(value as JsonObject);
  const openBrace = isArray ? "[" : "{";
  const closeBrace = isArray ? "]" : "}";
  const empty = entries.length === 0;

  return (
    <div className="leading-relaxed">
      <button
        type="button"
        data-plan-interactive
        aria-expanded={open}
        disabled={empty}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "group flex w-full items-start gap-1 rounded py-0.5 text-left transition-colors",
          !empty && "hover:bg-accent/40",
          empty && "cursor-default",
        )}
      >
        <IconChevronRight
          className={cn(
            "mt-1 size-3.5 shrink-0 text-plan-muted transition-transform",
            open && "rotate-90",
            empty && "opacity-0",
          )}
        />
        <span className="min-w-0 whitespace-pre-wrap break-words">
          {keyEl}
          <span className={PUNCT_CLASS}>{openBrace}</span>
          {!open && !empty && (
            <span className="ml-1 text-plan-muted">
              {containerSummary(value)}
            </span>
          )}
          {(!open || empty) && (
            <span className={PUNCT_CLASS}>
              {empty ? "" : "…"}
              {closeBrace}
              {trailingComma ? "," : ""}
            </span>
          )}
        </span>
      </button>

      {open && !empty && (
        <>
          {/* Indent guide: a subtle vertical rule marks the nesting level. */}
          <div className="ml-[7px] border-l border-plan-line pl-3.5">
            {entries.map(([entryKey, entryValue], index) => (
              <JsonNode
                key={String(entryKey)}
                label={entryKey}
                value={entryValue}
                depth={depth + 1}
                collapsedDepth={collapsedDepth}
                forceOpen={forceOpen}
                trailingComma={index < entries.length - 1}
              />
            ))}
          </div>
          <div className="flex items-start">
            {/* Align the closing brace under the chevron column. */}
            <span className="ml-[18px] whitespace-pre">
              <span className={PUNCT_CLASS}>{closeBrace}</span>
              {trailingComma && <span className={PUNCT_CLASS}>,</span>}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Read (collapsible devtools tree) ──────────────────────────────────────── */

/**
 * Read-only renderer for a `json-explorer` block. Parses `data.json` defensively
 * and renders the collapsible tree; on a parse error it shows the raw payload in
 * a monospace block plus the error (never throws). An "Expand all / Collapse
 * all" control toggles every node at once via a global pulse counter.
 */
export function JsonExplorerRead({
  data,
  blockId,
  title,
  summary,
}: BlockReadProps<JsonExplorerData>) {
  const parsed = useMemo(() => parseJson(data.json), [data.json]);
  const collapsedDepth = data.collapsedDepth ?? 1;
  // `pulse` carries a boolean (expand/collapse) plus a nonce so repeated clicks
  // of the same action still re-fire the reseed in each node.
  const [pulse, setPulse] = useState<{ open: boolean; nonce: number } | null>(
    null,
  );
  const heading = data.title ?? title;

  return (
    <section className="plan-block" data-block-id={blockId}>
      {heading && <div className="plan-block-label">{heading}</div>}
      <div className="overflow-hidden rounded-xl border border-plan-line bg-plan-code">
        <div className="flex items-center justify-between gap-2 border-b border-plan-line px-3 py-1.5">
          <span className="font-mono text-xs uppercase tracking-wide text-plan-muted">
            JSON
          </span>
          {parsed.ok && isContainer(parsed.value as JsonValue) && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                data-plan-interactive
                onClick={() =>
                  setPulse((prev) => ({
                    open: true,
                    nonce: (prev?.nonce ?? 0) + 1,
                  }))
                }
                className="rounded px-1.5 py-0.5 text-xs text-plan-muted transition-colors hover:bg-accent/60 hover:text-plan-text"
              >
                Expand all
              </button>
              <span className="text-plan-muted">·</span>
              <button
                type="button"
                data-plan-interactive
                onClick={() =>
                  setPulse((prev) => ({
                    open: false,
                    nonce: (prev?.nonce ?? 0) + 1,
                  }))
                }
                className="rounded px-1.5 py-0.5 text-xs text-plan-muted transition-colors hover:bg-accent/60 hover:text-plan-text"
              >
                Collapse all
              </button>
            </div>
          )}
        </div>
        <div className="overflow-auto px-3 py-2.5 font-mono text-sm text-plan-code-text">
          {parsed.ok ? (
            <JsonNode
              // Remount the whole tree when the global pulse fires so every node
              // re-seeds from the new open/closed state cleanly.
              key={pulse?.nonce ?? 0}
              value={parsed.value as JsonValue}
              depth={0}
              collapsedDepth={collapsedDepth}
              forceOpen={pulse?.open ?? null}
            />
          ) : (
            <div className="space-y-2">
              <pre className="overflow-auto whitespace-pre-wrap break-words text-plan-code-text">
                {data.json || "—"}
              </pre>
              <p className="text-xs text-red-600 dark:text-red-300">
                Could not parse JSON: {parsed.error}
              </p>
            </div>
          )}
        </div>
      </div>
      {summary && <p className="mt-5 text-plan-muted">{summary}</p>}
    </section>
  );
}

/* ── Edit (panel form) ─────────────────────────────────────────────────────── */

/**
 * Panel editor for a `json-explorer` block: a monospace textarea bound to the
 * raw `json`, a "Format" button that pretty-prints via `JSON.parse` →
 * `JSON.stringify(_, null, 2)` (guarded — shows an INLINE error, never
 * `window.alert`), a `collapsedDepth` number input, and a `title` input. Renders
 * BARE content (no `<section>`); the registry's panel surface supplies the
 * popover chrome.
 */
export function JsonExplorerEdit({
  data,
  onChange,
  editable,
}: BlockEditProps<JsonExplorerData>) {
  const jsonId = useId();
  const titleId = useId();
  const depthId = useId();
  const [formatError, setFormatError] = useState<string | null>(null);

  const handleFormat = () => {
    try {
      const formatted = JSON.stringify(JSON.parse(data.json), null, 2);
      setFormatError(null);
      onChange({ ...data, json: formatted });
    } catch (error) {
      setFormatError(
        error instanceof Error ? error.message : "Invalid JSON — cannot format",
      );
    }
  };

  return (
    <div className="grid gap-3" data-plan-interactive>
      <div className="grid gap-1.5">
        <Label htmlFor={titleId}>Title</Label>
        <Input
          id={titleId}
          value={data.title ?? ""}
          readOnly={!editable}
          onChange={(event) =>
            onChange({ ...data, title: event.target.value || undefined })
          }
          placeholder="Optional heading"
        />
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor={jsonId}>JSON payload</Label>
          {editable && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 cursor-pointer px-2 text-xs"
              onClick={handleFormat}
            >
              Format
            </Button>
          )}
        </div>
        <Textarea
          id={jsonId}
          value={data.json}
          readOnly={!editable}
          spellCheck={false}
          onChange={(event) => {
            setFormatError(null);
            onChange({ ...data, json: event.target.value });
          }}
          className="min-h-56 font-mono text-xs"
          placeholder={'{\n  "id": "abc123",\n  "active": true\n}'}
        />
        {formatError && (
          <p className="text-xs text-red-600 dark:text-red-300">
            {formatError}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Raw JSON text is the source of truth. Use Format to pretty-print it.
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={depthId}>Collapsed depth</Label>
        <Input
          id={depthId}
          type="number"
          min={0}
          max={20}
          value={data.collapsedDepth ?? 1}
          readOnly={!editable}
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10);
            onChange({
              ...data,
              collapsedDepth: Number.isFinite(next)
                ? Math.max(0, Math.min(20, next))
                : undefined,
            });
          }}
          className="w-24"
        />
        <p className="text-xs text-muted-foreground">
          Nodes deeper than this start collapsed (default 1).
        </p>
      </div>
    </div>
  );
}
