/**
 * Shared provider shell for agent-native template roots.
 *
 * Composes the providers every template needs:
 *   QueryClientProvider → ThemeProvider → TooltipProvider → Toaster
 *
 * Templates keep their own `createAgentNativeQueryClient(overrides)` call and
 * pass the result in as `queryClient`. AppProviders never creates a client
 * internally so each template can apply its own query defaults (e.g. calendar's
 * `refetchOnWindowFocus: true`, mail's focus-refresh throttle).
 *
 * Public-path SSR pattern (calendar/clips/content):
 *   Some templates have routes that must SSR real content for first-visit
 *   signed-out users and crawlers, bypassing the `<ClientOnly>` gate.
 *   Pass `isPublicPath` and `clientOnlyFallback` to activate this branch:
 *
 *     <AppProviders
 *       queryClient={queryClient}
 *       isPublicPath={isPublicBookingPath(location.pathname)}
 *       clientOnlyFallback={<AppShellSkeleton />}
 *     >
 *       ...
 *     </AppProviders>
 *
 *   When `isPublicPath` is true the providers render without `<ClientOnly>` or
 *   a session gate, streaming real markup to the client. When false (the
 *   default), `<ClientOnly>` hydrates the shared SSR shell and
 *   `<RequireSession>` redirects signed-out visitors to the framework sign-in
 *   page before private app chrome mounts. When `clientOnlyFallback` is
 *   omitted, `<AppShellSkeleton />` is used.
 *
 * Customisation props:
 *   themeAttribute           — passed to next-themes ThemeProvider `attribute`.
 *                              Defaults to "class". Use ["class", "data-theme"]
 *                              when CSS variables are also keyed off a data-theme
 *                              attribute (mail template).
 *   tooltipDelayDuration     — passed to Radix TooltipProvider `delayDuration`
 *                              (ms). Omit to use the Radix default (700 ms).
 *   toaster                  — custom Toaster element rendered after children.
 *                              Pass `null` to suppress the built-in Toaster when
 *                              children already include a styled one.
 *                              Defaults to a rich-color bottom-left toaster raised above
 *                              the environment badge.
 *   disableThemeTransitions  — passed to next-themes ThemeProvider
 *                              `disableTransitionOnChange`. Defaults to `true`
 *                              (suppresses CSS transitions during theme switches,
 *                              which is the shadcn recommendation and avoids
 *                              flash artefacts). Set to `false` when the template
 *                              intentionally animates theme changes (e.g. content).
 *   disableWebMcp             — skips the automatic page-local WebMCP action
 *                              registration. Defaults to `false`.
 *   webMcpExcludeActionNames  — omits named server actions when a page provides
 *                              a safer or more specific replacement.
 */

import { Toaster } from "@agent-native/toolkit/ui/sonner";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { ThemeProvider, type Attribute, useTheme } from "next-themes";
import React, { useEffect, useRef } from "react";
import { useInRouterContext } from "react-router";

import {
  isHumanReadableDocumentTitle,
  normalizeDocumentTitle,
} from "../shared/document-title.js";
import { getSsrBetaRedirectScriptBody } from "../shared/ssr-beta-redirect.js";
import { getSsrSessionBootstrapScriptBody } from "../shared/ssr-session-bootstrap.js";
import { agentNativePath, frameworkRoutePrefix } from "./api-path.js";
import { AppShellSkeleton } from "./AppShellSkeleton.js";
import { ClientOnly } from "./ClientOnly.js";
import { EnvironmentBadge } from "./EnvironmentBadge.js";
import {
  AgentNativeI18nProvider,
  type AgentNativeI18nProviderProps,
} from "./i18n.js";
import { FirstRunOnboardingStartupGate } from "./onboarding/first-run-startup-gate.js";
import { RequireSession } from "./require-session.js";
import { AgentNativeRouteWarmup } from "./route-warmup.js";
import { RouteTransitionIndicator } from "./RouteTransitionIndicator.js";
import { RuntimeConfigNotice } from "./RuntimeConfigNotice.js";
import {
  EMBEDDED_THEME_CHANGE_EVENT,
  applyEmbeddedThemeUpdate,
  parseEmbeddedThemeUpdate,
} from "./theme.js";
import { scheduleAfterPaint } from "./use-after-paint.js";
import { useSession } from "./use-session.js";
import { SettingsShortcut } from "./use-settings-shortcut.js";

