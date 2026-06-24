import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  Link,
  isRouteErrorResponse,
  useRouteError,
  useLocation,
} from "react-router";
import { useState, useEffect, useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AgentNativeI18nProvider,
  AgentSidebar,
  LOCALE_HYDRATION_GLOBAL,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  configureTracking,
  getLocaleInitScript,
  normalizeLocalizationPreference,
  useT,
} from "@agent-native/core/client";
import Header from "./components/Header";
import Footer from "./components/Footer";
import {
  DEFAULT_DOCS_LOCALE,
  docsLocaleFromPathname,
  isDocsPath,
  localeDirection,
} from "./components/docs-locale";
import {
  canonicalPathForPath,
  docsAlternateLinksForPath,
} from "./components/docs-seo";
import { docsI18nCatalog } from "./i18n";
import { defaultSocialImageMeta } from "./seo";

import appCss from "./global.css?url";

const SITE_URL = "https://www.agent-native.com";
const LOCALE_INIT_SCRIPT_SELECTOR = "script[data-agent-native-locale-init]";

configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-docs",
  }),
});

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;

const GA_SCRIPT = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-ESF7FYXGN9');`;

const JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "Builder.io",
      url: "https://builder.io",
      sameAs: ["https://github.com/BuilderIO/agent-native"],
    },
    {
      "@type": "WebSite",
      name: "Agent-Native",
      url: SITE_URL,
      description:
        "Open source framework for building agentic applications where AI agents and UI share the same database and state.",
    },
    {
      "@type": "SoftwareApplication",
      name: "Agent-Native",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Cross-platform",
      description:
        "Open source framework for building agentic applications where AI agents and UI share the same database and state.",
      url: SITE_URL,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      license: "https://opensource.org/licenses/MIT",
      sourceOrganization: {
        "@type": "Organization",
        name: "Builder.io",
        url: "https://builder.io",
      },
      codeRepository: "https://github.com/BuilderIO/agent-native",
    },
  ],
});

function getSiteLocaleInitScript() {
  return `(function(){try{var supported=${JSON.stringify(
    SUPPORTED_LOCALES,
  )};function valid(x){return supported.indexOf(x)>=0}function canon(x){if(typeof x!=='string'||!x)return null;try{var c=Intl.getCanonicalLocales(x)[0];if(valid(c))return c;var lang=c&&c.split('-')[0].toLowerCase();for(var i=0;i<supported.length;i++){if(supported[i].split('-')[0].toLowerCase()===lang)return supported[i]}}catch(e){}return null}function storageGet(k){try{return window.localStorage.getItem(k)}catch(e){return null}}var stored=storageGet(${JSON.stringify(
    LOCALE_STORAGE_KEY,
  )});var pref=stored==='system'||valid(stored)?stored:'system';var locale=pref&&pref!=='system'?canon(pref):null;if(!locale){var langs=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language];for(var j=0;j<langs.length&&!locale;j++){locale=canon(langs[j])}}if(!locale)locale=${JSON.stringify(
    DEFAULT_DOCS_LOCALE,
  )};var dir=locale==='ar-SA'?'rtl':'ltr';var root=document.documentElement;root.setAttribute('lang',locale);root.setAttribute('dir',dir);root.setAttribute('data-locale',locale);window[${JSON.stringify(
    LOCALE_HYDRATION_GLOBAL,
  )}]={locale:locale,preference:{locale:pref},dir:dir};}catch(e){}})();`;
}

function readClientLocalePreference() {
  if (typeof window === "undefined") return undefined;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return stored ? normalizeLocalizationPreference(stored).locale : undefined;
  } catch {
    return undefined;
  }
}

export const links = () => [
  { rel: "stylesheet", href: appCss },
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: "/logo192.png", type: "image/png" },
];

export const meta = () => [
  { title: "Agent-Native — Framework for Agent-Native Apps" },
  {
    name: "description",
    content:
      "Build agentic apps where AI agents and UI share the same database and state. Open source framework with ready-to-fork templates.",
  },
  ...defaultSocialImageMeta(),
  {
    property: "og:title",
    content: "Agent-Native — Framework for Agent-Native Apps",
  },
  {
    property: "og:description",
    content:
      "Build agentic apps where AI agents and UI share the same database and state. Open source framework with ready-to-fork templates.",
  },
  { property: "og:type", content: "website" },
  { property: "og:url", content: SITE_URL },
  { property: "og:site_name", content: "Agent-Native" },
];

function DocsChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full min-w-0 overflow-x-hidden">
      <ScrollManager />
      <Header />
      {children}
      <Footer />
    </div>
  );
}

