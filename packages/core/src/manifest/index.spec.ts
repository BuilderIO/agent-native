import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  defineAppManifest,
  deriveAppManifest,
  resolveScreenPath,
  appCapabilityManifestSchema,
} from "./index.js";

describe("app capability manifest", () => {
  const fallback = deriveAppManifest(
    { id: "tasks", name: "Tasks", homePath: "/tasks" },
    ["list-tasks", "find_task"],
  );

  it("derives a landing screen and canonical intents", () => {
    expect(appCapabilityManifestSchema.parse(fallback)).toMatchObject({
      id: "tasks",
      routing: { canonicalIntents: ["find task", "list tasks"] },
      screens: {
        defaultLandingScreen: "home",
        definitions: { home: { show: { route: "/tasks" } } },
      },
    });
  });

  it("publishes parameter schemas and validates screen references and UTF-8 guide size", () => {
    const manifest = defineAppManifest({
      ...fallback,
      guide: "é".repeat(200),
      screens: {
        defaultLandingScreen: "home",
        definitions: {
          ...fallback.screens.definitions,
          task: {
            show: { route: "/tasks/:id", params: z.object({ id: z.string() }) },
          },
        },
      },
      entities: { task: { show: "task" } },
    });
    expect(resolveScreenPath(manifest, "task", { id: "group/one" })).toBe(
      "/tasks/group%2Fone",
    );
    expect(() => resolveScreenPath(manifest, "task", { id: ".." })).toThrow();
    expect(() => resolveScreenPath(manifest, "task")).toThrow();
    expect(() => resolveScreenPath(manifest, "missing")).toThrow();
    expect(manifest.screens.definitions.task.show.params).toMatchObject({
      properties: { id: { type: "string" } },
      required: ["id"],
    });
    expect(() =>
      defineAppManifest({ ...manifest, guide: manifest.guide + "a" }),
    ).toThrow();
    expect(() =>
      defineAppManifest({
        ...manifest,
        entities: { task: { show: "unknown" } },
      }),
    ).toThrow();
  });
});
