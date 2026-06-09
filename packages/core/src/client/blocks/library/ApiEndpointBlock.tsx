import { useState } from "react";
import {
  IconArrowNarrowRight,
  IconChevronRight,
  IconLock,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { cn } from "../../utils.js";
import type { BlockEditProps, BlockReadProps } from "../types.js";
import type {
  ApiEndpointChange,
  ApiEndpointData,
  ApiEndpointMethod,
  ApiEndpointParam,
  ApiEndpointResponse,
  ApiParamLocation,
} from "./api-endpoint.config.js";
import {
  API_ENDPOINT_CHANGES,
  API_ENDPOINT_METHODS,
  API_PARAM_LOCATIONS,
} from "./api-endpoint.config.js";
import { JsonExplorerSurface } from "./JsonExplorerBlock.js";
import {
  DevBadge,
  DevInput,
  DevSwitch,
  DevTextarea,
  DevSelect,
} from "./dev-doc-ui.js";

/**
 * Read + Edit renderers for an `api-endpoint` block — a Swagger / Stripe-style
 * API reference. Lives in core so any app can register the dev-doc block (no
 * shadcn import).
 */

/* ── Theme-aware color tokens ──────────────────────────────────────────────── */

/**
 * Method-pill palette. Tinted background + saturated text in BOTH modes (the
 * reference HTML hardcoded a dark-only palette — we deliberately avoid that).
 * Each entry keeps legible contrast against the plan surface under `.dark` and
 * light via Tailwind `dark:` variants.
 */
const METHOD_PILL: Record<ApiEndpointMethod, string> = {
  GET: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  POST: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  PUT: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  PATCH:
    "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  DELETE: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  HEAD: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
  OPTIONS:
    "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
};

/** Location-badge palette for the params table `in` column. */
const PARAM_IN_BADGE: Record<ApiParamLocation, string> = {
  path: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  query: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  header:
    "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  body: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
};

/** Status-pill palette keyed by the leading status digit (2xx/3xx/4xx/5xx). */
function statusPillClass(status: string): string {
  const lead = status.trim().charAt(0);
  if (lead === "2")
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300";
  if (lead === "4")
    return "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300";
  if (lead === "5")
    return "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300";
  // 3xx and everything else → neutral slate.
  return "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300";
}

/* ── Theme-aware change tokens (shared vocabulary with file-tree/data-model) ── */

/**
 * Change-chip palette — IDENTICAL to `FileTreeBlock`'s `CHANGE_BADGE` so a route /
 * param / response chip reads the same as a file or field change chip elsewhere
 * in the recap. Tinted background + saturated text in BOTH the `.dark` plan theme
 * and light mode via Tailwind `dark:` variants (never a dark-only palette).
 */
const CHANGE_BADGE: Record<ApiEndpointChange, string> = {
  added:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  modified: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  removed: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  renamed:
    "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
};

/** Single-letter glyph shown in the compact chip (VS Code gutter convention). */
const CHANGE_GLYPH: Record<ApiEndpointChange, string> = {
  added: "A",
  modified: "M",
  removed: "D",
  renamed: "R",
};

/** Human label for the chip text + its `title` / `aria-label`. */
const CHANGE_LABEL: Record<ApiEndpointChange, string> = {
  added: "Added",
  modified: "Modified",
  removed: "Removed",
  renamed: "Renamed",
};

/** Accent ink echoing a change color, for the name/path it applies to. */
const CHANGE_INK: Record<ApiEndpointChange, string> = {
  added: "text-emerald-700 dark:text-emerald-300",
  modified: "text-blue-700 dark:text-blue-300",
  removed: "text-red-600 line-through dark:text-red-300",
  renamed: "text-violet-700 dark:text-violet-300",
};

/**
 * A change chip: compact single-glyph badge (A/M/D/R) by default, or a labeled
 * pill (`variant="label"`) for the endpoint header where there is room. Matches
 * the file-tree change badge so the recap reads consistently.
 */
function ChangeChip({
  change,
  variant = "glyph",
  className,
}: {
  change: ApiEndpointChange;
  variant?: "glyph" | "label";
  className?: string;
}) {
  if (variant === "label") {
    return (
      <span
        title={CHANGE_LABEL[change]}
        className={cn(
          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
          CHANGE_BADGE[change],
          className,
        )}
      >
        {CHANGE_LABEL[change]}
      </span>
    );
  }
  return (
    <span
      title={CHANGE_LABEL[change]}
      aria-label={CHANGE_LABEL[change]}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded text-[10px] font-bold leading-none",
        CHANGE_BADGE[change],
        className,
      )}
    >
      {CHANGE_GLYPH[change]}
    </span>
  );
}

