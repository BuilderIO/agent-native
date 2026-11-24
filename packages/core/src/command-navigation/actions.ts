import { z } from "zod";

import { defineAction } from "../action.js";
import {
  navigationIntentSchema,
  writeNavigationCommand,
  type DetailViewPredicate,
} from "../application-state/agent-navigation.js";
import { readAppState } from "../application-state/index.js";
import { navigationModeSchema } from "../manifest/index.js";

const navigateSchema = z
  .object({
    view: z.string().optional().describe("View name to navigate to"),
    path: z.string().optional().describe("URL path to navigate to"),
    intent: navigationIntentSchema,
    navigationMode: navigationModeSchema.optional(),
  })
  .passthrough();

export interface CreateNavigateActionOptions {
  description?: string;
  stateKey?: string;
  normalize?: (
    args: z.infer<typeof navigateSchema>,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  describeResult?: (
    navigation: Record<string, unknown>,
    args: z.infer<typeof navigateSchema>,
  ) => string;
  /**
   * Which navigations open one item's detail view. Defaults to
   * `isDefaultDetailNavigation` (any `id` / `*Id` / `*_id` field or nested
   * detail path outside `/settings`). An agent call to one is refused unless
   * it passes `intent: "open"`.
   */
  isDetailView?: DetailViewPredicate;
}

export interface CreateViewScreenActionOptions {
  description?: string;
  navigationStateKey?: string;
  extraStateKeys?: string[];
  describeResult?: (
    screen: Record<string, unknown>,
  ) =>
    | Record<string, unknown>
    | string
    | Promise<Record<string, unknown> | string>;
}

export function createNavigateAction(
  options: CreateNavigateActionOptions = {},
) {
  const stateKey = options.stateKey ?? "navigate";
  return defineAction({
    description:
      options.description ??
      'Show an app screen. Use navigationMode "open" for an explicit request, "reveal" to show an answer or artifact, and "keep" for background work.',
    schema: navigateSchema,
    http: false,
    run: async (args, ctx) => {
      const { intent, navigationMode, ...target } = args;
      if (!target.view && !target.path) {
        throw new Error("At least --view or --path is required.");
      }
      const navigation = options.normalize
        ? await options.normalize(target)
        : ({
            ...(target.view ? { view: target.view } : null),
            ...(target.path ? { path: target.path } : null),
          } as Record<string, unknown>);
      const result = await writeNavigationCommand(navigation, {
        ctx,
        intent,
        navigationMode,
        isDetailView: options.isDetailView,
        isNavigateAction: true,
        stateKey,
      });
      const message = result.navigated
        ? options.describeResult?.(navigation, args)
        : undefined;
      return message === undefined ? result : { ...result, message };
    },
  });
}

export function createViewScreenAction(
  options: CreateViewScreenActionOptions = {},
) {
  const navigationStateKey = options.navigationStateKey ?? "navigation";
  return defineAction({
    description:
      options.description ??
      "See what the user is currently looking at on screen. Returns the current navigation state.",
    schema: z.object({}),
    http: false,
    readOnly: true,
    run: async () => {
      const screen: Record<string, unknown> = {};
      const navigation = await readAppState(navigationStateKey);
      if (navigation) screen.navigation = navigation;

      for (const key of options.extraStateKeys ?? []) {
        const value = await readAppState(key);
        if (value !== null && value !== undefined) screen[key] = value;
      }

      if (Object.keys(screen).length === 0) {
        return "No application state found. Is the app running?";
      }
      return options.describeResult
        ? await options.describeResult(screen)
        : screen;
    },
  });
}
