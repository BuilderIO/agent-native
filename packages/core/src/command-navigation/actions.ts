import { z } from "zod";

import { defineAction } from "../action.js";
import {
  AgentNavigationRefusedError,
  buildAgentNavigationKeptResult,
  evaluateAgentNavigation,
  navigationIntentSchema,
  withAuthorizedAgentNavigation,
  type DetailViewPredicate,
} from "../application-state/agent-navigation.js";
import { readAppState, writeAppState } from "../application-state/index.js";

const navigateSchema = z
  .object({
    view: z.string().optional().describe("View name to navigate to"),
    path: z.string().optional().describe("URL path to navigate to"),
    intent: navigationIntentSchema,
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

function writeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createNavigateAction(
  options: CreateNavigateActionOptions = {},
) {
  const stateKey = options.stateKey ?? "navigate";
  return defineAction({
    description:
      options.description ??
      'Navigate the UI to a specific view or path. Pass intent: "open" only when the user asked to open or show an item; otherwise keep the user\'s current view.',
    schema: navigateSchema,
    http: false,
    run: async (args, ctx) => {
      if (!args.view && !args.path) {
        throw new Error("At least --view or --path is required.");
      }
      const { intent, ...target } = args;
      const navigation = options.normalize
        ? await options.normalize(target)
        : ({
            ...(target.view ? { view: target.view } : null),
            ...(target.path ? { path: target.path } : null),
          } as Record<string, unknown>);
      const refusal = evaluateAgentNavigation(navigation, {
        ctx,
        intent,
        isDetailView: options.isDetailView,
        isNavigateAction: true,
      });
      if (refusal) {
        if (refusal.reason === "read-only-action") {
          throw new AgentNavigationRefusedError(refusal.message, {
            reason: refusal.reason,
          });
        }
        const currentView = await readAppState("navigation");
        return buildAgentNavigationKeptResult(refusal.reason, currentView);
      }
      navigation._writeId = writeId();
      await withAuthorizedAgentNavigation(() =>
        writeAppState(stateKey, navigation),
      );
      return (
        options.describeResult?.(navigation, args) ??
        `Navigating to ${String(args.view || args.path)}`
      );
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
