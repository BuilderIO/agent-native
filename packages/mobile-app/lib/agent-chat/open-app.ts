import type { AgentEvent } from "@agent-native/agentkit/protocol";
import {
  resolveChatFirstAppTarget,
  type ChatFirstOpenAppDetail,
} from "@agent-native/core/client/chat-first-state";
import type { AppConfig } from "@agent-native/shared-app-config";

export type MobileAppOpenEvent =
  | { kind: "open"; detail: ChatFirstOpenAppDetail }
  | { kind: "notice"; message: string };

const UNAVAILABLE_EN = "The requested app could not be opened.";

const unavailableCopy: Record<string, string> = {
  en: UNAVAILABLE_EN,
  es: "No se pudo abrir la aplicación solicitada.",
  fr: "Impossible d’ouvrir l’application demandée.",
  de: "Die angeforderte App konnte nicht geöffnet werden.",
  pt: "Não foi possível abrir o aplicativo solicitado.",
  "zh-TW": "無法開啟所要求的應用程式。",
  zh: "无法打开所请求的应用。",
  ja: "要求されたアプリを開けませんでした。",
  ko: "요청한 앱을 열 수 없습니다.",
  hi: "अनुरोधित ऐप नहीं खोला जा सका।",
  ar: "تعذّر فتح التطبيق المطلوب.",
};

export function mobileAppPanelUnavailable(
  locale = Intl.DateTimeFormat().resolvedOptions().locale,
): string {
  const key = /^zh-(TW|HK|Hant)/i.test(locale)
    ? "zh-TW"
    : (locale.toLowerCase().split(/[-_]/)[0] ?? "en");
  return unavailableCopy[key] ?? UNAVAILABLE_EN;
}

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return record(JSON.parse(value));
      // coercion-ok: unparseable output is null, which the caller reports as a failure notice
    } catch {
      return null;
    }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function readMobileOpenAppEvent(
  event: AgentEvent,
): MobileAppOpenEvent | null {
  if (event.type !== "tool.updated" || event.toolCall.name !== "open_app")
    return null;
  if (
    event.toolCall.status === "failed" ||
    event.toolCall.status === "cancelled"
  ) {
    return { kind: "notice", message: mobileAppPanelUnavailable() };
  }
  if (event.toolCall.status !== "completed") return null;
  if (event.toolCall.error)
    return { kind: "notice", message: mobileAppPanelUnavailable() };
  const result = record(event.toolCall.output);
  if (
    !result ||
    result.isError === true ||
    result.ok === false ||
    result.success === false ||
    result.error ||
    result.status === "failed"
  ) {
    return { kind: "notice", message: mobileAppPanelUnavailable() };
  }
  const app = text(result.app ?? result.appId ?? result.application);
  const path = text(result.path ?? result.targetPath);
  const url = text(result.url ?? result.href);
  const view = text(result.view);
  const detail: ChatFirstOpenAppDetail = {
    ...(app ? { app } : {}),
    ...(path ? { path } : {}),
    ...(url ? { url } : {}),
    ...(view ? { view } : {}),
  };
  if (
    !(detail.app || detail.url) ||
    !(detail.path || detail.view || detail.url)
  ) {
    return { kind: "notice", message: mobileAppPanelUnavailable() };
  }
  return { kind: "open", detail };
}

export function resolveMobileAppPanelTarget(
  detail: ChatFirstOpenAppDetail,
  apps: readonly AppConfig[],
  workspaceApps: readonly AppConfig[] = [],
):
  | {
      status: "ready";
      target: {
        app: AppConfig;
        path?: string;
        view?: string;
        workspaceAppId?: string;
      };
    }
  | { status: "unresolved"; reason: string } {
  const workspaceIds = new Set(workspaceApps.map((app) => app.id));
  const available = [
    ...workspaceApps,
    ...apps.filter((app) => !workspaceIds.has(app.id)),
  ].filter((app) => app.enabled);
  const requested = detail.app?.trim().toLowerCase();
  const named = requested
    ? (available.find((app) => app.id.toLowerCase() === requested) ??
      available.find((app) => app.name.toLowerCase() === requested))
    : undefined;
  if (requested && !named)
    return { status: "unresolved", reason: mobileAppPanelUnavailable() };
  const registrations = available.map((app) => ({
    id: app.id,
    name: app.name,
    url: app.url,
  }));
  const resolved = resolveChatFirstAppTarget(
    { ...detail, ...(named ? { app: named.id } : {}) },
    registrations,
  );
  if (resolved.status !== "ready")
    return { status: "unresolved", reason: mobileAppPanelUnavailable() };
  const app = available.find((item) => item.id === resolved.target.appId);
  if (!app)
    return { status: "unresolved", reason: mobileAppPanelUnavailable() };
  try {
    const base = new URL(app.url);
    if (
      base.username ||
      base.password ||
      !["https:", "http:"].includes(base.protocol)
    )
      return { status: "unresolved", reason: mobileAppPanelUnavailable() };
    const basePath = base.pathname.replace(/\/+$/, "");
    const relative = resolved.target.path ?? "/";
    const target = new URL(`${base.origin}${basePath}${relative}`);
    const checked = resolveChatFirstAppTarget(
      { app: app.id, url: target.toString() },
      registrations,
    );
    if (checked.status !== "ready")
      return { status: "unresolved", reason: mobileAppPanelUnavailable() };
    return {
      status: "ready",
      target: {
        app,
        ...(workspaceIds.has(app.id) ? { workspaceAppId: app.id } : {}),
        path: `${target.pathname}${target.search}${target.hash}`,
        ...(resolved.target.view ? { view: resolved.target.view } : {}),
      },
    };
  } catch {
    return { status: "unresolved", reason: mobileAppPanelUnavailable() };
  }
}