export interface AppProvidersProps {
  /** QueryClient instance — create with `createAgentNativeQueryClient()`. */
  queryClient: QueryClient;

  /**
   * Default theme passed to next-themes `ThemeProvider`.
   * Defaults to `"system"`.  Dark-first templates (slides, analytics)
   * pass `"dark"`.
   */
  defaultTheme?: string;

  /**
   * Passed to next-themes ThemeProvider `attribute`.
   * Defaults to "class". Pass ["class", "data-theme"] when your CSS variables
   * are also keyed off a data-theme attribute (mail template).
   */
  themeAttribute?: Attribute | Attribute[];

  /**
   * Passed to Radix TooltipProvider `delayDuration` (ms).
   * Omit to use the Radix default (700 ms).
   */
  tooltipDelayDuration?: number;

  /**
   * Custom Toaster element rendered after children inside TooltipProvider.
   * Pass `null` to suppress the built-in Toaster when children already
   * include a styled one.
   * Defaults to a rich-color bottom-left toaster raised above the environment badge.
   */
  toaster?: React.ReactNode | null;

  /**
   * Passed to next-themes ThemeProvider `disableTransitionOnChange`.
   * Defaults to `true` (suppresses CSS transitions on theme switch, per the
   * shadcn recommendation). Set to `false` when the template intentionally
   * animates theme changes (e.g. content's 3-way theme cycle).
   */
  disableThemeTransitions?: boolean;

  /**
   * Skip the automatic page-local WebMCP action registration.
   * Defaults to false so every AppProviders surface exposes its actions.
   */
  disableWebMcp?: boolean;

  /**
   * Omit named server actions from the automatic registration when a page
   * provides a safer or more specific replacement.
   */
  webMcpExcludeActionNames?: readonly string[];

  /** Render the environment badge in the shared app shell. */
  showEnvironmentBadge?: boolean;

  /**
   * Optional localization runtime configuration. When omitted, AppProviders
   * still mounts the i18n provider with an English fallback so templates can
   * call useT/useLocale before they add catalogs. Pass false to opt out.
   */
  i18n?: Omit<AgentNativeI18nProviderProps, "children"> | false;

  /**
   * When true the providers render without a `<ClientOnly>` gate so SSR
   * streams real markup for public/unauthenticated paths.
   * Defaults to false (authenticated app shell, ClientOnly-gated).
   */
  isPublicPath?: boolean;

  /**
   * Fallback rendered by `<ClientOnly>` while JS hydrates on private paths.
   * Defaults to `<AppShellSkeleton />`.
   */
  clientOnlyFallback?: React.ReactNode;

  /**
   * Skip the default client-side session gate on a private path. Use only for
   * surfaces that authenticate by another mechanism, such as an MCP embed with
   * its own scoped token. Public/SEO routes should use `isPublicPath` instead.
   */
  sessionBypass?: boolean;

  /** Fallback used if route metadata leaves the browser title empty or structured. */
  documentTitleFallback?: string;

  children: React.ReactNode;
}

const DEFAULT_TOASTER = (
  <Toaster
    richColors
    position="bottom-left"
    offset={{ bottom: 44, left: 32 }}
    mobileOffset={{ bottom: 44, left: 16 }}
  />
);

function EarlyBetaRedirectScript() {
  return (
    <script
      data-agent-native-beta-redirect="1"
      dangerouslySetInnerHTML={{
        __html: getSsrBetaRedirectScriptBody(
          agentNativePath("/_agent-native/auth/session"),
          frameworkRoutePrefix(),
        ),
      }}
    />
  );
}

function EarlySessionBootstrapScript() {
  return (
    <script
      data-agent-native-session-bootstrap="1"
      dangerouslySetInnerHTML={{
        __html: getSsrSessionBootstrapScriptBody(
          agentNativePath("/_agent-native/auth/session"),
        ),
      }}
    />
  );
}

function RoutedAppEnhancements({
  settingsShortcut,
}: {
  settingsShortcut: boolean;
}) {
  const isInRouter = useInRouterContext();
  if (!isInRouter) return null;

  return (
    <>
      <AgentNativeRouteWarmup />
      <RouteTransitionIndicator />
      {settingsShortcut ? <SettingsShortcut /> : null}
    </>
  );
}

