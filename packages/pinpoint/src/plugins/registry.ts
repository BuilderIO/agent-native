
import type {
  Plugin,
  PluginHooks,
  PinpointAPI,
  PluginHookRegistry,
} from "../types/index.js";

const plugins: Map<string, Plugin> = new Map();
const hookHandlers: Map<keyof PluginHooks, Set<Function>> = new Map();

export function registerPlugin(plugin: Plugin, api?: PinpointAPI): void {
  if (plugins.has(plugin.name)) {
    unregisterPlugin(plugin.name);
  }

  plugins.set(plugin.name, plugin);

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

export function unregisterPlugin(name: string): void {
  const plugin = plugins.get(name);
  if (!plugin) return;

  if (plugin.hooks) {
    for (const [hookName, handler] of Object.entries(plugin.hooks)) {
      if (typeof handler === "function") {
        hookHandlers.get(hookName as keyof PluginHooks)?.delete(handler);
      }
    }
  }

  plugins.delete(name);
}

export function getPlugins(): string[] {
  return Array.from(plugins.keys());
}

export function dispatchHook(
  name: keyof PluginHooks,
  ...args: unknown[]
): void {
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

export function dispatchTransformHook<T>(
  name: keyof PluginHooks,
  initial: T,
): T | false {
  const handlers = hookHandlers.get(name);
  if (!handlers) return initial;

  let current: T | false = initial;
  for (const handler of handlers) {
    try {
      const result = handler(current) as T | false | undefined;
      if (result === false) return false;
      if (result !== undefined) current = result;
    } catch (err) {
      console.warn(`[pinpoint] Plugin hook ${name} error:`, err);
    }
  }

  return current;
}

export function getPluginActions() {
  const actions = [];
  for (const plugin of plugins.values()) {
    if (plugin.actions) {
      actions.push(...plugin.actions);
    }
  }
  return actions;
}
