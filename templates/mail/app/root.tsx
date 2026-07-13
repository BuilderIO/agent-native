import { useDbSync } from "@agent-native/core/client";
import {
  AppProviders,
  DEFAULT_LOCALE,
  ErrorReportActions,
  LOCALE_HYDRATION_GLOBAL,
  LOCALE_STORAGE_KEY,
  appPath,
  appApiPath,
  createAgentNativeQueryClient,
  getLocaleInitScript,
  getThemeInitScript,
  normalizeLocaleCode,
  type LocaleCode,
} from "@agent-native/core/client";
import { configureTracking } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from "react-router";
import type { LinksFunction } from "react-router";

import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { AppToolkitProvider } from "@/components/ui/toolkit-provider";
import { markExternalEmailRefresh } from "@/hooks/use-emails";
import {
  MAIL_INTEGRATION_STATUS_QUERY_KEY,
  mailIntegrationProviderFromAppStateKey,
} from "@/lib/integration-status";
import { isMcpEmbedSurface } from "@/lib/mcp-embed";
import { shouldInvalidateMailQueryForActionEvent } from "@/lib/sync-invalidation";
import { TAB_ID } from "@/lib/tab-id";

import { i18nCatalog } from "./i18n";

import stylesheet from "./global.css?url";
configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-mail",
  }),
});

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

const THEME_INIT_SCRIPT_SELECTOR = "script[data-agent-native-theme-init]";
const LOCALE_INIT_SCRIPT_SELECTOR = "script[data-agent-native-locale-init]";

function getHydrationStableThemeInitScript() {
  if (typeof document !== "undefined") {
    const existing = document.querySelector<HTMLScriptElement>(
      THEME_INIT_SCRIPT_SELECTOR,
    );
    if (existing?.innerHTML) return existing.innerHTML;
  }
  return getThemeInitScript();
}

function getHydrationStableLocaleInitScript() {
  if (typeof document !== "undefined") {
    const existing = document.querySelector<HTMLScriptElement>(
      LOCALE_INIT_SCRIPT_SELECTOR,
    );
    if (existing?.innerHTML) return existing.innerHTML;
  }
  return getLocaleInitScript();
}

const THEME_INIT_SCRIPT = getHydrationStableThemeInitScript();
const LOCALE_INIT_SCRIPT = getHydrationStableLocaleInitScript();

const MAIL_ERROR_COPY: Record<
  LocaleCode,
  {
    title: string;
    fallback: string;
    back: string;
    reload: string;
    sendFeedback: string;
    feedbackPlaceholder: string;
    openGitHubIssue: string;
  }
> = {
  "en-US": {
    title: "Mail could not load this view.",
    fallback: "Something went wrong while loading Mail.",
    back: "Back",
    reload: "Reload",
    sendFeedback: "Send feedback",
    feedbackPlaceholder:
      "Describe what happened before this Mail error appeared.",
    openGitHubIssue: "Open GitHub issue",
  },
  "zh-CN": {
    title: "Mail 无法加载此视图。",
    fallback: "加载 Mail 时出现问题。",
    back: "返回",
    reload: "重新加载",
    sendFeedback: "发送反馈",
    feedbackPlaceholder: "描述此 Mail 错误出现前发生了什么。",
    openGitHubIssue: "打开 GitHub issue",
  },
  "zh-TW": {
    title: "Mail 無法載入此檢視。",
    fallback: "載入 Mail 時發生問題。",
    back: "返回",
    reload: "重新載入",
    sendFeedback: "傳送意見回饋",
    feedbackPlaceholder: "描述此 Mail 錯誤出現前發生了什麼。",
    openGitHubIssue: "開啟 GitHub issue",
  },
  "es-ES": {
    title: "Mail no pudo cargar esta vista.",
    fallback: "Algo salió mal al cargar Mail.",
    back: "Atrás",
    reload: "Recargar",
    sendFeedback: "Enviar comentarios",
    feedbackPlaceholder:
      "Describe qué pasó antes de que apareciera este error de Mail.",
    openGitHubIssue: "Abrir issue en GitHub",
  },
  "fr-FR": {
    title: "Mail n'a pas pu charger cette vue.",
    fallback: "Un problème est survenu lors du chargement de Mail.",
    back: "Retour",
    reload: "Recharger",
    sendFeedback: "Envoyer un retour",
    feedbackPlaceholder:
      "Décrivez ce qui s'est passé avant cette erreur de Mail.",
    openGitHubIssue: "Ouvrir une issue GitHub",
  },
  "de-DE": {
    title: "Mail konnte diese Ansicht nicht laden.",
    fallback: "Beim Laden von Mail ist ein Fehler aufgetreten.",
    back: "Zurück",
    reload: "Neu laden",
    sendFeedback: "Feedback senden",
    feedbackPlaceholder:
      "Beschreiben Sie, was vor diesem Mail-Fehler passiert ist.",
    openGitHubIssue: "GitHub-Issue öffnen",
  },
  "ja-JP": {
    title: "Mail はこのビューを読み込めませんでした。",
    fallback: "Mail の読み込み中に問題が発生しました。",
    back: "戻る",
    reload: "再読み込み",
    sendFeedback: "フィードバックを送信",
    feedbackPlaceholder:
      "この Mail エラーの直前に起きたことを説明してください。",
    openGitHubIssue: "GitHub issue を開く",
  },
  "ko-KR": {
    title: "Mail에서 이 보기를 불러올 수 없습니다.",
    fallback: "Mail을 불러오는 중 문제가 발생했습니다.",
    back: "뒤로",
    reload: "새로고침",
    sendFeedback: "피드백 보내기",
    feedbackPlaceholder:
      "이 Mail 오류가 나타나기 전에 무슨 일이 있었는지 적어 주세요.",
    openGitHubIssue: "GitHub issue 열기",
  },
  "pt-BR": {
    title: "O Mail não conseguiu carregar esta visualização.",
    fallback: "Algo deu errado ao carregar o Mail.",
    back: "Voltar",
    reload: "Recarregar",
    sendFeedback: "Enviar feedback",
    feedbackPlaceholder:
      "Descreva o que aconteceu antes deste erro do Mail aparecer.",
    openGitHubIssue: "Abrir issue no GitHub",
  },
  "hi-IN": {
    title: "Mail यह दृश्य लोड नहीं कर सका।",
    fallback: "Mail लोड करते समय कुछ गलत हुआ।",
    back: "वापस",
    reload: "रीलोड",
    sendFeedback: "फ़ीडबैक भेजें",
    feedbackPlaceholder: "इस Mail त्रुटि से पहले क्या हुआ, उसका वर्णन करें।",
    openGitHubIssue: "GitHub issue खोलें",
  },
  "ar-SA": {
    title: "تعذر على Mail تحميل هذا العرض.",
    fallback: "حدث خطأ أثناء تحميل Mail.",
    back: "رجوع",
    reload: "إعادة التحميل",
    sendFeedback: "إرسال الملاحظات",
    feedbackPlaceholder: "صف ما حدث قبل ظهور خطأ Mail هذا.",
    openGitHubIssue: "فتح مشكلة في GitHub",
  },
};

