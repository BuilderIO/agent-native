import { useEffect, useState } from "react";
import {
  isRouteErrorResponse,
  useInRouterContext,
  useRouteError,
} from "react-router";

import {
  DEFAULT_LOCALE,
  LOCALE_HYDRATION_GLOBAL,
  LOCALE_STORAGE_KEY,
  normalizeLocaleCode,
  type LocaleCode,
} from "../localization/shared.js";
import { appPath } from "./api-path.js";
import {
  isDynamicImportFailureMessage,
  recoverFromStaleChunkError,
} from "./route-chunk-recovery.js";

const homeLinkClassName =
  "mt-6 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 cursor-pointer";

const errorCopy: Record<
  LocaleCode,
  {
    loadingLatest: string;
    genericTitle: string;
    genericDetails: string;
    notFoundTitle: string;
    notFoundDetails: string;
    statusTitle: (status: number) => string;
    goHome: string;
    reload: string;
  }
> = {
  "en-US": {
    loadingLatest: "Loading the latest version...",
    genericTitle: "Something went wrong",
    genericDetails: "An unexpected error occurred.",
    notFoundTitle: "Page not found",
    notFoundDetails: "We couldn't find this page.",
    statusTitle: (status) => `${status} Error`,
    goHome: "Go home",
    reload: "Reload",
  },
  "zh-CN": {
    loadingLatest: "正在加载最新版本...",
    genericTitle: "出错了",
    genericDetails: "发生了意外错误。",
    notFoundTitle: "页面未找到",
    notFoundDetails: "我们找不到这个页面。",
    statusTitle: (status) => `${status} 错误`,
    goHome: "回到首页",
    reload: "重新加载",
  },
  "zh-TW": {
    loadingLatest: "正在載入最新版本...",
    genericTitle: "發生錯誤",
    genericDetails: "發生未預期的錯誤。",
    notFoundTitle: "找不到頁面",
    notFoundDetails: "找不到這個頁面。",
    statusTitle: (status) => `${status} 錯誤`,
    goHome: "回首頁",
    reload: "重新載入",
  },
  "es-ES": {
    loadingLatest: "Cargando la versión más reciente...",
    genericTitle: "Algo salió mal",
    genericDetails: "Se produjo un error inesperado.",
    notFoundTitle: "Página no encontrada",
    notFoundDetails: "No pudimos encontrar esta página.",
    statusTitle: (status) => `Error ${status}`,
    goHome: "Ir al inicio",
    reload: "Recargar",
  },
  "fr-FR": {
    loadingLatest: "Chargement de la dernière version...",
    genericTitle: "Un problème est survenu",
    genericDetails: "Une erreur inattendue s'est produite.",
    notFoundTitle: "Page introuvable",
    notFoundDetails: "Nous n'avons pas trouvé cette page.",
    statusTitle: (status) => `Erreur ${status}`,
    goHome: "Accueil",
    reload: "Recharger",
  },
  "de-DE": {
    loadingLatest: "Neueste Version wird geladen...",
    genericTitle: "Etwas ist schiefgelaufen",
    genericDetails: "Ein unerwarteter Fehler ist aufgetreten.",
    notFoundTitle: "Seite nicht gefunden",
    notFoundDetails: "Wir konnten diese Seite nicht finden.",
    statusTitle: (status) => `Fehler ${status}`,
    goHome: "Zur Startseite",
    reload: "Neu laden",
  },
  "ja-JP": {
    loadingLatest: "最新バージョンを読み込み中...",
    genericTitle: "問題が発生しました",
    genericDetails: "予期しないエラーが発生しました。",
    notFoundTitle: "ページが見つかりません",
    notFoundDetails: "このページは見つかりませんでした。",
    statusTitle: (status) => `${status} エラー`,
    goHome: "ホームへ",
    reload: "再読み込み",
  },
  "ko-KR": {
    loadingLatest: "최신 버전을 불러오는 중...",
    genericTitle: "문제가 발생했습니다",
    genericDetails: "예기치 않은 오류가 발생했습니다.",
    notFoundTitle: "페이지를 찾을 수 없음",
    notFoundDetails: "이 페이지를 찾을 수 없습니다.",
    statusTitle: (status) => `${status} 오류`,
    goHome: "홈으로 이동",
    reload: "새로고침",
  },
  "pt-BR": {
    loadingLatest: "Carregando a versão mais recente...",
    genericTitle: "Algo deu errado",
    genericDetails: "Ocorreu um erro inesperado.",
    notFoundTitle: "Página não encontrada",
    notFoundDetails: "Não encontramos esta página.",
    statusTitle: (status) => `Erro ${status}`,
    goHome: "Ir para início",
    reload: "Recarregar",
  },
  "hi-IN": {
    loadingLatest: "नवीनतम संस्करण लोड हो रहा है...",
    genericTitle: "कुछ गलत हो गया",
    genericDetails: "एक अनपेक्षित त्रुटि हुई।",
    notFoundTitle: "पेज नहीं मिला",
    notFoundDetails: "हमें यह पेज नहीं मिला।",
    statusTitle: (status) => `${status} त्रुटि`,
    goHome: "होम पर जाएं",
    reload: "रीलोड करें",
  },
  "ar-SA": {
    loadingLatest: "جار تحميل أحدث إصدار...",
    genericTitle: "حدث خطأ ما",
    genericDetails: "حدث خطأ غير متوقع.",
    notFoundTitle: "الصفحة غير موجودة",
    notFoundDetails: "تعذر العثور على هذه الصفحة.",
    statusTitle: (status) => `خطأ ${status}`,
    goHome: "العودة للرئيسية",
    reload: "إعادة التحميل",
  },
};

