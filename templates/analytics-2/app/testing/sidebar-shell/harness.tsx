import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, useLayoutEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { expect, vi } from "vitest";

import { isPresent } from "./row-contracts";

export const directory = resolve("app/testing/sidebar-shell");
export function frozen(name: string, value: unknown, stableIds = false) {
  const file = resolve(directory, "__goldens__", `${name}.json`);
  const json = JSON.stringify(value, null, 2);
  const actual = `${stableIds ? normalize(json) : json}\n`;
  if (
    !existsSync(file) &&
    import.meta.env.MODE === "test" &&
    import.meta.env.DEV &&
    !import.meta.env.PROD &&
    process.env.NODE_ENV === "test" &&
    !process.env.CI &&
    process.env.AGENT_NATIVE_CAPTURE_NEW_BASELINES === "1"
  )
    writeFileSync(file, actual, { flag: "wx" });
  expect(
    existsSync(file),
    `Missing frozen file ${name}; creation is explicit`,
  ).toBe(true);
  expect(actual, `Frozen ${name} changed; no existing file is rewritten`).toBe(
    readFileSync(file, "utf8"),
  );
}
export function normalize(markup: string) {
  const ids = new Map<string, string>();
  return markup.replace(
    /(?:radix-)?(?:_r_[A-Za-z0-9]+_|[«:]r[^\s"<>»]*[»:])/g,
    (id) => {
      if (!ids.has(id)) ids.set(id, `generated-${ids.size + 1}`);
      return ids.get(id) as string;
    },
  );
}
export function attrs(element: Element) {
  return Object.fromEntries(
    [...element.attributes]
      .map((a): [string, string] => [a.name, a.value])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}
export const storageEvents: {
  area: string;
  operation: string;
  key: string;
  value?: string;
}[] = [];
const keys = new Set<string>();
const queries = new Map<string, Set<EventListenerOrEventListenerObject>>();
export let width = 1280;
export let dark = false;
let cleanups: (() => void)[] = [];
let roots: Root[] = [];
export let route = "/home";
export let navigate: (path: string) => void;
export function init(
  options: {
    width?: number;
    dark?: boolean;
    storage?: Record<string, string>;
  } = {},
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({
    toFake: [
      "Date",
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
  vi.setSystemTime(new Date("2026-11-12T08:00:00.000Z"));
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network forbidden in shell baselines");
    }),
  );
  document.documentElement
    .getAttributeNames()
    .forEach((a) => document.documentElement.removeAttribute(a));
  document.documentElement.setAttribute("lang", "en");
  document.body
    .getAttributeNames()
    .forEach((a) => document.body.removeAttribute(a));
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  const style = document.createElement("style");
  style.textContent = readFileSync(resolve("app/global.css"), "utf8").replace(
    /^@(?:import|source).*;$/gm,
    "",
  );
  document.head.append(style);
  for (const area of ["localStorage", "sessionStorage"] as const) {
    const data = new Map<string, string>();
    vi.stubGlobal(area, {
      get length() {
        return data.size;
      },
      key: (i: number) => [...data.keys()][i] ?? null,
      getItem: (k: string) => data.get(String(k)) ?? null,
      setItem: (k: string, v: string) => {
        data.set(String(k), String(v));
      },
      removeItem: (k: string) => {
        data.delete(String(k));
      },
      clear: () => data.clear(),
    });
  }
  for (const [k, v] of Object.entries(options.storage ?? {}))
    localStorage.setItem(k, v);
  keys.clear();
  storageEvents.length = 0;
  queries.clear();
  width = options.width ?? 1280;
  dark = options.dark ?? false;
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 900,
  });
  const matches = (query: string) =>
    query.includes("prefers-color-scheme")
      ? dark
      : query.includes("1050")
        ? width <= 1050
        : query.includes("700")
          ? width <= 700
          : false;
  vi.stubGlobal("matchMedia", (query: string) => {
    if (!queries.has(query)) queries.set(query, new Set());
    return {
      media: query,
      get matches() {
        return matches(query);
      },
      onchange: null,
      addEventListener: (
        _: string,
        listener: EventListenerOrEventListenerObject,
      ) => queries.get(query)?.add(listener),
      removeEventListener: (
        _: string,
        listener: EventListenerOrEventListenerObject,
      ) => queries.get(query)?.delete(listener),
      addListener: (listener: EventListenerOrEventListenerObject) =>
        queries.get(query)?.add(listener),
      removeListener: (listener: EventListenerOrEventListenerObject) =>
        queries.get(query)?.delete(listener),
      dispatchEvent: () => true,
    };
  });
  for (const [area, store] of [
    ["local", localStorage],
    ["session", sessionStorage],
  ] as const) {
    for (const operation of ["getItem", "setItem", "removeItem"] as const) {
      const original = store[operation].bind(store);
      const descriptor = Object.getOwnPropertyDescriptor(store, operation);
      Object.defineProperty(store, operation, {
        configurable: true,
        value: (key: string, value?: string) => {
          keys.add(key);
          storageEvents.push({
            area,
            operation,
            key,
            ...(value === undefined ? {} : { value: String(value) }),
          });
          return operation === "setItem"
            ? (original as (k: string, v: string) => void)(key, String(value))
            : (original as (k: string) => unknown)(key);
        },
      });
      cleanups.push(() =>
        descriptor
          ? Object.defineProperty(store, operation, descriptor)
          : Reflect.deleteProperty(store, operation),
      );
    }
  }
}
export async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(40);
  });
}
export async function media(next: { width?: number; dark?: boolean }) {
  await act(async () => {
    if (next.width !== undefined) {
      width = next.width;
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: width,
      });
    }
    if (next.dark !== undefined) dark = next.dark;
    for (const [query, listeners] of queries)
      for (const listener of listeners) {
        const event = Object.assign(new Event("change"), {
          matches: window.matchMedia(query).matches,
        });
        typeof listener === "function"
          ? listener(event)
          : listener.handleEvent(event);
      }
    window.dispatchEvent(new Event("resize"));
  });
  await settle();
}
function Location() {
  const location = useLocation();
  const go = useNavigate();
  route = location.pathname + location.search + location.hash;
  navigate = (path) => {
    void go(path);
  };
  return null;
}
export async function mount(
  node: ReactNode,
  path = "/home",
  ready?: () => void,
) {
  const host = document.createElement("div");
  host.setAttribute("data-test-host", "");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  function Ready() {
    useLayoutEffect(() => {
      ready?.();
    }, []);
    return null;
  }
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Location />
        {node}
        <Ready />
      </MemoryRouter>,
    ),
  );
  await settle();
  return {
    host,
    update: async (next: ReactNode) => {
      await act(async () =>
        root.render(
          <MemoryRouter initialEntries={[path]}>
            <Location />
            {next}
          </MemoryRouter>,
        ),
      );
      await settle();
    },
  };
}
export async function dispose() {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  cleanups.reverse().forEach((fn) => fn());
  cleanups = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
}
export function button(label: string, scope: ParentNode = document.body) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) =>
      b.getAttribute("aria-label") === label ||
      b.textContent?.trim() === label ||
      b.querySelector(".ws-nav-label,.ws-menu-label,.ws-search-label")
        ?.textContent === label,
  );
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
export async function click(element: HTMLElement) {
  await act(async () => element.click());
  await settle();
}
export async function key(
  element: HTMLElement | Window,
  key: string,
  options: KeyboardEventInit = {},
) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  await act(async () => element.dispatchEvent(event));
  await settle();
  return event;
}
export async function input(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
      element,
      value,
    );
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}
export function envelope() {
  const css = getComputedStyle(document.documentElement);
  const names = [
    ...new Set(
      [
        ...readFileSync(resolve("app/global.css"), "utf8").matchAll(
          /--ws-[\w-]+/g,
        ),
      ].map((m) => m[0]),
    ),
  ].sort();
  const storage = (store: Storage) =>
    Object.fromEntries([...keys].sort().map((k) => [k, store.getItem(k)]));
  const events = [...storageEvents];
  const value = {
    html: attrs(document.documentElement),
    body: attrs(document.body),
    inlineCustomProperties: Array.from(
      { length: document.documentElement.style.length },
      (_, i) => document.documentElement.style.item(i),
    )
      .filter((k) => k.startsWith("--"))
      .map((k) => [k, document.documentElement.style.getPropertyValue(k)]),
    colorScheme: css.colorScheme,
    tokens: Object.fromEntries(names.map((n) => [n, css.getPropertyValue(n)])),
    viewport: { width, height: window.innerHeight },
    media: { drawer: width <= 1050, fullWidthDrawer: width <= 700, dark },
    route,
    hosts: [
      ...document.querySelectorAll(
        "[data-route-frame], [data-closed], [data-experience], [data-pointer-cursors], [data-underline-links]",
      ),
    ].map(attrs),
    storage: { local: storage(localStorage), session: storage(sessionStorage) },
    storageEvents: events,
    time: "2026-11-12T08:00:00.000Z",
    environment: "happy-dom; no layout engine",
    experience: "unused reskin remains off",
  };
  storageEvents.splice(events.length);
  return value;
}
export function capture(
  name: string,
  rows: string[],
  inputs: Record<string, unknown>,
  extra: unknown = null,
  { normalizeControlIds = true } = {},
) {
  const markup = normalize(document.body.innerHTML);
  const root = envelope();
  const controls = [
    ...document.body.querySelectorAll<HTMLElement>(
      'button,a,input,textarea,select,[role="menu"],[role="dialog"]',
    ),
  ].map((el) => ({
    tag: el.tagName.toLowerCase(),
    attributes: attrs(el),
    text: el.textContent?.trim(),
    value:
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
        ? el.value
        : null,
  }));
  frozen(
    name,
    { name, rows, inputs, root, markup, controls, extra },
    normalizeControlIds,
  );
  const surface = document.body.cloneNode(true) as HTMLElement;
  const hiddenCopies: string[] = [];
  for (const selector of width > 1050
    ? [".ws-mobile-nav"]
    : [".ws-sidebar[data-closed='true']"]) {
    for (const el of surface.querySelectorAll(selector)) {
      hiddenCopies.push(normalize(el.outerHTML));
      el.remove();
    }
  }
  const visibleRows = rows.filter((id) => isPresent(surface, id));
  const sidebar = document.querySelector<HTMLElement>(".ws-sidebar");
  frozen(`${name}-surface`, {
    name,
    rows: visibleRows,
    inputs,
    root,
    markup: normalize(surface.innerHTML),
    hiddenCopies,
    layoutInputs: sidebar
      ? {
          attributes: attrs(sidebar),
          cssWidth: getComputedStyle(sidebar).width,
          inlineStyle: sidebar.getAttribute("style"),
          computedWidthIsNotLayout: true,
        }
      : null,
  });
  return { name, rows: visibleRows, inputs, file: `__goldens__/${name}.json` };
}
