import { useDbSync } from "@agent-native/core/client";
import {
  AppProviders,
  appPath,
  getLocaleInitScript,
  getThemeInitScript,
  createAgentNativeQueryClient,
} from "@agent-native/core/client";
import { configureTracking } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  Link,
  useRouteError,
} from "react-router";

import { useNavigationState } from "./hooks/use-navigation-state";
import { i18nCatalog } from "./i18n";
import { TAB_ID } from "./lib/tab-id";
configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "{{APP_NAME}}",
  }),
});
import "./global.css";

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

const ERROR_COPY = {
  "en-US": {
    genericTitle: "Something went wrong",
    genericDetails: "An unexpected error occurred.",
    notFoundTitle: "Page not found",
    notFoundDetails:
      "This page doesn't exist. It may have been moved or deleted.",
    statusTitle: (status: number) => `${status} Error`,
    goHome: "Go home",
  },
  "zh-CN": {
    genericTitle: "出了点问题",
    genericDetails: "发生了意外错误。",
    notFoundTitle: "页面未找到",
    notFoundDetails: "此页面不存在。它可能已被移动或删除。",
    statusTitle: (status: number) => `${status} 错误`,
    goHome: "返回首页",
  },
  "zh-TW": {
    genericTitle: "發生錯誤",
    genericDetails: "發生未預期的錯誤。",
    notFoundTitle: "找不到頁面",
    notFoundDetails: "此頁面不存在，可能已被移動或刪除。",
    statusTitle: (status: number) => `${status} 錯誤`,
    goHome: "返回首頁",
  },
  "es-ES": {
    genericTitle: "Algo salió mal",
    genericDetails: "Se produjo un error inesperado.",
    notFoundTitle: "Página no encontrada",
    notFoundDetails:
      "Esta página no existe. Puede que se haya movido o eliminado.",
    statusTitle: (status: number) => `Error ${status}`,
    goHome: "Ir al inicio",
  },
  "fr-FR": {
    genericTitle: "Une erreur est survenue",
    genericDetails: "Une erreur inattendue s'est produite.",
    notFoundTitle: "Page introuvable",
    notFoundDetails:
      "Cette page n'existe pas. Elle a peut-être été déplacée ou supprimée.",
    statusTitle: (status: number) => `Erreur ${status}`,
    goHome: "Retour à l'accueil",
  },
  "de-DE": {
    genericTitle: "Etwas ist schiefgelaufen",
    genericDetails: "Ein unerwarteter Fehler ist aufgetreten.",
    notFoundTitle: "Seite nicht gefunden",
    notFoundDetails:
      "Diese Seite existiert nicht. Sie wurde möglicherweise verschoben oder gelöscht.",
    statusTitle: (status: number) => `${status} Fehler`,
    goHome: "Zur Startseite",
  },
  "ja-JP": {
    genericTitle: "問題が発生しました",
    genericDetails: "予期しないエラーが発生しました。",
    notFoundTitle: "ページが見つかりません",
    notFoundDetails:
      "このページは存在しません。移動または削除された可能性があります。",
    statusTitle: (status: number) => `${status} エラー`,
    goHome: "ホームへ",
  },
  "ko-KR": {
    genericTitle: "문제가 발생했습니다",
    genericDetails: "예상치 못한 오류가 발생했습니다.",
    notFoundTitle: "페이지를 찾을 수 없음",
    notFoundDetails:
      "이 페이지는 존재하지 않습니다. 이동되었거나 삭제되었을 수 있습니다.",
    statusTitle: (status: number) => `${status} 오류`,
    goHome: "홈으로 이동",
  },
  "pt-BR": {
    genericTitle: "Algo deu errado",
    genericDetails: "Ocorreu um erro inesperado.",
    notFoundTitle: "Página não encontrada",
    notFoundDetails:
      "Esta página não existe. Ela pode ter sido movida ou excluída.",
    statusTitle: (status: number) => `Erro ${status}`,
    goHome: "Ir para o início",
  },
  "hi-IN": {
    genericTitle: "कुछ गलत हुआ",
    genericDetails: "एक अनपेक्षित त्रुटि हुई।",
    notFoundTitle: "पेज नहीं मिला",
    notFoundDetails: "यह पेज मौजूद नहीं है। इसे स्थानांतरित या हटाया गया हो सकता है।",
    statusTitle: (status: number) => `${status} त्रुटि`,
    goHome: "होम जाएं",
  },
  "ar-SA": {
    genericTitle: "حدث خطأ",
    genericDetails: "حدث خطأ غير متوقع.",
    notFoundTitle: "الصفحة غير موجودة",
    notFoundDetails: "هذه الصفحة غير موجودة. ربما تم نقلها أو حذفها.",
    statusTitle: (status: number) => `خطأ ${status}`,
    goHome: "الذهاب إلى الرئيسية",
  },
};

function errorCopy() {
  const lang =
    typeof document !== "undefined"
      ? document.documentElement.getAttribute("lang")
      : null;
  return (
    ERROR_COPY[(lang as keyof typeof ERROR_COPY) || "en-US"] ??
    ERROR_COPY["en-US"]
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
        <link rel="manifest" href={appPath("/manifest.json")} />
        <link rel="icon" type="image/svg+xml" href={appPath("/favicon.svg")} />
        <meta name="theme-color" content="#111111" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="App" />
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

function DbSyncSetup() {
  const qc = useQueryClient();
  useNavigationState();
  useDbSync({ queryClient: qc, ignoreSource: TAB_ID });
  return null;
}

export default function Root() {
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  return (
    <AppProviders queryClient={queryClient} i18n={{ catalog: i18nCatalog }}>
      <DbSyncSetup />
      <Outlet />
    </AppProviders>
  );
}

function useApplyThemeClass() {
  useEffect(() => {
    const root = document.documentElement;
    if (root.classList.contains("dark") || root.classList.contains("light"))
      return;
    try {
      const stored = localStorage.getItem("theme");
      if (stored === "dark") {
        root.classList.add("dark");
      } else if (stored === "light") {
        root.classList.add("light");
      } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        root.classList.add("dark");
      }
    } catch {}
  }, []);
}

export function ErrorBoundary() {
  useApplyThemeClass();
  const error = useRouteError();
  const copy = errorCopy();
  let status: number | null = null;
  let title = copy.genericTitle;
  let details = copy.genericDetails;
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    status = error.status;
    if (error.status === 404) {
      title = copy.notFoundTitle;
      details = copy.notFoundDetails;
    } else {
      title = copy.statusTitle(error.status);
      details = error.statusText || details;
    }
  } else if (
    typeof process !== "undefined" &&
    process.env.NODE_ENV !== "production" &&
    error instanceof Error
  ) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="flex items-center justify-center min-h-screen p-4 bg-background text-foreground">
      <div className="flex flex-col items-center text-center max-w-md">
        {status && (
          <span className="text-7xl font-bold tracking-tight text-muted-foreground/40">
            {status}
          </span>
        )}
        <h1 className="mt-3 text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-muted-foreground text-sm">{details}</p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 cursor-pointer"
        >
          {copy.goHome}
        </Link>
        {stack && (
          <pre className="mt-6 w-full text-left text-xs overflow-auto p-4 bg-muted rounded">
            <code>{stack}</code>
          </pre>
        )}
      </div>
    </main>
  );
}