/**
 * Before → after for a modified param: the prior `was` value struck through, a
 * narrow arrow, then the current value (e.g. `optional → required`, or the old
 * type → the new type). When `was` is absent we just show the current value.
 */
function WasArrowCurrent({
  was,
  current,
}: {
  was?: string;
  current: React.ReactNode;
}) {
  if (!was) return <>{current}</>;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-plan-muted line-through">{was}</span>
      <IconArrowNarrowRight className="size-3 shrink-0 text-plan-muted" />
      {current}
    </span>
  );
}

/**
 * A param carries a single `was` (prior value) for a `modified` change, but that
 * value may describe either the required flag or the type. Decide which column
 * the before→after belongs to: a `was` of `required`/`optional` is a required
 * flag flip; anything else is treated as the prior type.
 */
function wasIsRequiredFlag(was: string): boolean {
  const v = was.trim().toLowerCase();
  return v === "required" || v === "optional";
}

/** Guess a fence language from a content type so examples highlight nicely. */
function fenceLangForContentType(contentType?: string): string {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("xml") || ct.includes("html")) return "html";
  if (ct.includes("yaml") || ct.includes("yml")) return "yaml";
  return "json";
}

/**
 * Strip JSONC niceties so an otherwise-valid-but-commented example still parses
 * as JSON and earns the collapsible JsonExplorer (instead of falling back to a
 * plain code block). Removes `//` line comments and `/* … *​/` block comments,
 * then trailing commas before `}`/`]`. String contents are preserved: `//`
 * inside a quoted string (e.g. a URL) is NOT treated as a comment.
 */
function stripJsonComments(source: string): string {
  let out = "";
  let inString = false;
  let stringQuote = "";
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        out += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inString) {
      out += char;
      if (char === "\\") {
        // Copy the escaped char verbatim so an escaped quote can't end the
        // string early.
        if (next !== undefined) {
          out += next;
          i += 1;
        }
      } else if (char === stringQuote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      stringQuote = char;
      out += char;
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }

    // Drop a trailing comma before a closing bracket so the result is strict
    // JSON. Done here (not via a post-pass regex) so it stays string-aware: we
    // only reach this branch outside strings/comments, and the structural comma
    // is the last non-whitespace char already emitted. A comma inside a string
    // value like `"hello,}"` is followed by its closing quote, not the bracket,
    // so it is never stripped.
    if (char === "}" || char === "]") {
      out = out.replace(/,\s*$/, "");
    }
    out += char;
  }

  return out;
}

/**
 * Decide whether an example should render with the collapsible JsonExplorer.
 * Returns the strict-JSON text to feed the explorer (comment-stripped when the
 * raw example was JSONC), or `null` when the example is not parseable as JSON
 * (free-form / XML / YAML text) and should fall back to the styled code surface.
 *
 * Parseability — NOT the declared `contentType` — is the gate, so the REQUEST
 * body example earns the same interactive explorer as the RESPONSE examples
 * whenever it is valid JSON. A request often carries a `contentType` that is not
 * literally `application/json` (e.g. a WebSocket-upgrade body) yet still holds a
 * JSON payload; keying off the content type would wrongly drop those into the
 * static code block. `contentType` now only labels the non-JSON code fallback
 * (via `fenceLangForContentType`), it never suppresses the explorer.
 */