function DocsI18nProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const docsPath = isDocsPath(location.pathname);
  const routeLocale = docsPath
    ? (docsLocaleFromPathname(location.pathname) ?? DEFAULT_DOCS_LOCALE)
    : undefined;
  const sitePreference = docsPath ? undefined : readClientLocalePreference();

  return (
    <AgentNativeI18nProvider
      key={routeLocale ?? "site"}
      catalog={docsI18nCatalog}
      initialLocale={routeLocale}
      initialPreference={routeLocale ?? sitePreference}
      persistPreference={false}
    >
      {children}
    </AgentNativeI18nProvider>
  );
}

const SCROLL_MANAGER_MARKER = "docs-scroll-manager-marker";

function SeoLinks() {
  const location = useLocation();
  const canonicalPath = canonicalPathForPath(location.pathname);
  const canonical = `${SITE_URL}${canonicalPath}`;
  const alternates = docsAlternateLinksForPath(location.pathname);
  return (
    <>
      <link rel="canonical" href={canonical} />
      {alternates.map((alternate) => (
        <link
          key={alternate.hrefLang}
          rel="alternate"
          hrefLang={alternate.hrefLang}
          href={`${SITE_URL}${alternate.path}`}
        />
      ))}
    </>
  );
}

function findScrollContainerFrom(el: HTMLElement | null): HTMLElement | Window {
  let parent: HTMLElement | null = el?.parentElement ?? null;
  while (parent) {
    const overflowY = getComputedStyle(parent).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      parent.scrollHeight > parent.clientHeight
    ) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return window;
}

function scrollElementIntoContainerView(target: HTMLElement) {
  const scrollContainer = findScrollContainerFrom(target);
  if (scrollContainer === window) {
    target.scrollIntoView({ block: "start" });
    return;
  }

  const container = scrollContainer as HTMLElement;
  const targetRect = target.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const scrollMarginTop =
    Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;

  container.scrollTo({
    top:
      container.scrollTop +
      targetRect.top -
      containerRect.top -
      scrollMarginTop,
  });
}

function getManagedScrollTop(): number | null {
  if (typeof document === "undefined") return null;
  const marker = document.querySelector<HTMLElement>(
    `[data-${SCROLL_MANAGER_MARKER}]`,
  );
  if (!marker) return null;
  const scrollContainer = findScrollContainerFrom(marker);
  if (scrollContainer === window) return window.scrollY;
  return (scrollContainer as HTMLElement).scrollTop;
}

function setManagedScrollTop(top: number) {
  if (typeof document === "undefined") return;
  const marker = document.querySelector<HTMLElement>(
    `[data-${SCROLL_MANAGER_MARKER}]`,
  );
  if (!marker) return;
  const scrollContainer = findScrollContainerFrom(marker);
  if (scrollContainer === window) {
    window.scrollTo(0, top);
  } else {
    (scrollContainer as HTMLElement).scrollTop = top;
  }
}