function readErrorLocale(): LocaleCode {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const hydrated = (window as any)[LOCALE_HYDRATION_GLOBAL]?.locale;
  const stored = window.localStorage?.getItem(LOCALE_STORAGE_KEY);
  return (
    normalizeLocaleCode(hydrated) ??
    normalizeLocaleCode(stored) ??
    DEFAULT_LOCALE
  );
}

function useErrorCopy() {
  const [locale, setLocale] = useState<LocaleCode>(readErrorLocale);
  useEffect(() => {
    setLocale(readErrorLocale());
  }, []);
  return errorCopy[locale] ?? errorCopy[DEFAULT_LOCALE];
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

function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

/**
 * When a route renders against a stale lazy chunk after a deploy (the chunk's
 * hashed filename no longer exists), the import rejection surfaces here. Reload
 * once to fetch fresh assets instead of stranding the user on an error screen.
 * The reload is loop-guarded; if it cannot recover, fall back to the screen.
 */
function useStaleChunkRecovery(error: unknown): boolean {
  const [recovering, setRecovering] = useState(() =>
    isDynamicImportFailureMessage(errorMessageOf(error)),
  );
  useEffect(() => {
    if (!isDynamicImportFailureMessage(errorMessageOf(error))) {
      setRecovering(false);
      return;
    }
    if (!recoverFromStaleChunkError(error)) setRecovering(false);
  }, [error]);
  return recovering;
}

function UpdatingScreen() {
  const copy = useErrorCopy();
  return (
    <main className="flex items-center justify-center min-h-screen p-4 bg-background text-foreground">
      <p className="text-muted-foreground text-sm">{copy.loadingLatest}</p>
    </main>
  );
}

function ErrorScreen({ error }: { error: unknown }) {
  const copy = useErrorCopy();
  const recovering = useStaleChunkRecovery(error);
  // While auto-recovering a stale chunk, show a neutral state and skip the
  // console.error below so the transient, self-healing failure does not get
  // reported as a hard error.
  if (recovering) return <UpdatingScreen />;

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
  } else if (error instanceof Error) {
    // Always surface the underlying error message — a generic
    // "An unexpected error occurred." in production tells users (and us)
    // nothing. The stack trace is still gated to dev so we don't leak
    // internals to end users.
    if (error.message) {
      details = error.message;
    }
    if (
      typeof process !== "undefined" &&
      process.env.NODE_ENV !== "production"
    ) {
      stack = error.stack;
    }
  } else if (typeof error === "string" && error) {
    details = error;
  }

  // Log to the console so the underlying failure is recoverable from
  // browser devtools / Sentry even when the UI hides the stack.
  if (typeof console !== "undefined" && error) {
    console.error("[ErrorBoundary]", error);
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
        <a href={appPath("/")} className={homeLinkClassName}>
          {copy.goHome}
        </a>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-accent"
        >
          {copy.reload}
        </button>
        {stack && (
          <pre className="mt-6 w-full text-start text-xs overflow-auto p-4 bg-muted rounded">
            <code>{stack}</code>
          </pre>
        )}
      </div>
    </main>
  );
}

function RoutedErrorScreen() {
  return <ErrorScreen error={useRouteError()} />;
}

export function ErrorBoundary() {
  useApplyThemeClass();
  if (!useInRouterContext()) return <ErrorScreen error={undefined} />;
  return <RoutedErrorScreen />;
}
