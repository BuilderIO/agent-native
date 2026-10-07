import addFormats from "ajv-formats";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  buildActionMcpOutputContract,
  deriveMcpResponseOutputSchema,
  describeOutputContractIssue,
} from "./action-output-contract.js";

function accepts(schema: Record<string, unknown>, value: unknown): boolean {
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  return ajv.compile(schema)(value) === true;
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
    expect(
      (response.properties as Record<string, unknown>)._agentImages,
    ).toBeUndefined();
    expect(accepts(response, { url: "https://x.test/a" })).toBe(true);
    // The transport deletes an embed start URL and fills url from the open
    // link, so a url is neither required nor held to its own format.
    expect(accepts(response, {})).toBe(true);
    expect(accepts(response, { url: "/rows/1" })).toBe(true);
  });

  it("drops embed credentials at any depth and accepts what redaction leaves", () => {
    const { response } = buildActionMcpOutputContract(
      z.object({
        id: z.string(),
        embedTicket: z.string(),
        session: z.object({ ticket: z.string(), count: z.number() }),
        panes: z.array(
          z.object({ label: z.string(), embedTicket: z.string() }),
        ),
      }),
      { openLink: false },
    );
    expect(
      accepts(response, {
        id: "s1",
        session: { count: 1 },
        panes: [{ label: "Main" }],
      }),
    ).toBe(true);
    expect(accepts(response, { id: "s1", session: { count: "1" } })).toBe(
      false,
    );
  });

  it("accepts the hidden-URL marker where a constrained string item held an embed URL", () => {
    const { response } = buildActionMcpOutputContract(
      z.object({ links: z.array(z.url()) }),
      { openLink: false },
    );
    expect(
      accepts(response, {
        links: ["[hidden embed URL]", "https://example.com"],
      }),
    ).toBe(true);
    expect(accepts(response, { links: ["not a url"] })).toBe(false);
  });

  it("keeps required fields that redaction can never remove", () => {
    const { response } = buildActionMcpOutputContract(
      z.object({
        status: z.enum(["ok", "degraded"]),
        count: z.number(),
        nested: z.object({ flag: z.boolean() }),
      }),
      { openLink: false },
    );
    expect(response.required).toEqual(["status", "count", "nested"]);
  });

  it.each([
    ["an async schema", { type: "object", $async: true }, /"\$async"/],
    [
      "a negated schema",
      { type: "object", properties: { a: { not: { type: "null" } } } },
      /"not"/,
    ],
    [
      "an unsupported format",
      {
        type: "object",
        properties: { a: { type: "string", format: "made-up" } },
      },
      /format "made-up"/,
    ],
    [
      "unique strings redaction can collapse",
      {
        type: "object",
        properties: {
          a: { type: "array", items: { type: "string" }, uniqueItems: true },
        },
      },
      /uniqueItems/,
    ],
    [
      "a self-referencing root",
      { type: "object", properties: { a: { $ref: "#" } } },
      /refers to itself/,
    ],
  ])("refuses %s", (_label, semantic, message) => {
    expect(() =>
      deriveMcpResponseOutputSchema(semantic, { openLink: false }),
    ).toThrow(message);
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
  const schema = {
    type: "object",
    properties: {
      rows: {
        type: "array",
        items: { $ref: "#/$defs/Row" },
      },
      byOwner: {
        type: "object",
        additionalProperties: { type: "number" },
      },
      pair: {
        type: "array",
        prefixItems: [{ type: "string" }, { $ref: "#/$defs/Row" }],
      },
    },
    $defs: {
      Row: {
        anyOf: [
          { type: "object", properties: { owner: { type: "string" } } },
          { type: "object", properties: { team: { type: "string" } } },
        ],
      },
    },
  };

  it("keeps array indexes and declared names, resolving refs and unions", () => {
    expect(
      describeOutputContractIssue(["rows", 3, "owner"], "invalid_type", schema),
    ).toBe("rows.3.owner: invalid_type");
    expect(
      describeOutputContractIssue(["pair", "1", "team"], "type", schema),
    ).toBe("pair.1.team: type");
  });

  it("masks record keys however they are spelled", () => {
    for (const key of ["dave@example.com", "42", 42]) {
      expect(
        describeOutputContractIssue(["byOwner", key], "invalid_type", schema),
      ).toBe("byOwner.*: invalid_type");
    }
    expect(
      describeOutputContractIssue(["rows", "dave", "owner"], "type", schema),
    ).toBe("rows.*.*: type");
  });

  it("masks every segment without a schema and every unknown code", () => {
    expect(
      describeOutputContractIssue(["rows", 0], "invalid_type", undefined),
    ).toBe("*.*: invalid_type");
    expect(
      describeOutputContractIssue(
        [],
        "Value dave@example.com is wrong",
        schema,
      ),
    ).toBe("(root): invalid");
    expect(describeOutputContractIssue([], "dave_example", schema)).toBe(
      "(root): invalid",
    );
  });
});
