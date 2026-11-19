import { listProviderApiCatalog } from "@agent-native/core/provider-api";
import { describe, expect, it } from "vitest";

import { PROVIDER_VAULT_KEYS } from "../lib/factory-workflow-connections.js";
import { genericOperations } from "../workflow/catalog/generic.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import { isDeniedHeader } from "../workflow/free-form-request.js";
import {
  createOperationRegistry,
  isModelToolAllowed,
  type OperationDefinition,
  type OperationDefinitionInput,
} from "../workflow/operations.js";
import { buildProviderRequest } from "./provider-request.js";

const PROVIDERS = [
  "slack",
  "github",
  "hubspot",
  "gong",
  "pylon",
  "stripe",
  "posthog",
  "bigquery",
  "jira",
  "notion",
  "sentry",
];

/** What core says about a provider: one entry, or the test fails. */
function coreProvider(provider: string) {
  const [entry] = listProviderApiCatalog(provider);
  if (!entry) throw new Error(`core has no provider ${provider}`);
  return entry;
}

const [generated] = genericOperations;
if (!generated) throw new Error("There are no generated API requests.");

function apiRequest(provider: string): OperationDefinition {
  const def = OPERATION_CATALOG.get(`${provider}.apiRequest`);
  if (!def) throw new Error(`${provider}.apiRequest is not in the catalog`);
  return def;
}

