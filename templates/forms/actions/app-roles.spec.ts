import { defineAction } from "@agent-native/core/action";
import type { ActionRunContext } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  roles: ["reviewer"] as string[],
  orgRole: "member",
  member: true,
  resourceRole: "editor",
  resourceRoles: {} as Record<string, string>,
  resourceOrg: "org-example" as string | null,
  orgRoles: {} as Record<string, string[]>,
  lookupOrgs: [] as string[],
  selectCount: 0,
  accessLookups: 0,
  formRows: null as
    | {
        id: string;
        ownerEmail: string;
        orgId: string | null;
        fields: string;
        settings: string;
      }[]
    | null,
  navigation: null as { view: string; formId: string } | null,
  overrides: [] as { permission: string; roles_json: string }[],
  write: vi.fn(),
  assertAccess: vi.fn(),
}));
vi.mock("../../../packages/core/src/db/client.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../packages/core/src/db/client.js")
  >()),
  getDbExec: () => ({
    execute: async ({ sql, args }: { sql: string; args: string[] }) => {
      if (sql.includes("FROM org_members")) state.lookupOrgs.push(args[1]!);
      return {
        rows: sql.includes("app_permission_overrides")
          ? state.overrides
          : state.member
            ? [
                {
                  roles: state.orgRoles[args[1]!] ?? state.roles,
                  orgRole: state.orgRole,
                },
              ]
            : [],
      };
    },
  }),
}));
vi.mock(
  "@agent-native/core/org",
  async () => await import("../../../packages/core/src/org/app-roles.js"),
);
vi.mock("@agent-native/core/sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/sharing")>()),
  resolveAccess: async (_type: string, id: string) => {
    state.accessLookups++;
    const role = state.resourceRoles[id] ?? state.resourceRole;
    return role === "none"
      ? null
      : { role, resource: { orgId: state.resourceOrg } };
  },
  assertAccess: (...args: unknown[]) => state.assertAccess(...args),
  accessFilter: vi.fn(() => true),
}));
const formDb = vi.hoisted(() => ({
  getDb: () => ({
    select: () => {
      state.selectCount++;
      const selection = state.selectCount;
      return {
        from: () => ({
          where: () => ({
            groupBy: async () => [],
            then: (resolve: (rows: unknown[]) => unknown) =>
              resolve([{ count: 1 }]),
            orderBy: () => ({
              limit: async () =>
                state.navigation || selection === 1
                  ? (state.formRows ?? [
                      {
                        id: "shared-form",
                        ownerEmail: "other@example.com",
                        orgId: state.resourceOrg,
                        fields: "[]",
                        settings: "{}",
                      },
                    ])
                  : [],
            }),
            limit: async () => [
              {
                id: "shared-form",
                formId: "shared-form",
                status: "draft",
                fields: "[]",
                settings: "{}",
              },
            ],
          }),
        }),
      };
    },
    update: () => ({
      set: (data: unknown) => {
        state.write(data);
        return {
          where: () => ({ returning: async () => [{ id: "shared-form" }] }),
        };
      },
    }),
  }),
}));
vi.mock("../server/db/index.js", () => ({
  schema: { forms: { id: "id" }, responses: { formId: "formId", id: "id" } },
  getDb: formDb.getDb,
}));
vi.mock("@agent-native/core/db", () => ({ createGetDb: () => formDb.getDb }));
vi.mock("../server/lib/public-form-ssr.js", () => ({
  invalidatePublicFormCache: vi.fn(),
}));
vi.mock("@agent-native/core/tracking", () => ({ track: vi.fn() }));
vi.mock("./_tab-state.js", () => ({
  readAppStateForCurrentTab: async () => state.navigation,
}));

const { registerActionAccessChecker } =
  await import("../../../packages/core/src/authorization/action-access-runtime.js");
const { default: updateForm } = await import("./update-form.js");
const { default: deleteForm } = await import("./delete-form.js");
const { default: restoreForm } = await import("./restore-form.js");
const { default: patchFields } = await import("./patch-form-fields.js");
const { default: responseInsights } = await import("./response-insights.js");
const { default: viewScreen } = await import("./view-screen.js");
const { requireFormsPermission } = await import("../server/lib/app-roles.js");
const caller: ActionRunContext = {
  caller: "frontend",
  userEmail: "member@example.com",
  orgId: "org-example",
  appId: "forms",
};

beforeEach(() => {
  registerActionAccessChecker(async () => ({
    allowed: true,
    reason: "resource fixture",
  }));
  state.roles = ["reviewer"];
  state.orgRole = "member";
  state.member = true;
  state.resourceRole = "editor";
  state.resourceRoles = {};
  state.resourceOrg = "org-example";
  state.orgRoles = {};
  state.lookupOrgs = [];
  state.selectCount = 0;
  state.accessLookups = 0;
  state.formRows = null;
  state.navigation = null;
  state.overrides = [];
  state.write.mockClear();
  state.assertAccess.mockReset();
  state.assertAccess.mockResolvedValue({ resource: {} });
});

