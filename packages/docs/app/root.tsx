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
import { AgentSidebar, configureTracking } from "@agent-native/core/client";
import Header from "./components/Header";
import Footer from "./components/Footer";
import { defaultSocialImageMeta } from "./seo";

import appCss from "./global.css?url";

const SITE_URL = "https://www.agent-native.com";

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

// Aliases that serve the same content under multiple paths. Both surfaces
// link rel=canonical to the primary path so search engines don't see them
// as duplicates. Keep in sync with the alias mapping in
// `packages/docs/server/routes/[...page].get.ts` (currently /docs serves
// docs/getting-started.md, so /docs/getting-started canonicalizes to /docs).
const CANONICAL_ALIASES: Record<string, string> = {
  "/docs/getting-started": "/docs",
};
const SCROLL_MANAGER_MARKER = "docs-scroll-manager-marker";

function CanonicalLink() {
  const location = useLocation();
  const path = location.pathname.replace(/\/$/, "") || "/";
  const canonicalPath = CANONICAL_ALIASES[path] ?? path;
  const canonical = `${SITE_URL}${canonicalPath}`;
  return <link rel="canonical" href={canonical} />;
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
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script
          async
          src="https://www.googletagmanager.com/gtag/js?id=G-ESF7FYXGN9"
        />
        <script dangerouslySetInnerHTML={{ __html: GA_SCRIPT }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON_LD }}
        />
        <CanonicalLink />
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

  const content = (
    <>
      <ScrollManager />
      <Header />
      <Outlet />
      <Footer />
    </>
  );

  return (
    <QueryClientProvider client={queryClient}>
      {mounted ? (
        <AgentSidebar
          position="right"
          defaultOpen={false}
          defaultSidebarWidth={400}
          emptyStateText="Ask me anything about Agent-Native"
          suggestions={[
            "How do I get started with Agent-Native?",
            "How do actions work?",
            "Explain the polling sync model",
            "How do I deploy to production?",
          ]}
        >
          {content}
        </AgentSidebar>
      ) : (
        // Mirror AgentSidebar's outer layout (h-screen + overflow-hidden shell
        // with an overflow-auto child) so swapping in the real sidebar after
        // hydration doesn't shift the scrollbar and re-anchor centered content.
        <div className="flex min-w-0 flex-1 h-screen overflow-hidden">
          <div className="flex flex-1 flex-col overflow-auto min-w-0">
            {content}
          </div>
        </div>
      )}
    </QueryClientProvider>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-[600px] flex-col items-center justify-center px-6 text-center">
        <div className="mb-6 text-[120px] font-bold leading-none tracking-tighter text-[var(--docs-border)]">
          404
        </div>
        <h1 className="mb-3 text-2xl font-semibold tracking-tight">
          Page not found
        </h1>
        <p className="mb-8 text-base leading-relaxed text-[var(--fg-secondary)]">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="flex items-center gap-3">
          <Link
            prefetch="render"
            to="/"
            className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            Go home
          </Link>
          <Link
            prefetch="render"
            to="/docs"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
          >
            Read the docs
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-[600px] flex-col items-center justify-center px-6 text-center">
      <h1 className="mb-3 text-2xl font-semibold tracking-tight">
        Something went wrong
      </h1>
      <p className="mb-8 text-base leading-relaxed text-[var(--fg-secondary)]">
        An unexpected error occurred.
      </p>
      <Link
        prefetch="render"
        to="/"
        className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
      >
        Go home
      </Link>
    </main>
  );
}
