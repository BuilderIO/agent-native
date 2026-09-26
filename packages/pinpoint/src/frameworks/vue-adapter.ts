// MIT License

import type {
  FrameworkAdapter,
  ComponentInfo,
  SourceLocation,
} from "../types/index.js";

export const vueAdapter: FrameworkAdapter = {
  name: "vue",

  detect(): boolean {
    if (typeof window === "undefined") return false;
    if ((window as any).__VUE__) return true;
    if (document.querySelector("[data-v-]")) return true;
    return !!document.querySelector("[__vue_app__]");
  },

  getComponentInfo(element: Element): ComponentInfo | null {
    const instance = getVueInstance(element);
    if (!instance) return null;

    const name = getComponentName(instance);

    return {
      name: name || "Unknown",
      displayName: name || undefined,
      filePath: instance.$options?.__file || instance.type?.__file,
      lineNumber: undefined,
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

function getVueInstance(element: Element): any {
  const el = element as any;

  if (el.__vueParentComponent) {
    return el.__vueParentComponent;
  }

  let current: Element | null = element;
  while (current) {
    if ((current as any).__vueParentComponent) {
      return (current as any).__vueParentComponent;
    }
    if ((current as any).__vue__) {
      return (current as any).__vue__;
    }
    current = current.parentElement;
  }

  return null;
}

function getComponentName(instance: any): string | null {
  if (!instance) return null;

  if (instance.type?.name) return instance.type.name;
  if (instance.type?.__name) return instance.type.__name;

  if (instance.$options?.name) return instance.$options.name;

  const file = instance.type?.__file || instance.$options?.__file;
  if (file) {
    const match = file.match(/([^/\\]+)\.\w+$/);
    if (match) return match[1];
  }

  return null;
}
