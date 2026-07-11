import { useEffect, useMemo, useState } from "react";

import { agentNativePath } from "./api-path.js";
import { useChangeVersions } from "./use-change-version.js";
import type { ChatThreadScope } from "./use-chat-threads.js";

const SAFE_BROWSER_TAB_ID_RE = /^[A-Za-z0-9_-]{1,96}$/;
const DEFAULT_MAX_SUGGESTIONS = 4;

export interface AgentDynamicSuggestionContext {
  navigation: unknown;
  selection: unknown;
  pendingSelection: unknown;
  url: unknown;
  scope?: ChatThreadScope | null;
}

export interface AgentDynamicSuggestionsConfig {
  /** Enable/disable dynamic suggestions. Defaults to true. */
  enabled?: boolean;
  /** Maximum number of suggestion chips after merging dynamic + static. */
  max?: number;
  /** Keep the caller-provided static suggestions after dynamic ones. Default true. */
  includeStatic?: boolean;
  /** Optional app-specific deterministic suggestion builder. */
  getSuggestions?: (context: AgentDynamicSuggestionContext) => string[];
}

export type AgentDynamicSuggestionsOption =
  | boolean
  | AgentDynamicSuggestionsConfig;

export interface AgentDynamicSuggestionsResult {
  suggestions: string[] | undefined;
  isLoading: boolean;
}

interface UseAgentDynamicSuggestionsOptions {
  staticSuggestions?: readonly string[];
  dynamicSuggestions?: AgentDynamicSuggestionsOption;
  browserTabId?: string;
  scope?: ChatThreadScope | null;
  enabled?: boolean;
}

interface NormalizedAgentDynamicSuggestionsConfig {
  enabled: boolean;
  max: number;
  includeStatic: boolean;
  getSuggestions?: (context: AgentDynamicSuggestionContext) => string[];
}

export function normalizeAgentDynamicSuggestionsConfig(
  option?: AgentDynamicSuggestionsOption,
): NormalizedAgentDynamicSuggestionsConfig {
  if (option === false) {
    return {
      enabled: false,
      max: DEFAULT_MAX_SUGGESTIONS,
      includeStatic: true,
    };
  }
  if (option === true || option === undefined) {
    return {
      enabled: true,
      max: DEFAULT_MAX_SUGGESTIONS,
      includeStatic: true,
    };
  }
  return {
    enabled: option.enabled !== false,
    max:
      typeof option.max === "number" && Number.isFinite(option.max)
        ? Math.max(1, Math.floor(option.max))
        : DEFAULT_MAX_SUGGESTIONS,
    includeStatic: option.includeStatic !== false,
    ...(option.getSuggestions ? { getSuggestions: option.getSuggestions } : {}),
  };
}

function normalizeBrowserTabId(browserTabId?: string): string | undefined {
  if (typeof browserTabId !== "string") return undefined;
  const trimmed = browserTabId.trim();
  return SAFE_BROWSER_TAB_ID_RE.test(trimmed) ? trimmed : undefined;
}

function appStateKeyForBrowserTab(key: string, browserTabId?: string): string {
  return browserTabId ? `${key}:${browserTabId}` : key;
}

