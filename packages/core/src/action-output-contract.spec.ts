import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  buildActionMcpOutputContract,
  deriveMcpResponseOutputSchema,
  describeOutputContractIssue,
} from "./action-output-contract.js";

function accepts(schema: Record<string, unknown>, value: unknown): boolean {
  return new Ajv2020({ strict: false, validateFormats: false }).compile(schema)(
    value,
  ) as boolean;
}

describe("deriveMcpResponseOutputSchema", () => {
  it("wraps an array root as { items } and keeps its definitions reachable", () => {
    const node = z.object({ id: z.string() });
    const { semantic, response } = buildActionMcpOutputContract(
      z.array(z.object({ first: node, second: node })),
      { openLink: false },
    );
    expect(semantic.type).toBe("array");
    expect(response).toMatchObject({
      type: "object",
      required: ["items"],
      additionalProperties: false,
    });
    expect(
      accepts(response, {
        items: [{ first: { id: "a" }, second: { id: "b" } }],
      }),
    ).toBe(true);
    expect(
      accepts(response, [{ first: { id: "a" }, second: { id: "b" } }]),
    ).toBe(false);
    expect(accepts(response, { items: [{ first: { id: 1 } }] })).toBe(false);
  });

  it("adds the open-link fields to every branch of an object-only union", () => {
    const { response } = buildActionMcpOutputContract(
      z.union([
        z.object({ kind: z.literal("a"), a: z.string() }),
        z.object({ kind: z.literal("b"), b: z.number() }),
      ]),
      { openLink: true },
    );
    expect(response.type).toBe("object");
    const openLink = {
      label: "Open",
      webUrl: "https://app.example.test/a",
      desktopUrl: "https://app.example.test/a",
      vscodeUrl: "vscode://example",
    };
    expect(
      accepts(response, {
        kind: "a",
        a: "x",
        openLink,
        url: openLink.webUrl,
      }),
    ).toBe(true);
    expect(accepts(response, { kind: "b", b: 1, openLink })).toBe(true);
    expect(accepts(response, { kind: "b", b: "1" })).toBe(false);
  });

  it("does not advertise open-link fields an action never produces", () => {
    const { response } = buildActionMcpOutputContract(
      z.object({ id: z.string() }),
      { openLink: false },
    );
    expect(accepts(response, { id: "a", url: "https://x.test" })).toBe(false);
  });

  it("keeps an action's own url field and drops the lifted image field", () => {
    const response = deriveMcpResponseOutputSchema(
      {
        type: "object",
        properties: {
          url: { type: "string", format: "uri" },
          _agentImages: { type: "array" },
        },
        required: ["url", "_agentImages"],
        additionalProperties: false,
      },
      { openLink: true },
    );
    expect(response.required).toEqual(["url"]);
    expect(
      (response.properties as Record<string, unknown>)._agentImages,
    ).toBeUndefined();
    expect((response.properties as Record<string, unknown>).url).toEqual({
      type: "string",
      format: "uri",
    });
  });

  it("refuses roots structuredContent cannot carry", () => {
    expect(() =>
      deriveMcpResponseOutputSchema({ type: "string" }, { openLink: false }),
    ).toThrow(TypeError);
    expect(() =>
      deriveMcpResponseOutputSchema(
        { anyOf: [{ type: "object" }, { type: "null" }] },
        { openLink: false },
      ),
    ).toThrow(TypeError);
  });
});

describe("describeOutputContractIssue", () => {
  it("keeps declared names and indexes but masks data-bearing keys and codes", () => {
    expect(
      describeOutputContractIssue(
        ["rows", 3, "dave@example.com", "owner"],
        "invalid_type",
        new Set(["rows", "owner"]),
      ),
    ).toBe("rows.3.*.owner: invalid_type");
    expect(
      describeOutputContractIssue(
        [],
        "Value dave@example.com is wrong",
        new Set(),
      ),
    ).toBe("(root): invalid");
  });
});
