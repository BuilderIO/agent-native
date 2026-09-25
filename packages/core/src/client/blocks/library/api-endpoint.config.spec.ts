import type { BlockAttrReader } from "@agent-native/core/blocks/server";
import { describe, expect, it } from "vitest";

import {
  apiEndpointSchema,
  apiEndpointMdx,
  type ApiEndpointData,
} from "./api-endpoint.config.js";

/**
 * Build a {@link BlockAttrReader} over a flat attribute bag — the resolved shape
 * the registry's real `createAttrReader` produces after MDX estree/JSON parsing.
 * Lets the round-trip test exercise `toAttrs` → `fromAttrs` without standing up
 * the whole MDX pipeline (the server registry specs cover the full path).
 */
function reader(attrs: Record<string, unknown>): BlockAttrReader {
  const read = (name: string) => attrs[name];
  return {
    raw: read,
    string: (name) => {
      const value = read(name);
      return typeof value === "string" ? value : undefined;
    },
    number: (name) => {
      const value = read(name);
      return typeof value === "number" ? value : undefined;
    },
    bool: (name) => {
      const value = read(name);
      return typeof value === "boolean" ? value : undefined;
    },
    array: <T = unknown>(name: string) => {
      const value = read(name);
      return Array.isArray(value) ? (value as T[]) : undefined;
    },
    object: <T = unknown>(name: string) => {
      const value = read(name);
      return value && typeof value === "object" ? (value as T) : undefined;
    },
  };
}

/** Drop keys whose value is `undefined`, mirroring the `prop()` encoder. */
function compactAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attrs).filter(([, value]) => value !== undefined),
  );
}

const fullEndpoint: ApiEndpointData = {
  method: "POST",
  path: "/api/v1/widgets/{id}",
  summary: "Create a widget",
  description: "Creates a new **widget** and returns the created record.",
  auth: "Bearer token",
  deprecated: false,
  params: [
    {
      name: "id",
      in: "path",
      type: "string",
      required: true,
      description: "Parent widget id",
    },
    { name: "expand", in: "query", type: "string" },
  ],
  request: {
    contentType: "application/json",
    example: '{ "name": "Sprocket" }',
  },
  responses: [
    {
      status: "201",
      description: "Created",
      example: '{ "id": "wgt_1", "name": "Sprocket" }',
    },
    { status: "422", description: "Validation error" },
  ],
};

describe("api-endpoint block — schema", () => {
  it("accepts a full endpoint", () => {
    expect(apiEndpointSchema.parse(fullEndpoint)).toEqual(fullEndpoint);
  });

  it("accepts the minimal empty() shape", () => {
    const minimal = { method: "GET", path: "/api/resource" };
    expect(apiEndpointSchema.parse(minimal)).toEqual(minimal);
  });

  it("rejects an unknown HTTP method", () => {
    expect(() =>
      apiEndpointSchema.parse({ method: "FETCH", path: "/x" }),
    ).toThrow();
  });

  it("rejects an empty path", () => {
    expect(() =>
      apiEndpointSchema.parse({ method: "GET", path: "" }),
    ).toThrow();
  });

  it("rejects a param with an invalid `in` location", () => {
    expect(() =>
      apiEndpointSchema.parse({
        method: "GET",
        path: "/x",
        params: [{ name: "q", in: "cookie" }],
      }),
    ).toThrow();
  });

  it("rejects a response missing a status", () => {
    expect(() =>
      apiEndpointSchema.parse({
        method: "GET",
        path: "/x",
        responses: [{ description: "no status" }],
      }),
    ).toThrow();
  });
});

describe("api-endpoint block — mdx round-trip", () => {
  it("uses the stable `Endpoint` tag and `description` children field", () => {
    expect(apiEndpointMdx.tag).toBe("Endpoint");
    expect(apiEndpointMdx.childrenField).toBe("description");
  });

  it("emits attributes in a stable order and omits the description", () => {
    const attrs = apiEndpointMdx.toAttrs(fullEndpoint);
    expect(Object.keys(attrs)).toEqual([
      "method",
      "path",
      "summary",
      "auth",
      "deprecated",
      "change",
      "params",
      "request",
      "responses",
    ]);
    // `description` is the children field, never an attribute.
    expect(attrs).not.toHaveProperty("description");
  });

  it("round-trips toAttrs → fromAttrs through the reader adapter", () => {
    const attrs = compactAttrs(apiEndpointMdx.toAttrs(fullEndpoint));
    const back = apiEndpointMdx.fromAttrs(
      reader(attrs),
      // `description` arrives as prose children, not an attribute.
      fullEndpoint.description ?? "",
    );
    const validated = apiEndpointSchema.parse(back);
    expect(validated).toEqual(fullEndpoint);
  });

  it("defaults gracefully when attributes are missing", () => {
    const back = apiEndpointMdx.fromAttrs(reader({}), "");
    expect(back.method).toBe("GET");
    expect(back.path).toBe("");
    expect(back.description).toBeUndefined();
    expect(back.params).toBeUndefined();
    expect(back.responses).toBeUndefined();
    expect(back.request).toBeUndefined();
  });

  it("coerces an unknown serialized method back to GET", () => {
    const back = apiEndpointMdx.fromAttrs(
      reader({ method: "FETCH", path: "/x" }),
      "",
    );
    expect(back.method).toBe("GET");
  });

  it("keeps the prose body as the description on round-trip", () => {
    const attrs = compactAttrs(
      apiEndpointMdx.toAttrs({ method: "GET", path: "/ping" }),
    );
    const back = apiEndpointMdx.fromAttrs(
      reader(attrs),
      "Health check endpoint.",
    );
    expect(back.description).toBe("Health check endpoint.");
  });

  it("round-trips diff state at all three levels (route, param, response)", () => {
    const diffEndpoint: ApiEndpointData = {
      method: "POST",
      path: "/api/v2/widgets",
      // Root: the whole route is new.
      change: "added",
      params: [
        // Modified param carrying its prior value via `was`.
        {
          name: "kind",
          in: "query",
          type: "string",
          required: true,
          change: "modified",
          was: "optional",
        },
        { name: "color", in: "query", type: "string", change: "added" },
      ],
      responses: [
        { status: "201", description: "Created", change: "added" },
        // A newly-added conflict response.
        { status: "409", description: "Conflict", change: "added" },
      ],
    };
    const attrs = compactAttrs(apiEndpointMdx.toAttrs(diffEndpoint));
    const back = apiEndpointMdx.fromAttrs(reader(attrs), "");
    const validated = apiEndpointSchema.parse(back);
    expect(validated).toEqual(diffEndpoint);
    // Spot-check each level survived.
    expect(validated.change).toBe("added");
    expect(validated.params?.[0]).toMatchObject({
      change: "modified",
      was: "optional",
    });
    expect(validated.responses?.[1]).toMatchObject({
      status: "409",
      change: "added",
    });
  });

  it("drops an unknown root change value on decode", () => {
    const back = apiEndpointMdx.fromAttrs(
      reader({ method: "GET", path: "/x", change: "bogus" }),
      "",
    );
    expect(back.change).toBeUndefined();
  });
});