async function readAppState(key: string): Promise<unknown> {
  const res = await fetch(
    agentNativePath(`/_agent-native/application-state/${key}`),
  );
  if (!res.ok || res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readScopedAppState(
  key: string,
  browserTabId?: string,
): Promise<unknown> {
  if (browserTabId) {
    const scoped = await readAppState(
      appStateKeyForBrowserTab(key, browserTabId),
    );
    if (scoped !== null && scoped !== undefined) return scoped;
  }
  return readAppState(key);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringValue(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function humanizeIdentifier(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function hasSelection(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  const record = asRecord(value);
  if (!record) return false;
  if (stringValue(record, "text")) return true;
  const items = record.items;
  if (Array.isArray(items) && items.length > 0) return true;
  const ranges = record.ranges;
  if (Array.isArray(ranges) && ranges.length > 0) return true;
  return false;
}

function inferSurface(context: AgentDynamicSuggestionContext): {
  kind: string;
  label: string;
  slideNumber?: number;
} | null {
  const nav = asRecord(context.navigation);
  const scope = context.scope;
  const view = stringValue(nav, "view");
  const scopeType = scope?.type ? humanizeIdentifier(scope.type) : undefined;
  const scopeLabel = scope?.label?.trim();
  const slideNumber = numberValue(nav, "slideNumber");
  const slideIndex = numberValue(nav, "slideIndex");

  if (slideNumber !== undefined || slideIndex !== undefined) {
    return {
      kind: "slide",
      label: "slide",
      slideNumber: slideNumber ?? (slideIndex ?? 0) + 1,
    };
  }
  if (stringValue(nav, "threadId")) return { kind: "thread", label: "thread" };
  if (stringValue(nav, "focusedEmailId") || stringValue(nav, "emailId")) {
    return { kind: "email", label: "email" };
  }
  if (stringValue(nav, "deckId") || scopeType === "deck") {
    return { kind: "deck", label: scopeLabel || "deck" };
  }
  if (stringValue(nav, "dashboardId") || scopeType === "dashboard") {
    return { kind: "dashboard", label: scopeLabel || "dashboard" };
  }
  if (stringValue(nav, "chartId")) return { kind: "chart", label: "chart" };
  if (stringValue(nav, "formId") || scopeType === "form") {
    return { kind: "form", label: scopeLabel || "form" };
  }
  if (stringValue(nav, "documentId") || stringValue(nav, "docId")) {
    return { kind: "document", label: scopeLabel || "document" };
  }
  if (stringValue(nav, "eventId") || view === "event") {
    return { kind: "event", label: "event" };
  }
  if (
    stringValue(nav, "meetingId") ||
    stringValue(nav, "callId") ||
    view === "meeting" ||
    view === "call"
  ) {
    return { kind: "meeting", label: "meeting" };
  }
  if (
    stringValue(nav, "clipId") ||
    stringValue(nav, "recordingId") ||
    stringValue(nav, "videoId")
  ) {
    return { kind: "recording", label: "recording" };
  }
  if (scopeType && scopeLabel) return { kind: scopeType, label: scopeLabel };
  if (view) return { kind: view, label: humanizeIdentifier(view) };
  return null;
}

export function buildDynamicAgentSuggestions(
  context: AgentDynamicSuggestionContext,
): string[] {
  const suggestions: string[] = [];
  const selected =
    hasSelection(context.selection) || hasSelection(context.pendingSelection);
  const surface = inferSurface(context);

  if (!selected && !surface) {
    return [];
  }

  if (selected) {
    suggestions.push("Summarize this selection");
    suggestions.push("Rewrite this selection");
  }

  switch (surface?.kind) {
    case "slide":
      suggestions.push(
        surface.slideNumber
          ? `Improve slide ${surface.slideNumber}`
          : "Improve this slide",
      );
      suggestions.push("Make this slide more concise");
      suggestions.push("Add speaker notes for this slide");
      break;
    case "deck":
      suggestions.push(`Summarize this ${surface.label}`);
      suggestions.push(`Improve this ${surface.label}`);
      suggestions.push("Create a stronger outline");
      break;
    case "thread":
    case "email":
      suggestions.push("Summarize this thread");
      suggestions.push("Draft a reply");
      suggestions.push("Find the action items");
      break;
    case "dashboard":
    case "chart":
      suggestions.push(`Explain this ${surface.label}`);
      suggestions.push("Find anomalies in this data");
      suggestions.push("Suggest a follow-up chart");
      break;
    case "form":
      suggestions.push(`Improve this ${surface.label}`);
      suggestions.push("Suggest better questions");
      suggestions.push("Summarize recent responses");
      break;
    case "document":
      suggestions.push(`Summarize this ${surface.label}`);
      suggestions.push(`Improve this ${surface.label}`);
      suggestions.push("Find the action items");
      break;
    case "event":
      suggestions.push("Prepare me for this event");
      suggestions.push("Draft a follow-up");
      suggestions.push("Find scheduling conflicts");
      break;
    case "meeting":
    case "recording":
      suggestions.push(`Summarize this ${surface.label}`);
      suggestions.push("Extract action items");
      suggestions.push("Create a shareable summary");
      break;
    case "settings":
      suggestions.push("Explain these settings");
      suggestions.push("Help me configure this screen");
      break;
    case "list":
    case "home":
    case "overview":
      suggestions.push("What should I do next here?");
      suggestions.push("Explain what I am looking at");
      break;
    default:
      if (surface?.label) {
        suggestions.push(`Help me with this ${surface.label}`);
      }
      suggestions.push("Explain what I am looking at");
      suggestions.push("Suggest next steps");
      break;
  }

  return dedupeSuggestions(suggestions);
}

export function dedupeSuggestions(suggestions: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const suggestion of suggestions) {
    const trimmed = suggestion.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export function mergeAgentSuggestions(options: {
  dynamicSuggestions: readonly string[];
  staticSuggestions?: readonly string[];
  includeStatic: boolean;
  max: number;
}): string[] {
  if (options.dynamicSuggestions.length === 0) {
    return options.includeStatic
      ? dedupeSuggestions(options.staticSuggestions ?? [])
      : [];
  }

  const merged = options.includeStatic
    ? [...options.dynamicSuggestions, ...(options.staticSuggestions ?? [])]
    : [...options.dynamicSuggestions];
  return dedupeSuggestions(merged).slice(0, options.max);
}

export function useAgentDynamicSuggestionsResult(
  options: UseAgentDynamicSuggestionsOptions,
): AgentDynamicSuggestionsResult {
  const config = useMemo(
    () => normalizeAgentDynamicSuggestionsConfig(options.dynamicSuggestions),
    [options.dynamicSuggestions],
  );
  const browserTabId = useMemo(
    () => normalizeBrowserTabId(options.browserTabId),
    [options.browserTabId],
  );
  const optionScope = options.scope ?? null;
  const scope = useMemo<ChatThreadScope | null>(
    () =>
      optionScope
        ? {
            type: optionScope.type,
            id: optionScope.id,
            ...(optionScope.label ? { label: optionScope.label } : {}),
          }
        : null,
    [optionScope?.type, optionScope?.id, optionScope?.label],
  );
  const scopeKey = scope
    ? `${scope.type}:${scope.id}:${scope.label ?? ""}`
    : "none";
  const appStateVersion = useChangeVersions(["app-state"]);
  const enabled = options.enabled !== false && config.enabled;
  const [context, setContext] = useState<AgentDynamicSuggestionContext | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setContext(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const load = async (showLoading: boolean) => {
      if (showLoading) setIsLoading(true);
      try {
        const [navigation, selection, pendingSelection, url] =
          await Promise.all([
            readScopedAppState("navigation", browserTabId),
            readScopedAppState("selection", browserTabId),
            readScopedAppState("pending-selection-context", browserTabId),
            readScopedAppState("__url__", browserTabId),
          ]);
        if (cancelled) return;
        setContext({
          navigation,
          selection,
          pendingSelection,
          url,
          scope,
        });
      } catch {
        if (cancelled) return;
        setContext({
          navigation: null,
          selection: null,
          pendingSelection: null,
          url: null,
          scope,
        });
      } finally {
        if (!cancelled && showLoading) setIsLoading(false);
      }
    };

    void load(true);
    const interval = setInterval(() => {
      // The useEffect deps already include appStateVersion, so app-state
      // changes trigger an immediate event-driven refresh above. This
      // interval is only a slow safety net for updates that don't bump
      // that version — skip ticks while the tab isn't visible.
      if (document.hidden) return;
      void load(false);
    }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [appStateVersion, browserTabId, enabled, scope, scopeKey]);

  const suggestions = useMemo(() => {
    if (!enabled) {
      return options.staticSuggestions
        ? dedupeSuggestions(options.staticSuggestions)
        : undefined;
    }
    if (context === null) return undefined;

    const ctx = context;
    const dynamic = config.getSuggestions
      ? config.getSuggestions(ctx)
      : buildDynamicAgentSuggestions(ctx);
    const merged = mergeAgentSuggestions({
      dynamicSuggestions: dynamic,
      staticSuggestions: options.staticSuggestions,
      includeStatic: config.includeStatic,
      max: config.max,
    });
    return merged.length > 0 ? merged : undefined;
  }, [config, context, enabled, scope, scopeKey, options.staticSuggestions]);

  return {
    suggestions,
    isLoading: enabled && (context === null || isLoading),
  };
}

export function useAgentDynamicSuggestions(
  options: UseAgentDynamicSuggestionsOptions,
): string[] | undefined {
  return useAgentDynamicSuggestionsResult(options).suggestions;
}
