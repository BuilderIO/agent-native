import { lazy, Suspense, type ComponentType } from "react";

import {
  ACTION_CHAT_UI_AGENT_TEAM_PROGRESS_RENDERER,
  ACTION_CHAT_UI_DATA_CHART_RENDERER,
  ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER,
  ACTION_CHAT_UI_DATA_TABLE_RENDERER,
  ACTION_CHAT_UI_DATA_WIDGET_RENDERER,
  ACTION_CHAT_UI_INLINE_EXTENSION_RENDERER,
  ACTION_CHAT_UI_RECORD_CHANGE_RENDERER,
  ACTION_CHAT_UI_WORKSPACE_FILE_RENDERER,
  normalizeAgentTeamProgressResult,
  normalizeActionChangeResult,
  type ActionChange,
} from "../../../action-ui.js";
import { normalizeConnectRequiredResult } from "../../../shared/connect-required.js";
import { useT } from "../../i18n.js";
import { buildOpenRouteLink } from "../../navigation/index.js";
import {
  registerReservedActionChatRenderer,
  registerReservedFallbackToolRenderer,
  registerReservedToolRenderer,
  type ToolRendererContext,
  type ToolRendererComponent,
} from "../tool-render-registry.js";
import {
  DATA_CHART_WIDGET,
  DATA_INSIGHTS_WIDGET,
  DATA_TABLE_WIDGET,
  normalizeDataWidgetKind,
  normalizeDataWidgetResult,
  type DataWidgetResult,
} from "./data-widget-types.js";
import { normalizeInlineExtensionToolResult } from "./inline-extension-result.js";
import { normalizeWorkspaceFileResult } from "./workspace-file-result.js";

const LazyDataChartWidget = lazy(() =>
  import("./DataChartWidget.js").then((module) => ({
    default: module.DataChartWidget,
  })),
);
const LazyDataInsightsWidget = lazy(() =>
  import("./DataInsightsWidget.js").then((module) => ({
    default: module.DataInsightsWidget,
  })),
);
const LazyDataTableWidget = lazy(() =>
  import("./DataTableWidget.js").then((module) => ({
    default: module.DataTableWidget,
  })),
);
const LazyConnectRequiredWidget = lazy(() =>
  import("./ConnectRequiredWidget.js").then((module) => ({
    default: module.ConnectRequiredWidget,
  })),
);
const LazyInlineExtensionWidget = lazy(() =>
  import("./InlineExtensionWidget.js").then((module) => ({
    default: module.InlineExtensionWidget,
  })),
);
const LazyWorkspaceFileWidget = lazy(() =>
  import("./WorkspaceFileWidget.js").then((module) => ({
    default: module.WorkspaceFileWidget,
  })),
);
const LazyRecordChangeWidget: ComponentType<{
  context: ToolRendererContext;
}> =
  (import.meta.env?.SSR ?? typeof window === "undefined")
    ? () => null
    : lazy(() =>
        import("./RecordChangeWidget.js").then((module) => ({
          default: module.RecordChangeWidget,
        })),
      );
const LazyAgentTeamProgressWidget: ComponentType<{
  context: ToolRendererContext;
}> =
  (import.meta.env?.SSR ?? typeof window === "undefined")
    ? () => null
    : lazy(() =>
        import("./AgentTeamProgressWidget.js").then((module) => ({
          default: module.AgentTeamProgressWidget,
        })),
      );

