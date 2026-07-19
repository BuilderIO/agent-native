import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  buildProviderApiAuditSummary,
  sanitizeProviderApiAuditPath,
} from "./provider-api-audit.js";
import {
  createProviderApiActions,
  createProviderApiCatalogAction,
  createProviderApiCatalogSchema,
  createProviderApiDocsAction,
  createProviderApiDocsSchema,
  createProviderApiRequestAction,
  createProviderApiRequestSchema,
} from "./provider-api.js";

describe("provider API action factories", () => {
  it("defaults request providers to open strings and preserves passed provider schemas", () => {
    const defaultSchema = createProviderApiRequestSchema();
    expect(
      defaultSchema.safeParse({ provider: "custom-crm", path: "/v1" }).success,
    ).toBe(true);

    const restrictedSchema = createProviderApiRequestSchema(
      z.enum(["github", "slack"]),
    );
    expect(
      restrictedSchema.safeParse({ provider: "github", path: "/v1" }).success,
    ).toBe(true);
    expect(
      restrictedSchema.safeParse({ provider: "custom-crm", path: "/v1" })
        .success,
    ).toBe(false);
  });

  it("delegates request, catalog, and docs actions to an injected runtime", async () => {
    const runtime = {
      executeRequest: vi.fn(async (args) => ({ args })),
      listCatalog: vi.fn(async (provider?: string) => [
        { id: provider ?? "all" },
      ]),
      fetchDocs: vi.fn(async (args) => ({ args })),
    };
    const actions = createProviderApiActions(runtime);

    await expect(
      actions.request.run({ provider: "github", path: "/repos" }),
    ).resolves.toMatchObject({ args: { provider: "github", path: "/repos" } });
    await expect(actions.catalog.run({ provider: "github" })).resolves.toEqual({
      providers: [{ id: "github" }],
      guidance: expect.any(String),
    });
    await expect(actions.docs.run({ provider: "github" })).resolves.toEqual({
      args: { provider: "github" },
    });
    expect(actions.register).toBeUndefined();
  });

  it("keeps custom provider registration opt-in", () => {
    const runtime = {
      executeRequest: vi.fn(),
      listCatalog: vi.fn(),
      fetchDocs: vi.fn(),
    };
    const actions = createProviderApiActions(runtime, {
      customProviderRegistration: true,
      registration: {
        getContext: () => ({ userEmail: "ada@example.com", orgId: null }),
      },
    });
    expect(actions.register).toBeDefined();
    expect(actions.register?.http).toBe(false);
  });

  it("retains caller-provided schemas and action metadata", () => {
    const requestSchema = createProviderApiRequestSchema(z.enum(["github"]));
    const request = createProviderApiRequestAction(
      { executeRequest: vi.fn() },
      {
        schema: requestSchema,
        description: "app request",
        http: { method: "POST" },
        toolCallable: false,
        needsApproval: ({ provider }) => provider === "github",
      },
    );
    const catalog = createProviderApiCatalogAction(
      { listCatalog: vi.fn() },
      { schema: createProviderApiCatalogSchema(z.enum(["github"])) },
    );
    const docs = createProviderApiDocsAction(
      { fetchDocs: vi.fn() },
      { schema: createProviderApiDocsSchema(z.enum(["github"])) },
    );

    expect(request.tool.description).toBe("app request");
    expect(request.http).toEqual({ method: "POST" });
    expect(request.toolCallable).toBe(false);
    expect(request.needsApproval).toBeTypeOf("function");
    expect(request.audit?.recordInputs).toBe(false);
    expect(catalog.readOnly).toBe(true);
    expect(docs.readOnly).toBe(true);
  });

  it("types approval predicates from the caller's request schema output", () => {
    const requestSchema = z.object({
      provider: z.literal("figma"),
      method: z.enum(["GET", "POST"]).default("GET"),
      path: z.string().min(1),
      approvalScope: z.literal("design"),
    });
    const requiresDesignApproval = (args: z.output<typeof requestSchema>) =>
      args.approvalScope === "design" && args.method === "POST";
    const request = createProviderApiRequestAction(
      { executeRequest: vi.fn() },
      { schema: requestSchema, needsApproval: requiresDesignApproval },
    );

    expect(typeof request.needsApproval).toBe("function");
    if (typeof request.needsApproval === "function") {
      expect(
        request.needsApproval({
          provider: "figma",
          method: "POST",
          path: "/v1/files/example",
          approvalScope: "design",
        }),
      ).toBe(true);
    }
  });

  it("requires an app id and owner when staging is requested", async () => {
    const action = createProviderApiRequestAction({ executeRequest: vi.fn() });
    await expect(
      action.run({ provider: "github", path: "/repos", stageAs: "repos" }),
    ).rejects.toThrow("requires appId");

    const scoped = createProviderApiRequestAction(
      { executeRequest: vi.fn() },
      { appId: "analytics", getOwnerEmail: () => null },
    );
    await expect(
      scoped.run({ provider: "github", path: "/repos", stageAs: "repos" }),
    ).rejects.toThrow("No authenticated context");
  });
});

describe("provider API audit summaries", () => {
  it("redacts query values and credential-like path segments", () => {
    expect(
      sanitizeProviderApiAuditPath(
        "https://api.example.test/hooks/token/0123456789abcdef0123456789abcdef?api_key=secret#fragment",
      ),
    ).toBe(
      "https://api.example.test/hooks/token/[redacted]?api_key=[redacted]",
    );
  });

  it("keeps explicit query objects out of the bounded summary", () => {
    const summary = buildProviderApiAuditSummary({
      method: "get",
      provider: "example",
      path: "/records?cursor=customer-secret",
    });
    expect(summary).toBe("GET example /records?cursor=[redacted]");
    expect(summary.length).toBeLessThanOrEqual(200);
  });
});