function activeErrorLocale(): LocaleCode {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const hydrated = (window as any)[LOCALE_HYDRATION_GLOBAL]?.locale;
  const stored = window.localStorage?.getItem(LOCALE_STORAGE_KEY);
  return (
    normalizeLocaleCode(stored) ??
    normalizeLocaleCode(hydrated) ??
    DEFAULT_LOCALE
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
        />
        <script
          data-agent-native-theme-init
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <script
          data-agent-native-locale-init
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: LOCALE_INIT_SCRIPT }}
        />
        <link rel="icon" type="image/svg+xml" href={appPath("/favicon.svg")} />
        <link rel="manifest" href={appPath("/manifest.json")} />
        <meta name="theme-color" content="#3B82F6" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Mail" />
        <link rel="apple-touch-icon" href={appPath("/icon-180.svg")} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/** Ensure the app window has focus so keyboard shortcuts work immediately */
function AutoFocus() {
  useEffect(() => {
    window.focus();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") window.focus();
    };
    const handleFocusRestore = () => window.focus();
    document.addEventListener("visibilitychange", handleVisibility);
    document.addEventListener("click", handleFocusRestore, true);
    // Restore focus when cursor re-enters the app (e.g. after using the agent chat panel)
    document.documentElement.addEventListener("mouseenter", handleFocusRestore);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      document.removeEventListener("click", handleFocusRestore, true);
      document.documentElement.removeEventListener(
        "mouseenter",
        handleFocusRestore,
      );
    };
  }, []);
  return null;
}

