import { describe, expect, it } from "vitest";

import { createLatestGetters, createLatestInvokers } from "./editor-ctx";

describe("editor ctx latest accessors", () => {
  it("reads the value from the current render, not the one at creation", () => {
    const latest = { current: { activeFileId: "a", zoom: 100 } };
    const get = createLatestGetters(latest);

    expect(get.activeFileId()).toBe("a");

    latest.current = { activeFileId: "b", zoom: 42 };

    expect(get.activeFileId()).toBe("b");
    expect(get.zoom()).toBe(42);
  });

  it("keeps getter identity stable across renders", () => {
    const latest = { current: { zoom: 1 } };
    const get = createLatestGetters(latest);
    const before = get.zoom;

    latest.current = { zoom: 2 };

    expect(get.zoom).toBe(before);
  });

  it("forwards invocations to the current function and returns its result", () => {
    const calls: string[] = [];
    const latest = {
      current: {
        save: (label: string) => {
          calls.push(`first:${label}`);
          return 1;
        },
      },
    };
    const services = createLatestInvokers(latest);

    expect(services.save("x")).toBe(1);

    latest.current = {
      save: (label: string) => {
        calls.push(`second:${label}`);
        return 2;
      },
    };

    expect(services.save("y")).toBe(2);
    expect(calls).toEqual(["first:x", "second:y"]);
  });

  it("keeps invoker identity stable so dep arrays do not churn", () => {
    const latest = { current: { save: () => undefined } };
    const services = createLatestInvokers(latest);
    const before = services.save;

    latest.current = { save: () => undefined };

    expect(services.save).toBe(before);
  });
});
