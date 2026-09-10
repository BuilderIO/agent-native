import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { createPrototypePlanContent } from "../server/plan-content";
import createPrototypePlan from "./create-prototype-plan";

const schema = createPrototypePlan.schema as z.ZodType;

describe("create-prototype-plan screen contract", () => {
  it("accepts and preserves scoped design CSS and persisted design mode", () => {
    const parsed = schema.parse({
      brief: "Review the polished interaction.",
      screens: [
        {
          title: "Inbox",
          renderMode: "design",
          html: '<main class="inbox">Inbox</main>',
          css: ".inbox { color: #123456; box-shadow: 0 8px 24px #0003; }",
        },
      ],
    }) as {
      screens: Array<{ renderMode?: string; html?: string; css?: string }>;
    };

    expect(parsed.screens[0]).toMatchObject({
      renderMode: "design",
      html: '<main class="inbox">Inbox</main>',
      css: ".inbox { color: #123456; box-shadow: 0 8px 24px #0003; }",
    });
  });

  it("rejects embedded style tags instead of silently dropping the design", () => {
    expect(() =>
      schema.parse({
        brief: "Review the polished interaction.",
        screens: [
          {
            title: "Inbox",
            html: "<style>.inbox { color: red; }</style><main>Inbox</main>",
          },
        ],
      }),
    ).toThrow(/put scoped styles in the css field/i);
  });

  it("carries design CSS and render mode into prototype and canvas surfaces", () => {
    const content = createPrototypePlanContent({
      title: "Polished inbox",
      brief: "Review the branded interaction.",
      source: "manual",
      screens: [
        {
          id: "inbox",
          title: "Inbox",
          surface: "browser",
          renderMode: "design",
          html: '<main class="inbox">Inbox</main>',
          css: ".inbox { color: #123456; box-shadow: 0 8px 24px #0003; }",
        },
      ],
      transitions: [],
    });

    expect(content.prototype?.screens[0]).toMatchObject({
      renderMode: "design",
      css: ".inbox { color: #123456; box-shadow: 0 8px 24px #0003; }",
    });
    expect(content.canvas?.frames[0]?.wireframe).toMatchObject({
      renderMode: "design",
      css: ".inbox { color: #123456; box-shadow: 0 8px 24px #0003; }",
    });
  });
});