/** Trigger automation processing on window focus and initial load */
function AutomationTrigger() {
  const lastTrigger = useRef(0);
  useEffect(() => {
    const trigger = () => {
      const now = Date.now();
      if (now - lastTrigger.current < 30_000) return;
      lastTrigger.current = now;
      fetch(appApiPath("/api/automations/trigger"), { method: "POST" }).catch(
        () => {},
      );
    };
    // Trigger on load
    trigger();
    // Trigger on window focus
    const onVisibility = () => {
      if (document.visibilityState === "visible") trigger();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  return null;
}

/** Invalidate email queries when the window regains focus or visibility */
function VisibilityRefresh() {
  const qc = useQueryClient();
  const lastRefresh = useRef(0);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRefresh.current < 60_000) return;
      lastRefresh.current = now;
      qc.invalidateQueries({ queryKey: ["emails"] });
      qc.invalidateQueries({ queryKey: ["labels"] });
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [qc]);
  return null;
}

function DbSyncSetup() {
  const qc = useQueryClient();

  useDbSync({
    queryClient: qc,
    queryKeys: [],
    // Action events refresh action-backed reads (such as queued drafts) while
    // expensive Gmail/provider queries stay on their targeted sync paths.
    actionInvalidatePredicate: shouldInvalidateMailQueryForActionEvent,
    // Skip events this tab caused — our mutations already handle cache updates
    ignoreSource: TAB_ID,
    onEvent: (data: {
      source?: string;
      type: string;
      path?: string;
      key?: string;
      requestSource?: string;
    }) => {
      // Ignore events we caused — the mutation's onSettled handles our own updates
      const isOwnEvent = data.requestSource === TAB_ID;
      const invalidateSettingsSurfaces = () => {
        qc.invalidateQueries({ queryKey: ["scheduled-jobs"] });
        qc.invalidateQueries({ queryKey: ["automations"] });
        qc.invalidateQueries({ queryKey: ["gmail-filters"] });
        qc.invalidateQueries({ queryKey: ["google-status"] });
        qc.invalidateQueries({ queryKey: ["automation-settings"] });
        qc.invalidateQueries({ queryKey: ["framework-triggers-mail"] });
        qc.invalidateQueries({ queryKey: ["agent-engines"] });
      };

      if (data.source === "app-state") {
        const integrationProvider = mailIntegrationProviderFromAppStateKey(
          data.key,
        );
        if (integrationProvider && !isOwnEvent) {
          qc.invalidateQueries({
            queryKey: MAIL_INTEGRATION_STATUS_QUERY_KEY,
          });
          qc.invalidateQueries({
            queryKey:
              integrationProvider === "*"
                ? ["integration-data"]
                : ["integration-data", integrationProvider],
          });
        }
        if (
          (data.key?.startsWith("compose-") || data.key === "*") &&
          !isOwnEvent
        ) {
          qc.invalidateQueries({
            queryKey: ["compose-drafts"],
            refetchType: "all",
          });
        }
        if (data.key === "refresh-signal" && !isOwnEvent) {
          markExternalEmailRefresh();
          qc.invalidateQueries({ queryKey: ["emails"] });
          qc.invalidateQueries({ queryKey: ["email"] });
          qc.invalidateQueries({ queryKey: ["labels"] });
        }
        if (!isOwnEvent) {
          qc.invalidateQueries({ queryKey: ["navigate-command"] });
        }
      } else if (data.source === "settings") {
        if (!isOwnEvent) {
          qc.invalidateQueries({ queryKey: ["settings"] });
          qc.invalidateQueries({ queryKey: ["aliases"] });
          qc.invalidateQueries({ queryKey: ["labels"] });
          qc.invalidateQueries({ queryKey: ["emails"] });
          qc.invalidateQueries({ queryKey: ["email"] });
          invalidateSettingsSurfaces();
        }
      } else if (data.source === "action") {
        // The core sync hook already refreshes action-backed queries for action
        // events. Email and label reads are refreshed by the explicit
        // refresh-signal app-state event so generic action changes do not
        // cancel and restart Gmail list requests.
      } else if (data.source === "screen-refresh") {
        if (!isOwnEvent) {
          markExternalEmailRefresh();
          qc.invalidateQueries({ queryKey: ["emails"] });
          qc.invalidateQueries({ queryKey: ["email"] });
          qc.invalidateQueries({ queryKey: ["labels"] });
          invalidateSettingsSurfaces();
        }
      }
    },
  });
  return null;
}

// Mail supplies its own styled Toaster from @/components/ui/sonner, so the
// AppProviders built-in toaster is suppressed via toaster={null}.
const MAIL_TOASTER = <Toaster richColors position="bottom-left" />;

export default function Root() {
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  return (
    <AppToolkitProvider>
      <AppProviders
        queryClient={queryClient}
        themeAttribute={["class", "data-theme"]}
        tooltipDelayDuration={300}
        toaster={MAIL_TOASTER}
        sessionBypass={isMcpEmbedSurface()}
        i18n={{ catalog: i18nCatalog }}
      >
        <AutoFocus />
        <AutomationTrigger />
        <VisibilityRefresh />
        <DbSyncSetup />
        <AppLayout>
          <Outlet />
        </AppLayout>
      </AppProviders>
    </AppToolkitProvider>
  );
}

function routeErrorMessage(error: unknown, fallback: string): string {
  if (isRouteErrorResponse(error)) {
    if (typeof error.data === "string" && error.data.trim()) {
      return error.data;
    }
    if (
      error.data &&
      typeof error.data === "object" &&
      "message" in error.data &&
      typeof error.data.message === "string"
    ) {
      return error.data.message;
    }
    return error.statusText || `Request failed (${error.status})`;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const copy =
    MAIL_ERROR_COPY[activeErrorLocale()] ?? MAIL_ERROR_COPY[DEFAULT_LOCALE];
  const message = routeErrorMessage(error, copy.fallback);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-md text-center">
        <p className="text-sm font-semibold">{copy.title}</p>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.history.back()}
          >
            {copy.back}
          </Button>
          <Button size="sm" onClick={() => window.location.reload()}>
            {copy.reload}
          </Button>
        </div>
        <ErrorReportActions
          appName="Mail"
          title={copy.title}
          details={message}
          issueTitle={`Mail error: ${copy.title}`}
          feedbackLabel={copy.sendFeedback}
          feedbackPlaceholder={copy.feedbackPlaceholder}
          githubLabel={copy.openGitHubIssue}
          className="mt-4"
        />
      </div>
    </div>
  );
}
