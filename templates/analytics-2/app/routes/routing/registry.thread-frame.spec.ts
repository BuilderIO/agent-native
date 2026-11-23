import { describe, expect, it } from "vitest";

import { resolveRoutePage } from "@/components/workspace/pages";

import { resolveRoute } from "./registry";

describe("thread routes keep the workspace shell", () => {
  it.each(["/thread", "/thread/thr_123"])(
    "%s resolves to the home frame and its thread page",
    (path) => {
      const route = resolveRoute(path);
      expect(route).toMatchObject({ frame: "home", view: "thread" });
      expect(resolveRoutePage(route)).toBeDefined();
    },
  );
});