function jsonExplorerSource(example: string): string | null {
  try {
    JSON.parse(example);
    return example;
  } catch {
    // Tolerate JSONC: a commented-but-otherwise-valid body still gets the nice
    // explorer. Feed the explorer the stripped (strict-JSON) text so it parses.
    const stripped = stripJsonComments(example);
    try {
      JSON.parse(stripped);
      return stripped;
    } catch {
      return null;
    }
  }
}

/**
 * Plain (non-JSON) example fallback. Renders inside the SAME surface chrome as
 * {@link JsonExplorerSurface} — one `rounded-xl border bg-plan-code` box with a
 * label bar and an `overflow-auto` scroll body — so a JSONC / free-form example
 * reads consistently with the JSON-explorer examples instead of as a separate,
 * differently-styled code box (no extra background tint, no clipped overflow).
 * Font-size is inherited from `--plan-code-size` (the same token the global code
 * rule manages); we never hardcode it here.
 */
function ApiCodeExample({
  code,
  label = "JSON",
  className,
}: {
  code: string;
  label?: string;
  className?: string;
}) {
  return (
    <div
      data-code-surface
      className={cn(
        "overflow-hidden rounded-xl border border-plan-line bg-plan-code",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-plan-line px-3 py-1.5">
        <span className="font-mono text-xs uppercase tracking-wide text-plan-muted">
          {label}
        </span>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono [font-size:var(--plan-doc-code-size)] leading-relaxed text-plan-code-text">
        {code}
      </pre>
    </div>
  );
}

function ApiExample({
  example,
  contentType,
  className,
}: {
  example: string;
  contentType?: string;
  className?: string;
}) {
  const jsonSource = jsonExplorerSource(example);
  if (jsonSource !== null) {
    return (
      <JsonExplorerSurface
        data={{ json: jsonSource, collapsedDepth: 2 }}
        className={className}
      />
    );
  }

  return (
    <ApiCodeExample
      code={example}
      label={fenceLangForContentType(contentType).toUpperCase()}
      className={className}
    />
  );
}

/* ── Read (collapsed-by-default swagger row) ───────────────────────────────── */

/**
 * Read-only renderer for an `api-endpoint` block. Collapsed by default: a single
 * row with a colored method pill, monospace path, muted summary, and a chevron.
 * Clicking the row expands the full reference (description, params table,
 * request body, responses) — the Swagger / Stripe house style. Every colored
 * element is theme-aware (`dark:` variants), so it reads correctly in both the
 * `.dark` plan theme and light mode.
 */
export function ApiEndpointRead({
  data,
  blockId,
  title,
  summary,
  ctx,
}: BlockReadProps<ApiEndpointData>) {
  const [open, setOpen] = useState(false);

  const params = data.params ?? [];
  const responses = data.responses ?? [];
  const hasRequest = Boolean(
    data.request?.example || data.request?.contentType,
  );
  const hasBody =
    Boolean(data.description?.trim()) ||
    params.length > 0 ||
    hasRequest ||
    responses.length > 0 ||
    Boolean(data.auth);

  return (
    // `data-block-type` lets the document flow detect a RUN of consecutive
    // api-endpoint blocks and collapse the divider + gap between them (see
    // `.plan-document-flow` rules in the plan template's global.css), so a list
    // of endpoints reads as one tight scannable group instead of separate
    // full-width cards. `an-api-endpoint-card` is the flush-able card surface
    // those rules round/merge at the run's edges.
    <section
      className="plan-block"
      data-block-id={blockId}
      data-block-type="api-endpoint"
    >
      {title && <div className="plan-block-label">{title}</div>}
      <div className="an-api-endpoint-card overflow-hidden rounded-xl border border-plan-line bg-plan-block">
        {/* Collapsed summary row — the whole row toggles. */}
        <button
          type="button"
          data-plan-interactive
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
            "hover:bg-accent/40",
          )}
        >
          <IconChevronRight
            className={cn(
              "size-4 shrink-0 text-plan-muted transition-transform",
              open && "rotate-90",
            )}
          />
          <span
            className={cn(
              "shrink-0 rounded-md px-2 py-1 font-mono text-xs font-bold uppercase tracking-wide",
              METHOD_PILL[data.method],
            )}
          >
            {data.method}
          </span>
          <span
            className={cn(
              "min-w-0 truncate font-mono text-sm font-semibold",
              // `change` ink composes with `deprecated`: a deprecated route
              // still mutes/strikes its path; a changed route tints it (a
              // removed route also strikes via CHANGE_INK).
              data.change ? CHANGE_INK[data.change] : "text-plan-text",
              data.deprecated && "text-plan-muted line-through",
            )}
          >
            {data.path}
          </span>
          {data.change && <ChangeChip change={data.change} variant="label" />}
          {data.deprecated && (
            <DevBadge className="shrink-0 border-amber-500/40 text-amber-600 dark:text-amber-300">
              Deprecated
            </DevBadge>
          )}
          {(data.summary || summary) && (
            <span className="ml-1 min-w-0 flex-1 truncate text-sm text-plan-muted">
              {data.summary || summary}
            </span>
          )}
          {data.auth && (
            <IconLock
              className="size-3.5 shrink-0 text-plan-muted"
              aria-label="Requires authentication"
            />
          )}
        </button>

        {/* Expanded body. No top divider: the title/summary row flows into the
            content separated by padding alone (the user finds mid-card dividers
            distracting; the outer card border + run-flush behavior stay). */}
        {open && hasBody && (
          <div className="px-4 pb-4 pt-1">
            {data.auth && (
              <div className="mb-4 flex items-center gap-2 text-xs text-plan-muted">
                <IconLock className="size-3.5 shrink-0" />
                <span>
                  <span className="font-medium text-plan-text">Auth:</span>{" "}
                  {data.auth}
                </span>
              </div>
            )}

            {data.description?.trim() && (
              <div className="an-api-endpoint-desc">
                {ctx.renderMarkdown?.(data.description)}
              </div>
            )}

            {params.length > 0 && (
              <div className="mt-5">
                <div className="text-xs font-semibold uppercase tracking-wide text-plan-muted">
                  Parameters
                </div>
                <div className="mt-2 overflow-hidden rounded-lg border border-plan-line">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-accent/30 text-left text-xs uppercase tracking-wide text-plan-muted">
                        <th className="px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">In</th>
                        <th className="px-3 py-2 font-medium">Type</th>
                        <th className="px-3 py-2 font-medium">Required</th>
                        <th className="px-3 py-2 font-medium">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {params.map((param, index) => {
                        const change = param.change;
                        // A `modified` `was` describes either the required flag
                        // or the prior type; route it to the right column.
                        const wasForRequired =
                          change === "modified" &&
                          param.was &&
                          wasIsRequiredFlag(param.was)
                            ? param.was
                            : undefined;
                        const wasForType =
                          change === "modified" &&
                          param.was &&
                          !wasIsRequiredFlag(param.was)
                            ? param.was
                            : undefined;
                        return (
                          <tr
                            key={`${param.name}-${index}`}
                            className="border-t border-plan-line align-top"
                          >
                            <td className="px-3 py-2 font-mono text-xs font-semibold">
                              <span className="flex items-center gap-1.5">
                                <span
                                  className={cn(
                                    change
                                      ? CHANGE_INK[change]
                                      : "text-plan-text",
                                  )}
                                >
                                  {param.name}
                                </span>
                                {change && <ChangeChip change={change} />}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={cn(
                                  "rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold",
                                  PARAM_IN_BADGE[param.in],
                                )}
                              >
                                {param.in}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-plan-muted">
                              <WasArrowCurrent
                                was={wasForType}
                                current={
                                  <span
                                    className={cn(
                                      wasForType && "text-plan-text",
                                    )}
                                  >
                                    {param.type || "—"}
                                  </span>
                                }
                              />
                            </td>
                            <td className="px-3 py-2 text-xs">
                              <WasArrowCurrent
                                was={wasForRequired}
                                current={
                                  param.required ? (
                                    <span className="font-medium text-red-600 dark:text-red-300">
                                      required
                                    </span>
                                  ) : (
                                    <span className="text-plan-muted">
                                      optional
                                    </span>
                                  )
                                }
                              />
                            </td>
                            <td className="px-3 py-2 text-xs text-plan-muted">
                              {param.description || "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {hasRequest && (
              <div className="mt-5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-plan-muted">
                    Request body
                  </span>
                  {data.request?.contentType && (
                    <span className="rounded bg-accent/40 px-1.5 py-0.5 font-mono text-[11px] text-plan-muted">
                      {data.request.contentType}
                    </span>
                  )}
                </div>
                {data.request?.example && (
                  <ApiExample
                    example={data.request.example}
                    contentType={data.request.contentType}
                    className="mt-2 an-api-endpoint-example"
                  />
                )}
              </div>
            )}

            {responses.length > 0 && (
              <div className="mt-5">
                <div className="text-xs font-semibold uppercase tracking-wide text-plan-muted">
                  Responses
                </div>
                <div className="mt-2 flex flex-col gap-3">
                  {responses.map((response, index) => (
                    <div
                      key={`${response.status}-${index}`}
                      className="rounded-lg border border-plan-line"
                    >
                      <div className="flex items-center gap-2 px-3 py-2">
                        <span
                          className={cn(
                            "rounded px-2 py-0.5 font-mono text-xs font-bold",
                            statusPillClass(response.status),
                          )}
                        >
                          {response.status}
                        </span>
                        {response.description && (
                          <span
                            className={cn(
                              "text-sm",
                              response.change
                                ? CHANGE_INK[response.change]
                                : "text-plan-muted",
                            )}
                          >
                            {response.description}
                          </span>
                        )}
                        {response.change && (
                          <ChangeChip
                            change={response.change}
                            variant="label"
                            className="ml-auto"
                          />
                        )}
                      </div>
                      {response.example && (
                        <div className="px-3 pb-3 pt-0 an-api-endpoint-example">
                          <ApiExample
                            example={response.example}
                            className="mt-0"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Edit (panel form) ─────────────────────────────────────────────────────── */

const fieldLabelClass = "text-xs font-medium text-muted-foreground";

/**
 * Options for a change `DevSelect` — a leading "No change" entry (decodes to
 * `undefined`) plus the four diff states, mirroring the file-tree editor.
 */
const CHANGE_SELECT_OPTIONS = [
  { value: "none", label: "No change" },
  ...API_ENDPOINT_CHANGES.map((change) => ({
    value: change,
    label: CHANGE_LABEL[change],
  })),
];

/**
 * Panel editor for an `api-endpoint` block. A property form: method (Select),
 * path/summary/auth (Input), description (Textarea), deprecated (Switch), plus
 * repeatable rows for params and responses (add/remove) and a request-body
 * textarea. Renders BARE content (no `<section>`); the registry's panel surface
 * supplies the popover chrome.
 */
export function ApiEndpointEdit({
  data,
  onChange,
  editable,
}: BlockEditProps<ApiEndpointData>) {
  const params = data.params ?? [];
  const responses = data.responses ?? [];

  const patch = (next: Partial<ApiEndpointData>) =>
    onChange({ ...data, ...next });

  const updateParam = (index: number, next: Partial<ApiEndpointParam>) =>
    patch({
      params: params.map((param, i) =>
        i === index ? { ...param, ...next } : param,
      ),
    });

  const removeParam = (index: number) =>
    patch({ params: params.filter((_, i) => i !== index) });

  const addParam = () =>
    patch({
      params: [...params, { name: "param", in: "query" as ApiParamLocation }],
    });

  const updateResponse = (index: number, next: Partial<ApiEndpointResponse>) =>
    patch({
      responses: responses.map((response, i) =>
        i === index ? { ...response, ...next } : response,
      ),
    });

  const removeResponse = (index: number) =>
    patch({ responses: responses.filter((_, i) => i !== index) });

  const addResponse = () =>
    patch({ responses: [...responses, { status: "200" }] });

  const updateRequest = (next: Partial<ApiEndpointData["request"]>) => {
    const merged = { ...(data.request ?? {}), ...next };
    const empty = !merged.contentType && !merged.example;
    patch({ request: empty ? undefined : merged });
  };

  return (
    <div className="flex flex-col gap-4" data-plan-interactive>
      <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabelClass}>Method</span>
          <DevSelect
            className="h-9"
            value={data.method}
            disabled={!editable}
            onValueChange={(value) =>
              patch({ method: value as ApiEndpointMethod })
            }
            options={API_ENDPOINT_METHODS.map((method) => ({
              value: method,
              label: method,
            }))}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabelClass}>Path</span>
          <DevInput
            className="h-9 font-mono"
            value={data.path}
            disabled={!editable}
            placeholder="/api/resource"
            onChange={(event) => patch({ path: event.target.value })}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={fieldLabelClass}>Summary</span>
        <DevInput
          className="h-9"
          value={data.summary ?? ""}
          disabled={!editable}
          placeholder="Short one-line description"
          onChange={(event) =>
            patch({ summary: event.target.value || undefined })
          }
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={fieldLabelClass}>Description (markdown)</span>
        <DevTextarea
          className="min-h-[80px]"
          value={data.description ?? ""}
          disabled={!editable}
          placeholder="Longer description, rendered as markdown"
          onChange={(event) =>
            patch({ description: event.target.value || undefined })
          }
        />
      </label>

      <div className="grid grid-cols-[minmax(0,1fr)_120px_auto] items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabelClass}>Auth</span>
          <DevInput
            className="h-9"
            value={data.auth ?? ""}
            disabled={!editable}
            placeholder="e.g. Bearer token"
            onChange={(event) =>
              patch({ auth: event.target.value || undefined })
            }
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabelClass}>Change</span>
          <DevSelect
            className="h-9"
            value={data.change ?? "none"}
            disabled={!editable}
            onValueChange={(value) =>
              patch({
                change:
                  value === "none" ? undefined : (value as ApiEndpointChange),
              })
            }
            options={CHANGE_SELECT_OPTIONS}
          />
        </label>
        <label className="flex items-center gap-2 pb-2">
          <DevSwitch
            checked={Boolean(data.deprecated)}
            disabled={!editable}
            onCheckedChange={(checked) =>
              patch({ deprecated: checked || undefined })
            }
          />
          <span className={fieldLabelClass}>Deprecated</span>
        </label>
      </div>

      {/* Params */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className={fieldLabelClass}>Parameters</span>
          {editable && (
            <button
              type="button"
              data-plan-interactive
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              onClick={addParam}
            >
              <IconPlus className="size-3.5" />
              Add
            </button>
          )}
        </div>
        {params.map((param, index) => (
          <div
            key={index}
            className="flex flex-col gap-2 rounded-md border border-input p-2"
          >
            <div className="grid grid-cols-[minmax(0,1fr)_96px_auto] gap-2">
              <DevInput
                className="h-8 font-mono text-xs"
                value={param.name}
                disabled={!editable}
                placeholder="name"
                onChange={(event) =>
                  updateParam(index, { name: event.target.value })
                }
              />
              <DevSelect
                className="h-8"
                value={param.in}
                disabled={!editable}
                onValueChange={(value) =>
                  updateParam(index, { in: value as ApiParamLocation })
                }
                options={API_PARAM_LOCATIONS.map((location) => ({
                  value: location,
                  label: location,
                }))}
              />
              {editable && (
                <button
                  type="button"
                  data-plan-interactive
                  aria-label="Remove parameter"
                  className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  onClick={() => removeParam(index)}
                >
                  <IconTrash className="size-4" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <DevInput
                className="h-8 font-mono text-xs"
                value={param.type ?? ""}
                disabled={!editable}
                placeholder="type (e.g. string)"
                onChange={(event) =>
                  updateParam(index, { type: event.target.value || undefined })
                }
              />
              <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="size-3.5 cursor-pointer accent-primary"
                  checked={Boolean(param.required)}
                  disabled={!editable}
                  onChange={(event) =>
                    updateParam(index, {
                      required: event.target.checked || undefined,
                    })
                  }
                />
                Required
              </label>
            </div>
            <DevInput
              className="h-8 text-xs"
              value={param.description ?? ""}
              disabled={!editable}
              placeholder="description"
              onChange={(event) =>
                updateParam(index, {
                  description: event.target.value || undefined,
                })
              }
            />
            {/* Diff state: change kind + the prior value (`was`) shown
                struck-through before the current one when "modified". */}
            <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
              <DevSelect
                className="h-8"
                value={param.change ?? "none"}
                disabled={!editable}
                onValueChange={(value) =>
                  updateParam(index, {
                    change:
                      value === "none"
                        ? undefined
                        : (value as ApiEndpointChange),
                  })
                }
                options={CHANGE_SELECT_OPTIONS}
              />
              <DevInput
                className="h-8 font-mono text-xs"
                value={param.was ?? ""}
                disabled={!editable || param.change !== "modified"}
                placeholder="was (e.g. optional, or old type)"
                onChange={(event) =>
                  updateParam(index, { was: event.target.value || undefined })
                }
              />
            </div>
          </div>
        ))}
      </div>

      {/* Request body */}
      <div className="flex flex-col gap-2">
        <span className={fieldLabelClass}>Request body</span>
        <DevInput
          className="h-8 font-mono text-xs"
          value={data.request?.contentType ?? ""}
          disabled={!editable}
          placeholder="content type (e.g. application/json)"
          onChange={(event) =>
            updateRequest({ contentType: event.target.value || undefined })
          }
        />
        <DevTextarea
          className="min-h-[80px] font-mono text-xs"
          value={data.request?.example ?? ""}
          disabled={!editable}
          placeholder='{ "example": "request body" }'
          onChange={(event) =>
            updateRequest({ example: event.target.value || undefined })
          }
        />
      </div>

      {/* Responses */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className={fieldLabelClass}>Responses</span>
          {editable && (
            <button
              type="button"
              data-plan-interactive
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              onClick={addResponse}
            >
              <IconPlus className="size-3.5" />
              Add
            </button>
          )}
        </div>
        {responses.map((response, index) => (
          <div
            key={index}
            className="flex flex-col gap-2 rounded-md border border-input p-2"
          >
            <div className="grid grid-cols-[96px_minmax(0,1fr)_auto] gap-2">
              <DevInput
                className="h-8 font-mono text-xs"
                value={response.status}
                disabled={!editable}
                placeholder="200"
                onChange={(event) =>
                  updateResponse(index, { status: event.target.value })
                }
              />
              <DevInput
                className="h-8 text-xs"
                value={response.description ?? ""}
                disabled={!editable}
                placeholder="description"
                onChange={(event) =>
                  updateResponse(index, {
                    description: event.target.value || undefined,
                  })
                }
              />
              {editable && (
                <button
                  type="button"
                  data-plan-interactive
                  aria-label="Remove response"
                  className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  onClick={() => removeResponse(index)}
                >
                  <IconTrash className="size-4" />
                </button>
              )}
            </div>
            <DevTextarea
              className="min-h-[64px] font-mono text-xs"
              value={response.example ?? ""}
              disabled={!editable}
              placeholder='{ "example": "response body" }'
              onChange={(event) =>
                updateResponse(index, {
                  example: event.target.value || undefined,
                })
              }
            />
            <label className="flex items-center gap-2">
              <span className={fieldLabelClass}>Change</span>
              <DevSelect
                className="h-8 w-[120px]"
                value={response.change ?? "none"}
                disabled={!editable}
                onValueChange={(value) =>
                  updateResponse(index, {
                    change:
                      value === "none"
                        ? undefined
                        : (value as ApiEndpointChange),
                  })
                }
                options={CHANGE_SELECT_OPTIONS}
              />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
