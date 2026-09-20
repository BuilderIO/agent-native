import type {
  ActionDeepLink,
  ActionLinkBuilder,
  ActionMcpAppConfig,
} from "../action.js";
import { embedApp, type EmbedAppOptions } from "./embed-app.js";

export interface EmbedRouteContext<
  TArgs extends Record<string, any> = Record<string, any>,
  TResult = any,
> {
  args: TArgs;
  result: TResult;
}

export type EmbedRoutePathBuilder<
  TArgs extends Record<string, any> = Record<string, any>,
  TResult = any,
> = (
  ctx: EmbedRouteContext<TArgs, TResult>,
) => string | ActionDeepLink | null | undefined;

export interface EmbedRouteOptions<
  TArgs extends Record<string, any> = Record<string, any>,
  TResult = any,
> extends Pick<
  EmbedAppOptions,
  | "description"
  | "iframeTitle"
  | "embedByDefault"
  | "startToolName"
  | "frameDomains"
  | "height"
> {
  title: string;
  openLabel: string;
  /** Build the app route or full deep-link surfaced after an action completes. */
  path: EmbedRoutePathBuilder<TArgs, TResult>;
}

export interface EmbedRouteResult {
  link: ActionLinkBuilder;
  mcpApp: ActionMcpAppConfig;
}

/**
 * Create matching action `link` and `mcpApp` metadata for an embeddable route.
 *
 * The `path` builder stays pure and synchronous, just like action link
 * builders. Return an app-relative path string for the common case, or an
 * `ActionDeepLink` when you need a custom label/view.
 */
export function embedRoute<
  TArgs extends Record<string, any> = Record<string, any>,
  TResult = any,
>(options: EmbedRouteOptions<TArgs, TResult>): EmbedRouteResult {
  const label = options.openLabel;

  return {
    link: ({ args, result }) => {
      const route = options.path({
        args: args as TArgs,
        result: result as TResult,
      });
      if (!route) return null;
      if (typeof route === "string") {
        return { url: route, label };
      }
      return route;
    },
    mcpApp: {
      resource: embedApp({
        title: options.title,
        description: options.description,
        iframeTitle: options.iframeTitle,
        openLabel: options.openLabel,
        embedByDefault: options.embedByDefault,
        startToolName: options.startToolName,
        frameDomains: options.frameDomains,
        height: options.height,
      }),
    },
  };
}