type WebMcpRegistration = ReturnType<
  (typeof import("./webmcp.js"))["createAgentNativeServerActionWebMcpRegistration"]
>;
type WebMcpModule = typeof import("./webmcp.js");

let webMcpModulePromise: Promise<WebMcpModule> | null = null;

function loadWebMcpModule(): Promise<WebMcpModule> {
  return (webMcpModulePromise ??= import("./webmcp.js"));
}

function AgentNativeWebMcpRegistration({
  excludeActionNames,
}: {
  excludeActionNames?: readonly string[];
}) {
  const excludeActionNamesKey = JSON.stringify(excludeActionNames ?? []);

  useEffect(() => {
    // sessionBypass surfaces are token-authenticated MCP embeds; their host
    // may call tools immediately, so registration must not wait out the
    // paint-aligned window — only the cookie-session-gated variant defers.
    // Ownership is local to this effect: two coexisting surfaces each stop
    // only the registration they created.
    let disposed = false;
    let registration: WebMcpRegistration | null = null;
    void loadWebMcpModule()
      .then(({ createAgentNativeServerActionWebMcpRegistration }) => {
        if (disposed) return;
        registration = createAgentNativeServerActionWebMcpRegistration({
          excludeActionNames,
        });
        void registration.start().catch(() => {
          // WebMCP is progressive enhancement. Session expiry or a transient
          // manifest failure must not prevent the authenticated app from
          // loading.
        });
      })
      .catch(() => {
        // A failed optional WebMCP chunk must not delay the app shell.
      });
    return () => {
      disposed = true;
      registration?.stop();
    };
  }, [excludeActionNamesKey]);
  return null;
}

function SessionGatedAgentNativeWebMcpRegistration({
  excludeActionNames,
}: {
  excludeActionNames?: readonly string[];
}) {
  const { status } = useSession();
  const registrationRef = useRef<WebMcpRegistration | null>(null);
  const registrationExcludeActionNamesKeyRef = useRef<string | null>(null);
  const excludeActionNamesKey = JSON.stringify(excludeActionNames ?? []);
  useEffect(() => {
    // The manifest route requires a session, so registration starts only on
    // a confirmed session: a signed-out visitor (first visit, expired cookie)
    // never logs the manifest 401, and a still-loading or unreadable session
    // waits for the next status change (focus invalidation, session retry,
    // auth arrival) instead of firing a request that is expected to fail.
    // Previously an unavailable session registered anyway ("best-effort");
    // that traded a known-bad manifest fetch for zero benefit.
    if (status === "unauthenticated" || status === "signing-out") {
      // Confirmed sign-out is the only session change that stops a live
      // registration; a transient revalidation (loading/unavailable) keeps
      // the existing one alive until the session settles.
      registrationRef.current?.stop();
      registrationRef.current = null;
      registrationExcludeActionNamesKeyRef.current = null;
      return;
    }
    if (
      status !== "authenticated" ||
      (registrationRef.current &&
        registrationExcludeActionNamesKeyRef.current === excludeActionNamesKey)
    ) {
      return;
    }
    registrationRef.current?.stop();
    registrationRef.current = null;
    registrationExcludeActionNamesKeyRef.current = null;
    let disposed = false;
    const cancel = scheduleAfterPaint(() => {
      void loadWebMcpModule()
        .then(({ createAgentNativeServerActionWebMcpRegistration }) => {
          if (disposed) return;
          const registration = createAgentNativeServerActionWebMcpRegistration({
            excludeActionNames,
          });
          void registration.start().catch(() => {
            // WebMCP is progressive enhancement. Session expiry or a transient
            // manifest failure must not prevent the authenticated app from
            // loading.
          });
          registrationRef.current = registration;
          registrationExcludeActionNamesKeyRef.current = excludeActionNamesKey;
        })
        .catch(() => {
          // A failed optional WebMCP chunk must not delay the app shell.
        });
    });
    return () => {
      disposed = true;
      cancel();
    };
    // Unmount stops exactly the registration this surface created, whether
    // it started or is still scheduled.
  }, [status, excludeActionNamesKey]);
  useEffect(
    () => () => {
      registrationRef.current?.stop();
      registrationRef.current = null;
      registrationExcludeActionNamesKeyRef.current = null;
    },
    [],
  );
  return null;
}

