// @agent-native/pinpoint — Plugin registration and hook dispatch
// MIT License

import type {
  Plugin,
  PluginHooks,
  PinpointAPI,
  PluginHookRegistry,
} from "../types/index.js";

const plugins: Map<string, Plugin> = new Map();
const hookHandlers: Map<keyof PluginHooks, Set<Function>> = new Map();

/**
 * Register a plugin.
 */
export function registerPlugin(plugin: Plugin, api?: PinpointAPI): void {
  if (plugins.has(plugin.name)) {
    unregisterPlugin(plugin.name);
  }

  plugins.set(plugin.name, plugin);

  // Register hook handlers
  if (plugin.hooks) {
    for (const [hookName, handler] of Object.entries(plugin.hooks)) {
      if (typeof handler === "function") {
        const key = hookName as keyof PluginHooks;
        if (!hookHandlers.has(key)) {
          hookHandlers.set(key, new Set());
        }
        hookHandlers.get(key)!.add(handler);
      }
    }
  }

  // Call setup if provided
  if (plugin.setup && api) {
    const registry: PluginHookRegistry = {
      register(hookName, handler) {
        if (!hookHandlers.has(hookName)) {
          hookHandlers.set(hookName, new Set());
        }
        hookHandlers.get(hookName)!.add(handler);
      },
      unregister(hookName, handler) {
        hookHandlers.get(hookName)?.delete(handler);
      },
    };
    plugin.setup(api, registry);
  }
}

/**
 * Unregister a plugin by name.
 */
export function unregisterPlugin(name: string): void {
  const plugin = plugins.get(name);
  if (!plugin) return;

  // Remove hook handlers
  if (plugin.hooks) {
    for (const [hookName, handler] of Object.entries(plugin.hooks)) {
      if (typeof handler === "function") {
        hookHandlers.get(hookName as keyof PluginHooks)?.delete(handler);
      }
    }
  }

  plugins.delete(name);
}

/**
 * Get all registered plugin names.
 */
export function getPlugins(): string[] {
  return Array.from(plugins.keys());
}

/**
 * Dispatch a hook to all registered handlers.
 */
export function dispatchHook(name: keyof PluginHooks, ...args: any[]): void {
  const handlers = hookHandlers.get(name);
  if (!handlers) return;

  for (const handler of handlers) {
    try {
      handler(...args);
    } catch (err) {
      console.warn(`[pinpoint] Plugin hook ${name} error:`, err);
    }
  }
}

/**
 * Dispatch a hook that can transform data (pipeline pattern).
 * Returns the transformed value, or false to cancel.
 */
export function dispatchTransformHook<T>(
  name: keyof PluginHooks,
  initial: T,
): T | false {
  const handlers = hookHandlers.get(name);
  if (!handlers) return initial;

  let current: T | false = initial;
  for (const handler of handlers) {
    try {
      const result: any = handler(current);
      if (result === false) return false;
      if (result !== undefined) current = result as T;
    } catch (err) {
      console.warn(`[pinpoint] Plugin hook ${name} error:`, err);
    }
  }

  return current;
}

/**
 * Get context menu actions from all plugins.
 */
export function getPluginActions() {
  const actions = [];
  for (const plugin of plugins.values()) {
    if (plugin.actions) {
      actions.push(...plugin.actions);
    }
  }
  return actions;
}
