
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

export interface AppProvidersProps {
  queryClient: QueryClient;

  defaultTheme?: string;

  themeAttribute?: Attribute | Attribute[];

  tooltipDelayDuration?: number;

  toaster?: React.ReactNode | null;

  disableThemeTransitions?: boolean;

  disableWebMcp?: boolean;

  webMcpExcludeActionNames?: readonly string[];

  showEnvironmentBadge?: boolean;

  i18n?: Omit<AgentNativeI18nProviderProps, "children"> | false;

  isPublicPath?: boolean;

  clientOnlyFallback?: React.ReactNode;

  /**
   * Skip the default client-side session gate on a private path. Use only for
   * surfaces that authenticate by another mechanism, such as an MCP embed with
   * its own scoped token. Public/SEO routes should use `isPublicPath` instead.
   */
  sessionBypass?: boolean;

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

function RoutedAppEnhancements() {
  const isInRouter = useInRouterContext();
  if (!isInRouter) return null;

  return (
    <>
      <AgentNativeRouteWarmup />
      <RouteTransitionIndicator />
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
    // paint-aligned window — only the cookie-session-gated variant defers.
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
    if (status === "unauthenticated" || status === "signing-out") {
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
          <RoutedAppEnhancements />
          {showEnvironmentBadge ? (
            <EnvironmentBadge showProduction={showProductionEnvironmentBadge} />
          ) : null}
          {toaster}
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

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
      >
        {children}
      </ProvidersInner>
    );
  }

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
