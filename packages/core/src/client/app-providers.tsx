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
 *   When `isPublicPath` is true the providers render without `<ClientOnly>`,
 *   streaming real markup to the client. When false (the default) the standard
 *   `<ClientOnly fallback={clientOnlyFallback}>` gate wraps everything.
 *   When `clientOnlyFallback` is omitted, `<DefaultSpinner />` is used.
 *
 * Customisation props:
 *   themeAttribute       — passed to next-themes ThemeProvider `attribute`.
 *                          Defaults to "class". Use ["class", "data-theme"]
 *                          when CSS variables are also keyed off a data-theme
 *                          attribute (mail template).
 *   tooltipDelayDuration — passed to Radix TooltipProvider `delayDuration`
 *                          (ms). Omit to use the Radix default (700 ms).
 *   toaster              — custom Toaster element rendered after children.
 *                          Pass `null` to suppress the built-in Toaster when
 *                          children already include a styled one.
 *                          Defaults to `<Toaster richColors position="bottom-left" />`.
 */

import React from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { ThemeProvider, type Attribute } from "next-themes";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { Toaster } from "sonner";
import { ClientOnly } from "./ClientOnly.js";
import { DefaultSpinner } from "./DefaultSpinner.js";

export interface AppProvidersProps {
  /** QueryClient instance — create with `createAgentNativeQueryClient()`. */
  queryClient: QueryClient;

  /**
   * Default theme passed to next-themes `ThemeProvider`.
   * Defaults to `"system"`.  Dark-first templates (videos, slides, macros,
   * analytics) pass `"dark"`.
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

  children: React.ReactNode;
}

const DEFAULT_TOASTER = <Toaster richColors position="bottom-left" />;

function ProvidersInner({
  queryClient,
  defaultTheme = "system",
  themeAttribute = "class",
  tooltipDelayDuration,
  toaster = DEFAULT_TOASTER,
  children,
}: {
  queryClient: QueryClient;
  defaultTheme?: string;
  themeAttribute?: Attribute | Attribute[];
  tooltipDelayDuration?: number;
  toaster?: React.ReactNode | null;
  children: React.ReactNode;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute={themeAttribute}
        defaultTheme={defaultTheme}
        enableSystem
        disableTransitionOnChange
      >
        <TooltipProvider delayDuration={tooltipDelayDuration}>
          {children}
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
  defaultTheme,
  themeAttribute,
  tooltipDelayDuration,
  toaster,
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
      >
        {children}
      </ProvidersInner>
    </ClientOnly>
  );
}
