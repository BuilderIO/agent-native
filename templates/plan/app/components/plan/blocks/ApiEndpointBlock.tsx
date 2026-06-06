import { useState } from "react";
import {
  IconChevronRight,
  IconLock,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import type { BlockEditProps, BlockReadProps } from "@agent-native/core/blocks";
import type {
  ApiEndpointData,
  ApiEndpointMethod,
  ApiEndpointParam,
  ApiEndpointResponse,
  ApiParamLocation,
} from "@shared/blocks/api-endpoint.config";
import {
  API_ENDPOINT_METHODS,
  API_PARAM_LOCATIONS,
} from "@shared/blocks/api-endpoint.config";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

/** Guess a fence language from a content type so examples highlight nicely. */
function fenceLangForContentType(contentType?: string): string {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("json")) return "json";
  if (ct.includes("xml") || ct.includes("html")) return "html";
  if (ct.includes("yaml") || ct.includes("yml")) return "yaml";
  return "json";
}

/** Wrap a raw example string in a fenced code block for `ctx.renderMarkdown`. */
function fence(example: string, lang: string): string {
  // Never let the example's own content break out of the fence.
  const safe = example.replace(/```/g, "ʼʼʼ");
  return `\`\`\`${lang}\n${safe.trim()}\n\`\`\``;
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
    <section className="plan-block" data-block-id={blockId}>
      {title && <div className="plan-block-label">{title}</div>}
      <div className="overflow-hidden rounded-xl border border-plan-line bg-plan-block">
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
              "min-w-0 truncate font-mono text-sm font-semibold text-plan-text",
              data.deprecated && "text-plan-muted line-through",
            )}
          >
            {data.path}
          </span>
          {data.deprecated && (
            <Badge
              variant="outline"
              className="shrink-0 border-amber-500/40 text-amber-600 dark:text-amber-300"
            >
              Deprecated
            </Badge>
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

        {/* Expanded body. */}
        {open && hasBody && (
          <div className="border-t border-plan-line px-4 py-4">
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
                      {params.map((param, index) => (
                        <tr
                          key={`${param.name}-${index}`}
                          className="border-t border-plan-line align-top"
                        >
                          <td className="px-3 py-2 font-mono text-xs font-semibold text-plan-text">
                            {param.name}
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
                            {param.type || "—"}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {param.required ? (
                              <span className="font-medium text-red-600 dark:text-red-300">
                                required
                              </span>
                            ) : (
                              <span className="text-plan-muted">optional</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-plan-muted">
                            {param.description || "—"}
                          </td>
                        </tr>
                      ))}
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
                  <div className="mt-2 an-api-endpoint-example">
                    {ctx.renderMarkdown?.(
                      fence(
                        data.request.example,
                        fenceLangForContentType(data.request.contentType),
                      ),
                    )}
                  </div>
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
                          <span className="text-sm text-plan-muted">
                            {response.description}
                          </span>
                        )}
                      </div>
                      {response.example && (
                        <div className="border-t border-plan-line px-3 pb-3 pt-1 an-api-endpoint-example">
                          {ctx.renderMarkdown?.(
                            fence(response.example, "json"),
                          )}
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
          <Select
            value={data.method}
            disabled={!editable}
            onValueChange={(value) =>
              patch({ method: value as ApiEndpointMethod })
            }
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {API_ENDPOINT_METHODS.map((method) => (
                <SelectItem key={method} value={method}>
                  {method}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabelClass}>Path</span>
          <Input
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
        <Input
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
        <Textarea
          className="min-h-[80px]"
          value={data.description ?? ""}
          disabled={!editable}
          placeholder="Longer description, rendered as markdown"
          onChange={(event) =>
            patch({ description: event.target.value || undefined })
          }
        />
      </label>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabelClass}>Auth</span>
          <Input
            className="h-9"
            value={data.auth ?? ""}
            disabled={!editable}
            placeholder="e.g. Bearer token"
            onChange={(event) =>
              patch({ auth: event.target.value || undefined })
            }
          />
        </label>
        <label className="flex items-center gap-2 pb-2">
          <Switch
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
              <Input
                className="h-8 font-mono text-xs"
                value={param.name}
                disabled={!editable}
                placeholder="name"
                onChange={(event) =>
                  updateParam(index, { name: event.target.value })
                }
              />
              <Select
                value={param.in}
                disabled={!editable}
                onValueChange={(value) =>
                  updateParam(index, { in: value as ApiParamLocation })
                }
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {API_PARAM_LOCATIONS.map((location) => (
                    <SelectItem key={location} value={location}>
                      {location}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <Input
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
            <Input
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
          </div>
        ))}
      </div>

      {/* Request body */}
      <div className="flex flex-col gap-2">
        <span className={fieldLabelClass}>Request body</span>
        <Input
          className="h-8 font-mono text-xs"
          value={data.request?.contentType ?? ""}
          disabled={!editable}
          placeholder="content type (e.g. application/json)"
          onChange={(event) =>
            updateRequest({ contentType: event.target.value || undefined })
          }
        />
        <Textarea
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
              <Input
                className="h-8 font-mono text-xs"
                value={response.status}
                disabled={!editable}
                placeholder="200"
                onChange={(event) =>
                  updateResponse(index, { status: event.target.value })
                }
              />
              <Input
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
            <Textarea
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
          </div>
        ))}
      </div>
    </div>
  );
}