// AgentSidebar wraps content in an overflow-auto div, so the window usually
// does not scroll. Keep both normal route changes and hash links pointed at
// that real scroll container.
function ScrollManager() {
  const { pathname, hash } = useLocation();
  const ref = useRef<HTMLSpanElement>(null);
  const isInitialEffectRef = useRef(true);

  useEffect(() => {
    const isInitialEffect = isInitialEffectRef.current;
    isInitialEffectRef.current = false;

    if (hash) {
      const id = decodeURIComponent(hash.slice(1));
      let raf = 0;
      const timers: number[] = [];

      const scrollToHash = () => {
        const target = document.getElementById(id);
        if (target) scrollElementIntoContainerView(target);
      };

      raf = window.requestAnimationFrame(scrollToHash);
      timers.push(window.setTimeout(scrollToHash, 100));
      timers.push(window.setTimeout(scrollToHash, 350));

      return () => {
        window.cancelAnimationFrame(raf);
        for (const timer of timers) window.clearTimeout(timer);
      };
    }

    if (isInitialEffect) return;

    let parent: HTMLElement | null = ref.current?.parentElement ?? null;
    while (parent) {
      const overflowY = getComputedStyle(parent).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") {
        parent.scrollTop = 0;
        return;
      }
      parent = parent.parentElement;
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return (
    <span
      ref={ref}
      data-docs-scroll-manager-marker
      aria-hidden
      style={{ display: "none" }}
    />
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const docsPath = isDocsPath(location.pathname);
  const locale =
    docsLocaleFromPathname(location.pathname) ?? DEFAULT_DOCS_LOCALE;
  const localeInitScript =
    typeof document !== "undefined"
      ? (document.querySelector<HTMLScriptElement>(LOCALE_INIT_SCRIPT_SELECTOR)
          ?.innerHTML ?? getSiteLocaleInitScript())
      : docsPath
        ? getLocaleInitScript({
            locale,
          })
        : getSiteLocaleInitScript();

  return (
    <html lang={locale} dir={localeDirection(locale)} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script
          data-agent-native-locale-init
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: localeInitScript }}
        />
        <script
          async
          src="https://www.googletagmanager.com/gtag/js?id=G-ESF7FYXGN9"
        />
        <script dangerouslySetInnerHTML={{ __html: GA_SCRIPT }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON_LD }}
        />
        <SeoLinks />
        <Meta />
        <Links />
      </head>
      <body className="font-sans antialiased" suppressHydrationWarning>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      }),
  );
  const [mounted, setMounted] = useState(false);
  const pendingHydrationScrollTopRef = useRef<number | null>(null);

  useEffect(() => {
    pendingHydrationScrollTopRef.current = window.location.hash
      ? null
      : getManagedScrollTop();
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const top = pendingHydrationScrollTopRef.current;
    pendingHydrationScrollTopRef.current = null;
    if (!top || top <= 0) return;

    let raf = 0;
    let secondRaf = 0;
    const timer = window.setTimeout(() => setManagedScrollTop(top), 100);
    raf = window.requestAnimationFrame(() => {
      setManagedScrollTop(top);
      secondRaf = window.requestAnimationFrame(() => setManagedScrollTop(top));
    });

    return () => {
      window.cancelAnimationFrame(raf);
      window.cancelAnimationFrame(secondRaf);
      window.clearTimeout(timer);
    };
  }, [mounted]);

  return (
    <QueryClientProvider client={queryClient}>
      <DocsI18nProvider>
        <RootShell mounted={mounted} />
      </DocsI18nProvider>
    </QueryClientProvider>
  );
}

function RootShell({ mounted }: { mounted: boolean }) {
  const t = useT();
  const content = (
    <DocsChrome>
      <Outlet />
    </DocsChrome>
  );

  return mounted ? (
    <AgentSidebar
      storageKey="docs"
      position="right"
      defaultOpen={false}
      defaultSidebarWidth={400}
      emptyStateText={t("agent.emptyState")}
      suggestions={[
        t("agent.suggestionGettingStarted"),
        t("agent.suggestionActions"),
        t("agent.suggestionPolling"),
        t("agent.suggestionDeploy"),
      ]}
    >
      {content}
    </AgentSidebar>
  ) : (
    // Mirror AgentSidebar's outer layout (h-screen + overflow-hidden shell
    // with an overflow-auto child) so swapping in the real sidebar after
    // hydration doesn't shift the scrollbar and re-anchor centered content.
    <div className="flex min-w-0 flex-1 h-screen overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
        {content}
      </div>
    </div>
  );
}

function LocalizedError({ error }: { error: unknown }) {
  const t = useT();

  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <DocsChrome>
        <main className="mx-auto flex min-h-[60vh] max-w-[600px] flex-col items-center justify-center px-6 text-center">
          <div className="mb-6 text-[120px] font-bold leading-none tracking-tighter text-[var(--docs-border)]">
            404
          </div>
          <h1 className="mb-3 text-2xl font-semibold tracking-tight">
            {t("errors.notFoundTitle")}
          </h1>
          <p className="mb-8 text-base leading-relaxed text-[var(--fg-secondary)]">
            {t("errors.notFoundBody")}
          </p>
          <div className="flex items-center gap-3">
            <Link
              data-an-prefetch="render"
              to="/"
              className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
            >
              {t("errors.goHome")}
            </Link>
            <Link
              data-an-prefetch="render"
              to="/docs"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
            >
              {t("errors.readDocs")}
            </Link>
          </div>
        </main>
      </DocsChrome>
    );
  }

  return (
    <DocsChrome>
      <main className="mx-auto flex min-h-[60vh] max-w-[600px] flex-col items-center justify-center px-6 text-center">
        <h1 className="mb-3 text-2xl font-semibold tracking-tight">
          {t("errors.genericTitle")}
        </h1>
        <p className="mb-8 text-base leading-relaxed text-[var(--fg-secondary)]">
          {t("errors.genericBody")}
        </p>
        <Link
          data-an-prefetch="render"
          to="/"
          className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
        >
          {t("errors.goHome")}
        </Link>
      </main>
    </DocsChrome>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  return (
    <DocsI18nProvider>
      <LocalizedError error={error} />
    </DocsI18nProvider>
  );
}