describe("the generated API request operations", () => {
  it("exist for exactly the providers Factory can reach and check", () => {
    expect(
      OPERATION_CATALOG.list()
        .filter((def) => def.id.endsWith(".apiRequest"))
        .map((def) => def.provider)
        .sort(),
    ).toEqual([...PROVIDERS].sort());
    // Slack, GitHub and Sentry are checked through the connectors; the rest by their vault keys.
    expect(
      [...Object.keys(PROVIDER_VAULT_KEYS), "slack", "github", "sentry"].sort(),
    ).toEqual([...PROVIDERS].sort());
  });

  it("each have a provider API in core, which is where credentials and the host come from", () => {
    for (const provider of PROVIDERS) {
      expect(coreProvider(provider).id, provider).toBe(provider);
    }
  });

  it("are read-only GET lookups with one shape, so they cannot drift", () => {
    for (const provider of PROVIDERS) {
      const def = apiRequest(provider);
      expect(def, provider).toMatchObject({
        id: `${provider}.apiRequest`,
        provider,
        label: "API request",
        nodeKinds: ["lookup"],
        effect: "read",
        credential: { provider },
        implementation: {
          type: "provider-request",
          method: "GET",
          pathTemplate: "/{path}",
        },
      });
      expect(def.outputs, provider).toBeUndefined();
      expect(def.receipt, provider).toBeUndefined();
      expect(def.itemMapping, provider).toBeUndefined();
      // Everything but the id, the provider and the connection placeholders is the same.
      const strip = (candidate: OperationDefinitionInput) => {
        const {
          id: _id,
          provider: _provider,
          credential: _c,
          ...rest
        } = candidate;
        const implementation = candidate.implementation as {
          freeForm?: Record<string, unknown>;
        };
        const { placeholders: _p, ...freeForm } = implementation.freeForm ?? {};
        return {
          ...rest,
          fields: rest.fields.map(({ description: _d, ...field }) => field),
          description: undefined,
          implementation: { ...implementation, freeForm },
        };
      };
      expect(strip(def as OperationDefinitionInput), provider).toEqual(
        strip(generated),
      );
    }
  });

  it("declare the contract the editor and the agent build on", () => {
    const fields = apiRequest("github").fields.map((field) => ({
      name: field.name,
      type: field.type,
      required: field.required ?? false,
      ...(field.enum ? { enum: field.enum } : {}),
      ...(field.default === undefined ? {} : { default: field.default }),
    }));
    expect(fields).toEqual([
      { name: "path", type: "string", required: true },
      { name: "query", type: "json", required: false },
      { name: "headers", type: "json", required: false },
      {
        name: "authentication",
        type: "enum",
        required: false,
        enum: ["provider", "none"],
        default: "provider",
      },
      { name: "timeoutSeconds", type: "number", required: false },
      { name: "pagination", type: "json", required: false },
      {
        name: "includeStatus",
        type: "boolean",
        required: false,
        default: false,
      },
      { name: "fieldsToKeep", type: "json", required: false },
    ]);
    expect(
      fields.every(
        (field) => field.name === "path" || field.required === false,
      ),
    ).toBe(true);
  });

  it("tell an agent what the step is for, where its limits are and how to find a path", () => {
    const { description } = apiRequest("slack");
    expect(description).toContain("no other step covers");
    expect(description).toContain("provider-api-docs");
    expect(description).toContain("provider-api-catalog");
    expect(description).toContain("only reads");
    expect(description).toContain("truncated: true");
    expect(description).toContain("AI tool");
  });

  it("are never offered to a model as a tool, unlike a curated read", () => {
    for (const provider of PROVIDERS) {
      expect(isModelToolAllowed(apiRequest(provider)), provider).toBe(false);
    }
    expect(isModelToolAllowed(OPERATION_CATALOG.get("github.readFile")!)).toBe(
      true,
    );
    expect(
      isModelToolAllowed(OPERATION_CATALOG.get("slack.postMessage")!),
    ).toBe(false);
  });

  describe("on each provider's own base URL", () => {
    // core keeps a base path such as /api/0 in front of the typed path
    const join = (base: string, path: string) => {
      const url = new URL(base);
      return new URL(`${url.pathname.replace(/\/+$/, "")}${path}`, url.origin);
    };

    it.each(PROVIDERS)(
      "%s joins the path below its base and stays on its host",
      (provider) => {
        const base = coreProvider(provider).defaultBaseUrl;
        const built = buildProviderRequest(apiRequest(provider), {
          fields: { path: "things/42/items", query: { limit: 5 } },
        });
        expect(built.path).toBe("/things/42/items");
        const url = join(base, built.path);
        expect(url.origin).toBe(new URL(base).origin);
        expect(url.pathname).toBe(
          `${new URL(base).pathname.replace(/\/+$/, "")}/things/42/items`,
        );
      },
    );

    it("keep a typed prefix such as v1 as typed and leave the join to core", () => {
      const stripe = buildProviderRequest(apiRequest("stripe"), {
        fields: { path: "v1/customers" },
      });
      expect(stripe.path).toBe("/v1/customers");
    });
  });

  describe("against what core says about each provider", () => {
    it("knows the connection placeholders core fills, and no others", () => {
      for (const provider of PROVIDERS) {
        const core = coreProvider(provider)
          .placeholders.map((placeholder) => placeholder.name)
          .sort();
        const implementation = apiRequest(provider).implementation;
        const ours =
          implementation.type === "provider-request"
            ? [...(implementation.freeForm?.placeholders ?? [])].sort()
            : [];
        expect(ours, provider).toEqual(core);
      }
    });

    it("signs none of them with a header the header deny-list would miss", () => {
      for (const provider of PROVIDERS) {
        const { auth } = coreProvider(provider);
        const named = [
          ...auth.matchAll(/api-key-header:([A-Za-z0-9-]+)/g),
        ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
        for (const header of named) {
          expect(isDeniedHeader(header), `${provider} ${header}`).toBe(true);
        }
      }
    });

    it("are all signed by Authorization, which the deny-list always covers", () => {
      expect(isDeniedHeader("Authorization")).toBe(true);
      for (const provider of PROVIDERS) {
        const { auth } = coreProvider(provider);
        expect(auth, provider).not.toMatch(/api-key-header/);
      }
    });
  });
});

describe("what an operation may declare as free-form", () => {
  const base = generated;
  const withImplementation = (
    change: Record<string, unknown>,
  ): OperationDefinitionInput => ({
    ...base,
    implementation: { ...(base.implementation as object), ...change } as never,
  });
  const register = (definition: OperationDefinitionInput) =>
    createOperationRegistry().register(definition);

  it("accepts the generated shape", () => {
    expect(() => register(base)).not.toThrow();
  });

  it("is a GET read and nothing else", () => {
    expect(() => register(withImplementation({ method: "POST" }))).toThrow(
      /GET read/,
    );
    expect(() => register({ ...base, effect: "write" })).toThrow();
    expect(() =>
      register(withImplementation({ bodyTemplate: { a: 1 } })),
    ).toThrow(/no fixed query or body/);
    expect(() => register(withImplementation({ query: { a: "1" } }))).toThrow(
      /no fixed query or body/,
    );
  });

  it("serves only lookup nodes, and a path that is exactly the typed field", () => {
    expect(() =>
      register({ ...base, nodeKinds: ["lookup", "action"] }),
    ).toThrow();
    expect(() =>
      register(withImplementation({ pathTemplate: "/repos/{path}" })),
    ).toThrow(/exactly/);
  });

  it("names declared fields of the right type, each used once", () => {
    const freeForm = (base.implementation as { freeForm: object }).freeForm;
    expect(() =>
      register(
        withImplementation({ freeForm: { ...freeForm, query: "nope" } }),
      ),
    ).toThrow(/declared as a json field/);
    expect(() =>
      register(
        withImplementation({ freeForm: { ...freeForm, headers: "query" } }),
      ),
    ).toThrow(/of its own/);
    expect(() =>
      register(
        withImplementation({
          freeForm: { ...freeForm, timeoutSeconds: "pagination" },
        }),
      ),
    ).toThrow(/declared as a number field/);
    expect(() =>
      register(
        withImplementation({ freeForm: { ...freeForm, fieldsToKeep: "path" } }),
      ),
    ).toThrow(/declared as a json field/);
    expect(() =>
      register(
        withImplementation({
          freeForm: { ...freeForm, fieldsToKeep: "pagination" },
        }),
      ),
    ).toThrow(/of its own/);
  });

  it("needs the path to be required and the sign-in to be provider or none", () => {
    expect(() =>
      register({
        ...base,
        fields: base.fields.map((field) =>
          field.name === "path" ? { ...field, required: false } : field,
        ),
      }),
    ).toThrow(/required/);
    expect(() =>
      register({
        ...base,
        fields: base.fields.map((field) =>
          field.name === "authentication"
            ? { ...field, enum: ["provider", "none", "basic"] }
            : field,
        ),
      }),
    ).toThrow(/the sign-in field/);
  });
});
