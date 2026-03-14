import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  useLocation,
} from "@tanstack/react-router";
import Header from "../components/Header";
import Footer from "../components/Footer";

import appCss from "../styles.css?url";

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;

const GA_SCRIPT = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-ESF7FYXGN9');`;

const JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Agent-Native",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Cross-platform",
  description:
    "Open source framework for building AI-native applications where agents and UI share state through files.",
  url: "https://agent-native.com",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  license: "https://opensource.org/licenses/MIT",
  sourceOrganization: {
    "@type": "Organization",
    name: "Builder.io",
    url: "https://builder.io",
  },
  codeRepository: "https://github.com/BuilderIO/agent-native",
});

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Agent-Native — Framework for AI-Native Apps" },
      {
        name: "description",
        content: "Build apps where AI agents and UI share state through files.",
      },
      {
        property: "og:image",
        content:
          "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F2c5ac2a70b1246fdaf606f526ab47a8a",
      },
      {
        property: "og:title",
        content: "Agent-Native — Framework for AI-Native Apps",
      },
      {
        property: "og:description",
        content: "Build apps where AI agents and UI share state through files.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://agent-native.com" },
      { property: "og:site_name", content: "Agent-Native" },
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "twitter:image",
        content:
          "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F2c5ac2a70b1246fdaf606f526ab47a8a",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      {
        rel: "icon",
        href: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F397134b86ceb49818bcfa4baf25708a3?width=64",
        type: "image/png",
      },
      {
        rel: "apple-touch-icon",
        href: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F397134b86ceb49818bcfa4baf25708a3?width=180",
        type: "image/png",
      },
    ],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
  notFoundComponent: NotFound,
});

function CanonicalLink() {
  const location = useLocation();
  const path = location.pathname.replace(/\/$/, "") || "/";
  const canonical = `https://agent-native.com${path}`;
  return <link rel="canonical" href={canonical} />;
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
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
        <HeadContent />
      </head>
      <body className="font-sans antialiased" suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-[600px] flex-col items-center justify-center px-6 text-center">
      <div className="mb-6 text-[120px] font-bold leading-none tracking-tighter text-[var(--border)]">
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
          to="/"
          className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black no-underline transition hover:bg-gray-200 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
        >
          Go home
        </Link>
        <Link
          to="/docs"
          className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
        >
          Read the docs
        </Link>
      </div>
    </main>
  );
}

function RootComponent() {
  return (
    <>
      <Header />
      <Outlet />
      <Footer />
    </>
  );
}
