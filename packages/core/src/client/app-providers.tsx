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
 *       clientOnlyFallback={<DefaultSpinner />}
 *     >
 *       ...
 *     </AppProviders>
 *
 *   When `isPublicPath` is true the providers render without `<ClientOnly>` or
 *   a session gate, streaming real markup to the client. When false (the
 *   default), `<ClientOnly>` hydrates the shared SSR shell and
 *   `<RequireSession>` redirects signed-out visitors to the framework sign-in
 *   page before private app chrome mounts. When `clientOnlyFallback` is
 *   omitted, `<DefaultSpinner />` is used.
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
 *                              Defaults to `<Toaster richColors position="bottom-left" />`.
 *   disableThemeTransitions  — passed to next-themes ThemeProvider
 *                              `disableTransitionOnChange`. Defaults to `true`
 *                              (suppresses CSS transitions during theme switches,
 *                              which is the shadcn recommendation and avoids
 *                              flash artefacts). Set to `false` when the template
 *                              intentionally animates theme changes (e.g. content).
 */

import { TooltipProvider } from "@radix-ui/react-tooltip";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { ThemeProvider, type Attribute } from "next-themes";
import React from "react";
import { Toaster } from "sonner";

import { ClientOnly } from "./ClientOnly.js";
import { DefaultSpinner } from "./DefaultSpinner.js";
import {
  AgentNativeI18nProvider,
  type AgentNativeI18nProviderProps,
} from "./i18n.js";
import { RequireSession } from "./require-session.js";

export interface AppProvidersProps {
  /** QueryClient instance — create with `createAgentNativeQueryClient()`. */
  queryClient: QueryClient;

  /**
   * Default theme passed to next-themes `ThemeProvider`.
   * Defaults to `"system"`.  Dark-first templates (slides, macros, analytics)
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
   * Defaults to `<Toaster richColors position="bottom-left" />`.
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
   * Defaults to `<DefaultSpinner />`.
   */
  clientOnlyFallback?: React.ReactNode;

  /**
   * Skip the default client-side session gate on a private path. Use only for
   * surfaces that authenticate by another mechanism, such as an MCP embed with
   * its own scoped token. Public/SEO routes should use `isPublicPath` instead.
   */
  sessionBypass?: boolean;

  children: React.ReactNode;
}

const DEFAULT_TOASTER = <Toaster richColors position="bottom-left" />;

function ProvidersInner({
  queryClient,
  defaultTheme = "system",
  themeAttribute = "class",
  tooltipDelayDuration,
  toaster = DEFAULT_TOASTER,
  disableThemeTransitions = true,
  i18n,
  children,
}: {
  queryClient: QueryClient;
  defaultTheme?: string;
  themeAttribute?: Attribute | Attribute[];
  tooltipDelayDuration?: number;
  toaster?: React.ReactNode | null;
  disableThemeTransitions?: boolean;
  i18n?: Omit<AgentNativeI18nProviderProps, "children"> | false;
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
        <TooltipProvider delayDuration={tooltipDelayDuration}>
          {localizedChildren}
          {toaster}
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export function AppProviders({
  queryClient,
  isPublicPath = false,
  clientOnlyFallback,
  sessionBypass = false,
  defaultTheme,
  themeAttribute,
  tooltipDelayDuration,
  toaster,
  disableThemeTransitions,
  i18n,
  children,
}: AppProvidersProps) {
  const fallback = clientOnlyFallback ?? <DefaultSpinner />;

  if (isPublicPath) {
    return (
      <ProvidersInner
        queryClient={queryClient}
        defaultTheme={defaultTheme}
        themeAttribute={themeAttribute}
        tooltipDelayDuration={tooltipDelayDuration}
        toaster={toaster}
        disableThemeTransitions={disableThemeTransitions}
        i18n={i18n}
      >
        {children}
      </ProvidersInner>
    );
  }

  return (
    <ClientOnly fallback={fallback}>
      <ProvidersInner
        queryClient={queryClient}
        defaultTheme={defaultTheme}
        themeAttribute={themeAttribute}
        tooltipDelayDuration={tooltipDelayDuration}
        toaster={toaster}
        disableThemeTransitions={disableThemeTransitions}
        i18n={i18n}
      >
        <RequireSession bypass={sessionBypass} fallback={fallback}>
          {children}
        </RequireSession>
      </ProvidersInner>
    </ClientOnly>
  );
}