describe("Forms app-role enforcement", () => {
  it("retains the owner exemption for accessible bulk forms without an active membership", async () => {
    state.member = false;
    state.formRows = [
      {
        id: "owned",
        ownerEmail: " MEMBER@example.com ",
        orgId: caller.orgId,
        fields: "[]",
        settings: "{}",
      },
    ];
    await expect(
      responseInsights.run({ displayMode: "chart" }, caller),
    ).resolves.toBeDefined();
    expect(state.accessLookups).toBe(0);
    expect(state.lookupOrgs).toEqual([]);
    expect(state.selectCount).toBe(3);
  });
  it.each([null, "other-org"])(
    "does not exempt a shared owner outside the form's organization in scope %s",
    async (orgId) => {
      state.member = false;
      state.formRows = [
        {
          id: "owned",
          ownerEmail: caller.userEmail!,
          orgId: "org-example",
          fields: "[]",
          settings: "{}",
        },
      ];
      await expect(
        responseInsights.run({ displayMode: "chart" }, { ...caller, orgId }),
      ).rejects.toThrow("forms.review");
      expect(state.accessLookups).toBe(0);
      expect(state.lookupOrgs).toEqual(["org-example"]);
      expect(state.selectCount).toBe(1);
    },
  );
  it("checks one organization for 100 accessible forms without reloading their access", async () => {
    state.formRows = Array.from({ length: 100 }, (_, index) => ({
      id: `shared-${index}`,
      ownerEmail: "other@example.com",
      orgId: "org-example",
      fields: "[]",
      settings: "{}",
    }));
    await expect(
      responseInsights.run(
        { displayMode: "chart", formLimit: 100 },
        { ...caller, orgId: null },
      ),
    ).resolves.toBeDefined();
    expect(state.accessLookups).toBe(0);
    expect(state.lookupOrgs).toEqual(["org-example"]);
    expect(state.selectCount).toBe(3);
  });
  it("checks every nonowned organization before bulk submission queries", async () => {
    state.formRows = [
      {
        id: "owned",
        ownerEmail: " MEMBER@example.com ",
        orgId: "owned-org",
        fields: "[]",
        settings: "{}",
      },
      {
        id: "shared-1",
        ownerEmail: "other@example.com",
        orgId: "org-example",
        fields: "[]",
        settings: "{}",
      },
      {
        id: "shared-2",
        ownerEmail: "other@example.com",
        orgId: "denied-org",
        fields: "[]",
        settings: "{}",
      },
    ];
    state.orgRoles = { "denied-org": ["retired"] };
    await expect(
      responseInsights.run(
        { displayMode: "chart" },
        { ...caller, orgId: "owned-org" },
      ),
    ).rejects.toThrow("forms.review");
    expect(state.accessLookups).toBe(0);
    expect(state.lookupOrgs).toEqual(["org-example", "denied-org"]);
    expect(state.selectCount).toBe(1);
  });
  it.each(["denied-override", "removed-member", "retired-role"])(
    "denies submission screen context to a %s before querying responses",
    async (kind) => {
      state.navigation = { view: "responses", formId: "shared-form" };
      if (kind === "denied-override")
        state.overrides = [{ permission: "forms.review", roles_json: "[]" }];
      else if (kind === "removed-member") state.member = false;
      else state.roles = ["retired"];
      await expect(viewScreen.run({}, caller)).rejects.toThrow("forms.review");
      expect(state.lookupOrgs).toEqual(["org-example"]);
      expect(state.selectCount).toBe(0);
    },
  );
  it("allows a Reviewer to read submission screen context", async () => {
    state.navigation = { view: "responses", formId: "shared-form" };
    await expect(viewScreen.run({}, caller)).resolves.toMatchObject({
      responses: { formId: "shared-form", showing: 1 },
    });
    expect(state.lookupOrgs).toEqual(["org-example"]);
  });
  it("denies a Reviewer editing a form even with an editor share", async () => {
    await expect(
      updateForm.run({ id: "shared-form", title: "Changed" }, caller),
    ).rejects.toThrow("forms.edit");
    expect(state.write).not.toHaveBeenCalled();
  });
  it("denies Reviewer field edits, archive, purge, and restore", async () => {
    await expect(
      patchFields.run({ id: "shared-form", ops: [] }, caller),
    ).rejects.toThrow("forms.edit");
    await expect(
      deleteForm.run({ id: "shared-form", purge: false }, caller),
    ).rejects.toThrow("forms.edit");
    await expect(
      deleteForm.run(
        { id: ["shared-form", "another-form"], purge: true },
        caller,
      ),
    ).rejects.toThrow("forms.edit");
    await expect(
      restoreForm.run({ id: "shared-form" }, caller),
    ).rejects.toThrow("forms.edit");
    expect(state.write).not.toHaveBeenCalled();
  });
  it.each(["editor", "unassigned", "owner", "admin", "form-owner"])(
    "preserves editing for %s",
    async (kind) => {
      state.roles =
        kind === "unassigned"
          ? []
          : kind === "editor"
            ? ["editor"]
            : ["reviewer"];
      if (kind === "owner" || kind === "admin") state.orgRole = kind;
      if (kind === "form-owner") state.resourceRole = "owner";
      await updateForm.run({ id: "shared-form", title: "Changed" }, caller);
      expect(state.write).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Changed" }),
      );
    },
  );
  it("keeps sharing checks for Editors and org admins", async () => {
    state.roles = ["editor"];
    state.assertAccess.mockRejectedValue(new Error("Resource access denied"));
    await expect(
      updateForm.run({ id: "shared-form", title: "Changed" }, caller),
    ).rejects.toThrow("Resource access denied");
    state.orgRole = "admin";
    await expect(
      updateForm.run({ id: "shared-form", title: "Changed" }, caller),
    ).rejects.toThrow("Resource access denied");
    expect(state.write).not.toHaveBeenCalled();
  });
  it.each(["editor", "reviewer"])(
    "allows %s to review submissions without granting form edits",
    async (role) => {
      state.roles = [role];
      const action = defineAction({
        authorize: requireFormsPermission("forms.review", "formId"),
        run: async () => {
          await state.assertAccess("form", "shared-form", "editor");
          return { responses: [] };
        },
      });
      await expect(
        action.run({ formId: "shared-form" }, caller),
      ).resolves.toEqual({ responses: [] });
      expect(state.assertAccess).toHaveBeenCalledWith(
        "form",
        "shared-form",
        "editor",
      );
    },
  );
  it("does not authorize a removed member", async () => {
    state.member = false;
    await expect(
      requireFormsPermission("forms.edit", "id")({ id: "shared-form" }, caller),
    ).rejects.toThrow("forms.edit");
  });
  it("does not exempt a mixed owner/shared bulk deletion", async () => {
    state.resourceRoles = { "owned-form": "owner", "shared-form": "admin" };
    await expect(
      deleteForm.run(
        { id: ["owned-form", "shared-form"], purge: false },
        caller,
      ),
    ).rejects.toThrow("forms.edit");
    expect(state.write).not.toHaveBeenCalled();
  });
  it("keeps authenticated personal deployments working", async () => {
    state.resourceOrg = null;
    await updateForm.run(
      { id: "shared-form", title: "Changed" },
      { ...caller, orgId: null },
    );
    expect(state.write).toHaveBeenCalled();
  });
  it("does not bypass an organization form by selecting personal scope", async () => {
    await expect(
      updateForm.run(
        { id: "shared-form", title: "Changed" },
        { ...caller, orgId: null },
      ),
    ).rejects.toThrow("forms.edit");
    expect(state.lookupOrgs).toEqual(["org-example"]);
    expect(state.write).not.toHaveBeenCalled();
  });
  it("uses the target organization when another organization is selected", async () => {
    state.orgRoles = { "other-org": ["editor"], "org-example": ["reviewer"] };
    await expect(
      updateForm.run(
        { id: "shared-form", title: "Changed" },
        { ...caller, orgId: "other-org" },
      ),
    ).rejects.toThrow("forms.edit");
    expect(state.lookupOrgs).toEqual(["org-example"]);
    expect(state.write).not.toHaveBeenCalled();
  });
  it("checks a submission's organization in personal scope", async () => {
    await expect(
      requireFormsPermission("forms.edit", "responseId")(
        { responseId: "response-example" },
        { ...caller, orgId: null },
      ),
    ).rejects.toThrow("forms.edit");
    expect(state.lookupOrgs).toEqual(["org-example"]);
  });
  it("gates the registered visibility persistence hook before writing", async () => {
    await vi.importActual("../server/db/index.js");
    const { getShareableResource } = await import("@agent-native/core/sharing");
    const persist = getShareableResource("form")!.persistVisibilityChange!;
    const args = {
      resource: {},
      resourceId: "shared-form",
      visibility: "org" as const,
      update: { visibility: "org" },
      userEmail: caller.userEmail,
      orgId: caller.orgId!,
    };
    await expect(persist(args)).rejects.toThrow("forms.edit");
    expect(state.write).not.toHaveBeenCalled();
    state.resourceRole = "owner";
    await persist(args);
    expect(state.write).toHaveBeenCalledWith({ visibility: "org" });
  });
  it.each(["removed-member", "retired-role", "denied-override"])(
    "denies bulk submission analysis to a %s before reading responses",
    async (kind) => {
      if (kind === "removed-member") state.member = false;
      else if (kind === "retired-role") state.roles = ["retired"];
      else state.overrides = [{ permission: "forms.review", roles_json: "[]" }];
      await expect(
        responseInsights.run(
          { displayMode: "chart" },
          { ...caller, orgId: null },
        ),
      ).rejects.toThrow("forms.review");
      expect(state.lookupOrgs).toEqual(["org-example"]);
      expect(state.selectCount).toBe(1);
    },
  );
});