export function AgentNativeWebMcpActionRegistration({
  requireSession = false,
  excludeActionNames,
}: {
  requireSession?: boolean;
  excludeActionNames?: readonly string[];
} = {}) {
  if (requireSession) {
    return (
      <SessionGatedAgentNativeWebMcpRegistration
        excludeActionNames={excludeActionNames}
      />
    );
  }
  return (
    <AgentNativeWebMcpRegistration excludeActionNames={excludeActionNames} />
  );
}

function readDocumentTitleFallback(): string {
  const selectors = [
    'meta[name="application-name"]',
    'meta[name="apple-mobile-web-app-title"]',
    'meta[property="og:site_name"]',
  ];
  const metadataTitle = selectors
    .map(
      (selector) =>
        document.querySelector<HTMLMetaElement>(selector)?.content ?? "",
    )
    .find((title) => isHumanReadableDocumentTitle(title));
  return normalizeDocumentTitle(metadataTitle, "Agent-Native");
}

function EmbeddedThemeSync() {
  const { setTheme } = useTheme();

  useEffect(() => {
    const applyUpdate = (
      update: ReturnType<typeof parseEmbeddedThemeUpdate>,
    ) => {
      if (!update) return;
      applyEmbeddedThemeUpdate(document.documentElement, update);
      setTheme(update.theme);
    };

    const onMessage = (event: MessageEvent) => {
      if (window.parent === window || event.source !== window.parent) return;
      applyUpdate(parseEmbeddedThemeUpdate(event.data));
    };

    const onThemeChange = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      applyUpdate(parseEmbeddedThemeUpdate(event.detail));
    };

    window.addEventListener("message", onMessage);
    window.addEventListener(EMBEDDED_THEME_CHANGE_EVENT, onThemeChange);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener(EMBEDDED_THEME_CHANGE_EVENT, onThemeChange);
    };
  }, [setTheme]);

  return null;
}