const LEGACY_RECORD_CHANGE_RENDERERS = [
  "mail.ai-filter-confirmation",
  "mail.draft-created",
  "mail.gmail-filter-confirmation",
  "calendar.event-created",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeLegacyActionChangeResult(
  context: ToolRendererContext,
): ReturnType<typeof normalizeActionChangeResult> {
  const current = normalizeActionChangeResult(context.resultJson);
  if (current) return current;

  const renderer = context.chatUI?.renderer;
  if (!LEGACY_RECORD_CHANGE_RENDERERS.some((id) => id === renderer))
    return null;
  const result = isRecord(context.resultJson) ? context.resultJson : {};
  let change: ActionChange | undefined;

  if (renderer === "mail.ai-filter-confirmation") {
    const changed = result.changed;
    if (
      context.toolName === "apply-ai-filter" &&
      Number.isSafeInteger(changed) &&
      typeof changed === "number" &&
      changed > 0 &&
      (context.args.mode === "filter" || context.args.mode === "keep")
    ) {
      change = {
        verb: "updated",
        kind: "mail-filter",
        title: context.args.mode === "filter" ? "Filtered email" : "Kept email",
        detail: String(changed),
      };
    }
  } else if (renderer === "mail.draft-created") {
    const draft = isRecord(result.draft) ? result.draft : {};
    const subject = text(context.args.subject) ?? text(draft.subject);
    const recipient = text(context.args.to) ?? text(draft.to);
    const deepLink = text(result.deepLink);
    let draftId = text(result.id) ?? text(context.args.id);
    if (
      !draftId &&
      deepLink &&
      URL.canParse(deepLink, "https://agent-native.invalid")
    ) {
      const url = new URL(deepLink, "https://agent-native.invalid");
      if (
        url.origin === "https://agent-native.invalid" &&
        url.pathname.endsWith("/_agent-native/open")
      ) {
        draftId = text(url.searchParams.get("composeDraftId"));
      }
    }
    if (
      context.toolName === "manage-draft" &&
      context.args.action === "create" &&
      (subject || recipient || draftId)
    ) {
      change = {
        verb: "created",
        kind: "email-draft",
        title: (subject ?? recipient ?? draftId)!.slice(0, 180),
        ...(subject && recipient ? { detail: recipient.slice(0, 500) } : {}),
        ...(deepLink ? { url: deepLink } : {}),
      };
    }
  } else if (renderer === "mail.gmail-filter-confirmation") {
    const filter = isRecord(result.filter) ? result.filter : {};
    const operation = context.args.operation;
    if (
      context.toolName === "manage-gmail-filters" &&
      !context.isRunning &&
      (operation === "create" || operation === "replace") &&
      result.ok === true &&
      text(result.message) &&
      text(result.accountEmail) &&
      text(filter.id) &&
      text(filter.criteriaSummary) &&
      text(filter.actionSummary)
    ) {
      const url = new URL("https://mail.google.com/mail/");
      url.searchParams.set("authuser", text(result.accountEmail)!);
      url.hash = "settings/filters";
      change = {
        verb: operation === "create" ? "created" : "updated",
        kind: "gmail-filter",
        title: text(filter.criteriaSummary)!.slice(0, 180),
        detail: text(filter.actionSummary)!.slice(0, 500),
        url: url.toString(),
      };
    }
  } else if (
    renderer === "calendar.event-created" &&
    context.toolName === "create-event" &&
    !context.isRunning
  ) {
    const title = text(result.title);
    const start = text(result.start);
    const end = text(result.end);
    if (title && start && end) {
      const eventId = text(result.id);
      change = {
        verb: "created",
        kind: "calendar-event",
        title: title.slice(0, 180),
        detail: [start, end, text(result.location)]
          .filter((part): part is string => Boolean(part))
          .join(" · ")
          .slice(0, 500),
        ...(eventId
          ? {
              url: buildOpenRouteLink({
                app: "calendar",
                view: "calendar",
                params: { eventId },
              }).url,
            }
          : {}),
      };
    }
  }

  return change ? normalizeActionChangeResult({ change }) : null;
}

export function normalizeBuiltinActionChangeResult(
  context: ToolRendererContext,
) {
  return (
    normalizeActionChangeResult(context.resultJson) ??
    normalizeLegacyActionChangeResult(context)
  );
}

function normalizeActionDataWidgetResult(
  context: ToolRendererContext,
): DataWidgetResult | null {
  const renderer = context.chatUI?.renderer;
  if (isRecord(context.resultJson)) {
    if (renderer === ACTION_CHAT_UI_DATA_TABLE_RENDERER) {
      return normalizeDataWidgetResult({
        ...context.resultJson,
        widget: DATA_TABLE_WIDGET,
        table: isRecord(context.resultJson.table)
          ? context.resultJson.table
          : context.resultJson,
      });
    }
    if (renderer === ACTION_CHAT_UI_DATA_CHART_RENDERER) {
      return normalizeDataWidgetResult({
        ...context.resultJson,
        widget: DATA_CHART_WIDGET,
        chartSeries: isRecord(context.resultJson.chartSeries)
          ? context.resultJson.chartSeries
          : context.resultJson,
      });
    }
    if (renderer === ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER) {
      return normalizeDataWidgetResult({
        ...context.resultJson,
        widget: DATA_INSIGHTS_WIDGET,
      });
    }
  }

  const result = normalizeDataWidgetResult(context.resultJson);
  if (result) return result;

  if (
    renderer === ACTION_CHAT_UI_DATA_WIDGET_RENDERER ||
    context.toolName === "render-data-widget"
  ) {
    const argsResult = normalizeDataWidgetResult(context.args);
    if (argsResult) return argsResult;
  }

  return null;
}

function renderDataWidget(context: ToolRendererContext) {
  const result =
    normalizeActionDataWidgetResult(context) ??
    normalizeDataWidgetResult(context.resultJson);
  if (!result) return null;
  const widget = normalizeDataWidgetKind(result.widget);
  if (widget === DATA_TABLE_WIDGET && result.table) {
    return (
      <Suspense fallback={<BuiltinToolRendererSkeleton />}>
        <LazyDataTableWidget
          table={result.table}
          action={result.display?.primaryAction}
        />
      </Suspense>
    );
  }
  if (widget === DATA_CHART_WIDGET && result.chartSeries) {
    return (
      <Suspense fallback={<BuiltinToolRendererSkeleton />}>
        <LazyDataChartWidget chart={result.chartSeries} />
      </Suspense>
    );
  }
  if (widget === DATA_INSIGHTS_WIDGET) {
    return (
      <Suspense fallback={<BuiltinToolRendererSkeleton />}>
        <LazyDataInsightsWidget result={result} />
      </Suspense>
    );
  }
  return null;
}

function BuiltinToolRendererSkeleton({ framed = true }: { framed?: boolean }) {
  const t = useT();
  return (
    <div
      aria-label={t("agentChat.widget.loadingToolResult")}
      className={
        framed
          ? "my-1.5 h-24 animate-pulse rounded-lg border border-border bg-muted/30"
          : "h-24 animate-pulse bg-muted/30"
      }
    />
  );
}

const BuiltinDataWidgetRenderer: ToolRendererComponent = ({ context }) =>
  renderDataWidget(context);

const BuiltinInlineExtensionRenderer: ToolRendererComponent = ({ context }) =>
  normalizeInlineExtensionToolResult(context) ? (
    <Suspense fallback={<BuiltinToolRendererSkeleton framed={false} />}>
      <LazyInlineExtensionWidget context={context} />
    </Suspense>
  ) : null;

const BuiltinConnectRequiredRenderer: ToolRendererComponent = ({ context }) => {
  const card = normalizeConnectRequiredResult(context.resultJson);
  return card ? (
    <Suspense fallback={<BuiltinToolRendererSkeleton framed={false} />}>
      <LazyConnectRequiredWidget card={card} />
    </Suspense>
  ) : null;
};

const BuiltinWorkspaceFileRenderer: ToolRendererComponent = ({ context }) => {
  const result = normalizeWorkspaceFileResult(context.resultJson);
  return result ? (
    <Suspense fallback={<BuiltinToolRendererSkeleton framed={false} />}>
      <LazyWorkspaceFileWidget result={result} />
    </Suspense>
  ) : null;
};

const BuiltinRecordChangeRenderer: ToolRendererComponent = ({ context }) => {
  const normalized = normalizeBuiltinActionChangeResult(context);
  if (
    !normalized &&
    !(
      context.isRunning &&
      context.chatUI?.renderer === ACTION_CHAT_UI_RECORD_CHANGE_RENDERER
    )
  ) {
    return null;
  }
  return (
    <Suspense fallback={<BuiltinToolRendererSkeleton framed={false} />}>
      <LazyRecordChangeWidget
        context={{ ...context, resultJson: normalized ?? context.resultJson }}
      />
    </Suspense>
  );
};

const BuiltinAgentTeamProgressRenderer: ToolRendererComponent = ({
  context,
}) => {
  const result = normalizeAgentTeamProgressResult(context.resultJson);
  if (!result) return null;
  return (
    <Suspense fallback={<BuiltinToolRendererSkeleton framed={false} />}>
      <LazyAgentTeamProgressWidget
        context={{ ...context, resultJson: result }}
      />
    </Suspense>
  );
};

export function isBuiltinConnectRequiredResult(
  context: ToolRendererContext,
): boolean {
  return normalizeConnectRequiredResult(context.resultJson) !== null;
}

export function isBuiltinDataWidgetActionRenderer(
  context: ToolRendererContext,
): boolean {
  const renderer = context.chatUI?.renderer;
  return (
    renderer === ACTION_CHAT_UI_DATA_TABLE_RENDERER ||
    renderer === ACTION_CHAT_UI_DATA_CHART_RENDERER ||
    renderer === ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER ||
    renderer === ACTION_CHAT_UI_DATA_WIDGET_RENDERER
  );
}

export function isBuiltinWorkspaceFileResult(
  context: ToolRendererContext,
): boolean {
  return normalizeWorkspaceFileResult(context.resultJson) !== null;
}

export function resolveBuiltinActionChatRenderer(
  context: ToolRendererContext,
): ToolRendererComponent | null {
  if (normalizeConnectRequiredResult(context.resultJson)) {
    return BuiltinConnectRequiredRenderer;
  }
  if (
    context.chatUI?.renderer === ACTION_CHAT_UI_INLINE_EXTENSION_RENDERER &&
    normalizeInlineExtensionToolResult(context)
  ) {
    return BuiltinInlineExtensionRenderer;
  }
  if (
    context.chatUI?.renderer === ACTION_CHAT_UI_WORKSPACE_FILE_RENDERER &&
    normalizeWorkspaceFileResult(context.resultJson)
  ) {
    return BuiltinWorkspaceFileRenderer;
  }
  if (
    context.chatUI?.renderer === ACTION_CHAT_UI_AGENT_TEAM_PROGRESS_RENDERER &&
    normalizeAgentTeamProgressResult(context.resultJson)
  ) {
    return BuiltinAgentTeamProgressRenderer;
  }
  if (
    (context.chatUI?.renderer === ACTION_CHAT_UI_RECORD_CHANGE_RENDERER ||
      LEGACY_RECORD_CHANGE_RENDERERS.some(
        (id) => id === context.chatUI?.renderer,
      )) &&
    (normalizeBuiltinActionChangeResult(context) ||
      (context.isRunning &&
        context.chatUI?.renderer === ACTION_CHAT_UI_RECORD_CHANGE_RENDERER))
  ) {
    return BuiltinRecordChangeRenderer;
  }
  if (
    isBuiltinDataWidgetActionRenderer(context) &&
    normalizeActionDataWidgetResult(context)
  ) {
    return BuiltinDataWidgetRenderer;
  }
  return null;
}

export function resolveBuiltinFallbackToolRenderer(
  context: ToolRendererContext,
): ToolRendererComponent | null {
  if (
    context.chatUI?.renderer === ACTION_CHAT_UI_INLINE_EXTENSION_RENDERER &&
    normalizeInlineExtensionToolResult(context)
  ) {
    return BuiltinInlineExtensionRenderer;
  }
  if (normalizeConnectRequiredResult(context.resultJson)) {
    return BuiltinConnectRequiredRenderer;
  }
  if (normalizeBuiltinActionChangeResult(context)) {
    return BuiltinRecordChangeRenderer;
  }
  return normalizeActionDataWidgetResult(context) !== null
    ? BuiltinDataWidgetRenderer
    : null;
}

for (const [id, renderer] of [
  ["core.agent-team-progress", ACTION_CHAT_UI_AGENT_TEAM_PROGRESS_RENDERER],
  ["core.data-table", ACTION_CHAT_UI_DATA_TABLE_RENDERER],
  ["core.data-chart", ACTION_CHAT_UI_DATA_CHART_RENDERER],
  ["core.data-insights", ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER],
  ["core.data-widget", ACTION_CHAT_UI_DATA_WIDGET_RENDERER],
  ["core.inline-extension", ACTION_CHAT_UI_INLINE_EXTENSION_RENDERER],
  ["core.record-change", ACTION_CHAT_UI_RECORD_CHANGE_RENDERER],
] as const) {
  registerReservedActionChatRenderer({
    id,
    renderer,
    Component:
      renderer === ACTION_CHAT_UI_AGENT_TEAM_PROGRESS_RENDERER
        ? BuiltinAgentTeamProgressRenderer
        : renderer === ACTION_CHAT_UI_INLINE_EXTENSION_RENDERER
          ? BuiltinInlineExtensionRenderer
          : renderer === ACTION_CHAT_UI_RECORD_CHANGE_RENDERER
            ? BuiltinRecordChangeRenderer
            : BuiltinDataWidgetRenderer,
  });
}

for (const renderer of LEGACY_RECORD_CHANGE_RENDERERS) {
  registerReservedActionChatRenderer({
    id: `core.legacy-${renderer}`,
    renderer,
    Component: BuiltinRecordChangeRenderer,
  });
}

registerReservedFallbackToolRenderer({
  id: "core.data-widgets",
  match: (context) => normalizeActionDataWidgetResult(context) !== null,
  Component: BuiltinDataWidgetRenderer,
});

registerReservedToolRenderer({
  id: "core.connect-required",
  match: (context) =>
    normalizeConnectRequiredResult(context.resultJson) !== null,
  Component: BuiltinConnectRequiredRenderer,
});

registerReservedFallbackToolRenderer({
  id: "core.workspace-file",
  match: (context) => normalizeWorkspaceFileResult(context.resultJson) !== null,
  Component: BuiltinWorkspaceFileRenderer,
});

registerReservedFallbackToolRenderer({
  id: "core.record-change",
  match: (context) => normalizeBuiltinActionChangeResult(context) !== null,
  Component: BuiltinRecordChangeRenderer,
});
