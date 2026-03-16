// @agent-native/pinpoint — Vue 3 adapter
// MIT License
//
// Detects Vue 3 apps via window.__VUE__ or [data-v-] attributes.
// Walks component tree via __vueParentComponent DOM properties.

import type {
  FrameworkAdapter,
  ComponentInfo,
  SourceLocation,
} from "../types/index.js";

export const vueAdapter: FrameworkAdapter = {
  name: "vue",

  detect(): boolean {
    if (typeof window === "undefined") return false;
    // Vue 3 devtools hook
    if ((window as any).__VUE__) return true;
    // Vue 3 scoped style attributes
    if (document.querySelector("[data-v-]")) return true;
    // Check for Vue 3 app instance
    return !!document.querySelector("[__vue_app__]");
  },

  getComponentInfo(element: Element): ComponentInfo | null {
    const instance = getVueInstance(element);
    if (!instance) return null;

    const name = getComponentName(instance);
    const components = buildVueComponentPath(element);

    return {
      name: name || "Unknown",
      displayName: name || undefined,
      filePath: instance.$options?.__file || instance.type?.__file,
      lineNumber: undefined, // Vue doesn't expose line numbers like React
    };
  },

  getSourceLocation(element: Element): SourceLocation | null {
    const instance = getVueInstance(element);
    if (!instance) return null;

    const file =
      instance.$options?.__file ||
      instance.type?.__file ||
      instance.type?.__name;

    if (!file) return null;

    return { file };
  },
};

/**
 * Get the Vue component instance associated with a DOM element.
 */
function getVueInstance(element: Element): any {
  // Vue 3: __vueParentComponent or __vue_app__
  const el = element as any;

  if (el.__vueParentComponent) {
    return el.__vueParentComponent;
  }

  // Walk up to find the nearest Vue component
  let current: Element | null = element;
  while (current) {
    if ((current as any).__vueParentComponent) {
      return (current as any).__vueParentComponent;
    }
    // Vue 2 compatibility
    if ((current as any).__vue__) {
      return (current as any).__vue__;
    }
    current = current.parentElement;
  }

  return null;
}

/**
 * Get the display name of a Vue component instance.
 */
function getComponentName(instance: any): string | null {
  if (!instance) return null;

  // Vue 3 Composition API
  if (instance.type?.name) return instance.type.name;
  if (instance.type?.__name) return instance.type.__name;

  // Vue 3 Options API
  if (instance.$options?.name) return instance.$options.name;

  // Infer from __file
  const file = instance.type?.__file || instance.$options?.__file;
  if (file) {
    const match = file.match(/([^/\\]+)\.\w+$/);
    if (match) return match[1];
  }

  return null;
}

/**
 * Build a component path for Vue by walking up the component tree.
 */
function buildVueComponentPath(element: Element): string {
  const components: string[] = [];
  let current: Element | null = element;

  while (current && components.length < 10) {
    const instance = (current as any).__vueParentComponent;
    if (instance) {
      const name = getComponentName(instance);
      if (name) {
        components.unshift(`<${name}>`);
      }
    }
    current = current.parentElement;
  }

  return components.join(" ");
}
