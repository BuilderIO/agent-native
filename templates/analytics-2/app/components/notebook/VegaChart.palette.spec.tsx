// @vitest-environment jsdom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

import { VegaChart } from "./VegaChart";

vi.mock("./utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./utils")>();
  return {
    ...actual,
    formatCellValue: (value: unknown) => (value == null ? "" : String(value)),
  };
});

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  if (!("getBBox" in SVGElement.prototype)) {
    Object.defineProperty(SVGElement.prototype, "getBBox", {
      configurable: true,
      value() {
        return { x: 0, y: 0, width: 40, height: 12 };
      },
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("VegaChart resolvePalette layout batching", () => {
  it("batches style.color writes before getComputedStyle reads without interleaving", async () => {
    const events: Array<"write" | "read"> = [];
    const originalGetComputedStyle = window.getComputedStyle.bind(window);
    const trackedProbes = new WeakSet<Element>();
    const originalCreateElement = document.createElement.bind(document);

    vi.spyOn(document, "createElement").mockImplementation(((
      tagName: string,
      options?: ElementCreationOptions,
    ) => {
      const el = originalCreateElement(tagName, options);
      if (tagName.toLowerCase() === "span") {
        trackedProbes.add(el);
        const style = el.style;
        const originalSetProperty = style.setProperty.bind(style);
        style.setProperty = (
          property: string,
          value: string | null,
          priority?: string,
        ) => {
          if (property === "color") events.push("write");
          return originalSetProperty(property, value, priority);
        };
        const protoDesc =
          Object.getOwnPropertyDescriptor(style, "color") ??
          Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(style),
            "color",
          );
        const origGet = protoDesc?.get;
        const origSet = protoDesc?.set;
        if (origGet && origSet) {
          Object.defineProperty(style, "color", {
            configurable: true,
            get() {
              return origGet.call(this);
            },
            set(value: string) {
              events.push("write");
              origSet.call(this, value);
            },
          });
        }
      }
      return el;
    }) as typeof document.createElement);

    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (el: Element, pseudo?: string | null) => {
        if (trackedProbes.has(el)) events.push("read");
        return originalGetComputedStyle(el, pseudo);
      },
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <AgentNativeI18nProvider
            catalog={{ messages: enUS }}
            persistPreference={false}
          >
            <VegaChart
              columns={["month", "A", "B", "C", "D", "E"]}
              rows={[
                ["Jan", 10, 20, 30, 40, 50],
                ["Feb", 15, 25, 35, 45, 55],
              ]}
              mark="bar"
              colors={["#e11d48", "#2563eb", "#10b981", "#f59e0b", "#8b5cf6"]}
            />
          </AgentNativeI18nProvider>,
        );
      });

      const writeCount = events.filter((e) => e === "write").length;
      const readCount = events.filter((e) => e === "read").length;
      expect(writeCount).toBeGreaterThanOrEqual(5);
      expect(readCount).toBeGreaterThanOrEqual(5);

      let writeAfterRead = 0;
      for (let i = 1; i < events.length; i += 1) {
        if (events[i - 1] === "read" && events[i] === "write") {
          writeAfterRead += 1;
        }
      }
      expect(writeAfterRead).toBeLessThanOrEqual(1);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