/** Repairs route metadata that would otherwise expose a structured payload in the tab. */
function DocumentTitleGuard({ fallbackTitle }: { fallbackTitle?: string }) {
  const initialTitleRef = useRef<string | null>(null);
  if (initialTitleRef.current === null && typeof document !== "undefined") {
    const initialTitle = document.title.trim();
    if (isHumanReadableDocumentTitle(initialTitle)) {
      initialTitleRef.current = initialTitle;
    }
  }

  useEffect(() => {
    let lastKnownTitle = normalizeDocumentTitle(
      initialTitleRef.current ?? fallbackTitle ?? readDocumentTitleFallback(),
      fallbackTitle ?? "Agent-Native",
    );

    const repairTitle = () => {
      const currentTitle = document.title.trim();
      if (isHumanReadableDocumentTitle(currentTitle)) {
        lastKnownTitle = currentTitle;
        return;
      }
      const nextTitle = normalizeDocumentTitle(lastKnownTitle, "Agent-Native");
      if (currentTitle !== nextTitle) document.title = nextTitle;
    };

    repairTitle();
    const observer = new MutationObserver(repairTitle);
    observer.observe(document.head, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [fallbackTitle]);

  return null;
}

function ProvidersInner({
  queryClient,
  defaultTheme = "system",
  themeAttribute = "class",
  tooltipDelayDuration,
  toaster = DEFAULT_TOASTER,
  disableThemeTransitions = true,
  disableWebMcp,
  webMcpExcludeActionNames,
  sessionBypass,
  i18n,
  documentTitleFallback,
  showProductionEnvironmentBadge,
  showEnvironmentBadge,
  settingsShortcut,
  children,
}: {
  queryClient: QueryClient;
  defaultTheme?: string;
  themeAttribute?: Attribute | Attribute[];
  tooltipDelayDuration?: number;
  toaster?: React.ReactNode | null;
  disableThemeTransitions?: boolean;
  disableWebMcp: boolean;
  webMcpExcludeActionNames?: readonly string[];
  sessionBypass: boolean;
  i18n?: Omit<AgentNativeI18nProviderProps, "children"> | false;
  documentTitleFallback?: string;
  showProductionEnvironmentBadge: boolean;
  showEnvironmentBadge: boolean;
  settingsShortcut: boolean;
  children: React.ReactNode;
}) {
  const localizedChildren =
    i18n === false ? (
      children
    ) : (
      <AgentNativeI18nProvider {...(i18n ?? {})}>
        {children}
      </AgentNativeI18nProvider>
    );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute={themeAttribute}
        defaultTheme={defaultTheme}
        enableSystem
        disableTransitionOnChange={disableThemeTransitions}
      >
        <EmbeddedThemeSync />
        <TooltipProvider delayDuration={tooltipDelayDuration}>
          {!disableWebMcp && (
            <AgentNativeWebMcpActionRegistration
              requireSession={!sessionBypass}
              excludeActionNames={webMcpExcludeActionNames}
            />
          )}
          {localizedChildren}
          <DocumentTitleGuard fallbackTitle={documentTitleFallback} />
          <RuntimeConfigNotice />
          <RoutedAppEnhancements settingsShortcut={settingsShortcut} />
          {showEnvironmentBadge ? (
            <EnvironmentBadge showProduction={showProductionEnvironmentBadge} />
          ) : null}
          {toaster}
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

// Public/SEO surfaces must stay impersonal and request-light: they default to
// the non-persisting i18n runtime, which never resolves the session and never
// fires the localization preference read or app-state write (locale comes from
// localStorage/browser language). A caller that explicitly sets
// `persistPreference` keeps its choice; `i18n: false` opts out entirely.
function publicPathI18n(
  i18n: AppProvidersProps["i18n"],
): AppProvidersProps["i18n"] {
  if (i18n === false || i18n?.persistPreference !== undefined) return i18n;
  return { ...(i18n ?? {}), persistPreference: false };
}

export function AppProviders({
  queryClient,
  isPublicPath = false,
  clientOnlyFallback,
  sessionBypass = false,
  disableWebMcp = false,
  webMcpExcludeActionNames,
  showEnvironmentBadge = false,
  defaultTheme,
  themeAttribute,
  tooltipDelayDuration,
  toaster,
  disableThemeTransitions,
  i18n,
  documentTitleFallback,
  children,
}: AppProvidersProps) {
  const fallback = clientOnlyFallback ?? <AppShellSkeleton />;

  if (isPublicPath) {
    return (
      <ProvidersInner
        queryClient={queryClient}
        defaultTheme={defaultTheme}
        themeAttribute={themeAttribute}
        tooltipDelayDuration={tooltipDelayDuration}
        toaster={toaster}
        disableThemeTransitions={disableThemeTransitions}
        disableWebMcp={disableWebMcp}
        webMcpExcludeActionNames={webMcpExcludeActionNames}
        sessionBypass={sessionBypass}
        i18n={publicPathI18n(i18n)}
        documentTitleFallback={documentTitleFallback}
        showProductionEnvironmentBadge={false}
        showEnvironmentBadge={showEnvironmentBadge}
        settingsShortcut={false}
      >
        {children}
      </ProvidersInner>
    );
  }

  // Keep the bootstrap outside ClientOnly so the HTML parser can run it before
  // the authenticated client bundle starts.
  return (
    <>
      {!sessionBypass && (
        <>
          <EarlySessionBootstrapScript />
          <EarlyBetaRedirectScript />
        </>
      )}
      <ClientOnly fallback={fallback}>
        <ProvidersInner
          queryClient={queryClient}
          defaultTheme={defaultTheme}
          themeAttribute={themeAttribute}
          tooltipDelayDuration={tooltipDelayDuration}
          toaster={toaster}
          disableThemeTransitions={disableThemeTransitions}
          disableWebMcp={disableWebMcp}
          webMcpExcludeActionNames={webMcpExcludeActionNames}
          sessionBypass={sessionBypass}
          i18n={i18n}
          documentTitleFallback={documentTitleFallback}
          showProductionEnvironmentBadge={!sessionBypass}
          showEnvironmentBadge={showEnvironmentBadge}
          settingsShortcut={!sessionBypass}
        >
          <RequireSession bypass={sessionBypass} fallback={fallback}>
            {sessionBypass ? (
              children
            ) : (
              <FirstRunOnboardingStartupGate>
                {children}
              </FirstRunOnboardingStartupGate>
            )}
          </RequireSession>
        </ProvidersInner>
      </ClientOnly>
    </>
  );
}
