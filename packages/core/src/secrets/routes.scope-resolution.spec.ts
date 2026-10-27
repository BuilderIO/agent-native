import { H3 } from "h3";
import {
  afterEach,
  assert,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const fixture = vi.hoisted(() => ({
  failure: undefined as Error | undefined,
  personal: false,
  creating: false,
  creationAttempted: false,
  observed: undefined as unknown,
  email: "scope@example.test",
  write: vi.fn(),
}));
vi.mock("../server/auth.js", async (original) => ({
  ...(await original<typeof import("../server/auth.js")>()),
  getSession: async () => ({
    email: fixture.email,
    ...(fixture.personal || fixture.creating
      ? {}
      : { orgId: "fake-org", orgRole: "owner" }),
  }),
}));
vi.mock("../db/client.js", async (original) => ({
  ...(await original<typeof import("../db/client.js")>()),
  getDbExec: () => ({
    execute: async ({ sql }: { sql: string }) => {
      if (sql.includes("FROM org_members")) {
        if (fixture.failure && !fixture.creating) throw fixture.failure;
        return {
          rows:
            fixture.personal || fixture.creating
              ? []
              : [{ orgId: "fake-org", role: "owner", orgName: "Fake org" }],
        };
      }
      if (fixture.creating) {
        if (sql.includes("INSERT INTO organizations")) {
          fixture.creationAttempted = true;
          throw fixture.failure;
        }
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  }),
}));
vi.mock("../settings/user-settings.js", () => ({
  getUserSetting: async () => (fixture.personal ? { orgId: null } : null),
}));
vi.mock("./storage.js", async (original) => ({
  ...(await original<typeof import("./storage.js")>()),
  writeAppSecret: fixture.write,
}));
import { getOrgContext } from "../org/context.js";
import { registerRequiredSecret } from "./register.js";
import { createWriteSecretHandler } from "./routes.js";

let sequence = 0;
beforeEach(() => {
  fixture.email = `scope-${++sequence}@example.test`;
  fixture.failure = undefined;
  fixture.creating = false;
  fixture.creationAttempted = false;
  fixture.observed = undefined;
  fixture.personal = false;
  fixture.write.mockReset().mockResolvedValue("fake-id");
});
afterEach(() => vi.restoreAllMocks());

describe.each(["org", "workspace"] as const)(
  "%s secret scope resolution",
  (scope) => {
    async function write() {
      registerRequiredSecret({
        key: "FAKE_SCOPE_TOKEN",
        label: "Fake token",
        scope,
        kind: "api-key",
      });
      const handler = createWriteSecretHandler();
      const app = new H3();
      app.post("/FAKE_SCOPE_TOKEN", async (event) => {
        // A cached context must not turn an unreadable membership into authority.
        await getOrgContext(event).catch(() => undefined);
        try {
          return await handler(event);
        } catch (error) {
          fixture.observed = error;
          throw error;
        }
      });
      return app.fetch(
        new Request("https://app.example.test/FAKE_SCOPE_TOKEN", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: "fake-value" }),
        }),
      );
    }
    it.each([
      { code: "57014", status: 503, retry: "5" },
      { code: "42501", status: 500, retry: null },
    ])("does not change scope after $code", async ({ code, status, retry }) => {
      fixture.failure = Object.assign(
        new Error("private membership diagnostic"),
        { code },
      );
      const response = await write();
      expect(response.status).toBe(status);
      expect(response.headers.get("retry-after")).toBe(retry);
      expect(fixture.write).not.toHaveBeenCalled();
      assert.instanceOf(fixture.observed, Error);
      expect(fixture.observed.cause).toBe(fixture.failure);
      expect(await response.text()).not.toContain(
        "private membership diagnostic",
      );
    });
    it.each(["57014", "42501"])(
      "retains a marked default-org creation failure %s",
      async (code) => {
        fixture.creating = true;
        fixture.failure = Object.assign(new Error("private creation failure"), {
          code,
        });
        const response = await write();
        expect(response.status).toBe(code === "57014" ? 503 : 500);
        expect(response.headers.get("retry-after")).toBe(
          code === "57014" ? "5" : null,
        );
        expect(fixture.creationAttempted).toBe(true);
        assert.instanceOf(fixture.observed, Error);
        expect(fixture.observed.cause).toBe(fixture.failure);
        expect(fixture.write).not.toHaveBeenCalled();
      },
    );

    it("keeps healthy organization writes", async () => {
      expect((await write()).status).toBe(200);
      expect(fixture.write).toHaveBeenCalledWith(
        expect.objectContaining({ scope, scopeId: "fake-org" }),
      );
    });
    it("keeps confirmed Personal behavior", async () => {
      fixture.personal = true;
      const response = await write();
      expect(response.status).toBe(scope === "org" ? 401 : 200);
      if (scope === "org") expect(fixture.write).not.toHaveBeenCalled();
      else
        expect(fixture.write).toHaveBeenCalledWith(
          expect.objectContaining({ scopeId: `solo:${fixture.email}` }),
        );
    });
  },
);
