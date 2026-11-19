import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeEvent {
  method: string;
  url: URL;
  req?: Request;
  headers: Record<string, string>;
  status: number;
}

const state = vi.hoisted(() => ({
  asset: null as null | {
    id: string;
    planId: string;
    data: string;
    mimeType: string;
    filename: string;
  },
  access: null as null | { resource: { deletedAt: number | null } },
  session: { email: "reader@example.com" } as null | {
    email: string;
    orgId?: string;
  },
  accessContexts: [] as unknown[],
  opened: null as
    | null
    | { kind: "redirect"; url: string }
    | { kind: "bytes"; data: Uint8Array; media: { mimeType: string } },
  editorError: null as Error | null,
  stored: vi.fn(),
}));

const errors = vi.hoisted(() => {
  class ForbiddenError extends Error {}
  class PlanAssetStorageUnavailableError extends Error {}
  class PlanAssetTooLargeError extends Error {
    readonly statusCode = 413;
  }
  class PrivateMediaValidationError extends Error {
    constructor(
      message: string,
      readonly statusCode: number,
    ) {
      super(message);
    }
  }
  return {
    ForbiddenError,
    PlanAssetStorageUnavailableError,
    PlanAssetTooLargeError,
    PrivateMediaValidationError,
  };
});

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getMethod: (event: FakeEvent) => event.method,
  sendRedirect: (event: FakeEvent, location: string, status: number) => {
    event.status = status;
    event.headers.Location = location;
    return "";
  },
  setResponseHeader: (event: FakeEvent, name: string, value: string) => {
    event.headers[name] = value;
  },
  setResponseStatus: (event: FakeEvent, status: number) => {
    event.status = status;
  },
}));

vi.mock("drizzle-orm", () => ({ eq: () => ({}) }));

vi.mock("@agent-native/core/server", () => ({
  getSession: async () => state.session,
  runWithRequestContext: (_context: unknown, run: () => unknown) => run(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  ForbiddenError: errors.ForbiddenError,
  resolveAccess: async (_type: string, _id: string, context: unknown) => {
    state.accessContexts.push(context);
    return state.access;
  },
}));

vi.mock("@agent-native/core/private-media", () => ({
  PRIVATE_MEDIA_SVG_CSP: "default-src 'none'",
  PrivateMediaValidationError: errors.PrivateMediaValidationError,
  openPrivateMediaForAuthorizedReader: async () => state.opened,
  readPrivateMediaUploadFormData: (request: Request) => request.formData(),
}));

vi.mock("./lib/local-identity.js", () => ({
  resolvePlanAccessContext: (context: unknown) => context,
}));

vi.mock("./lib/plan-assets.js", () => ({
  PlanAssetStorageUnavailableError: errors.PlanAssetStorageUnavailableError,
  PlanAssetTooLargeError: errors.PlanAssetTooLargeError,
  privatePlanAssetMediaId: (data: string) =>
    data.startsWith("private:") ? data.slice("private:".length) : null,
  storePlanAsset: state.stored,
}));

vi.mock("./plans.js", () => ({
  assertPlanEditor: async () => {
    if (state.editorError) throw state.editorError;
    return { resource: { orgId: "org_plan" } };
  },
}));

vi.mock("./db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (state.asset ? [state.asset] : []),
        }),
      }),
    }),
  }),
  schema: { planAssets: { id: "plan_assets.id" }, plans: {} },
}));

const { createPlanAssetHandler } = await import("./plan-asset-route.js");
const handler = createPlanAssetHandler() as unknown as (
  event: FakeEvent,
) => Promise<unknown>;

function request(method = "GET"): FakeEvent {
  return {
    method,
    url: new URL("https://plan.test/asset_1/image"),
    headers: {},
    status: 200,
  };
}

function upload(fields: Record<string, string | File>): FakeEvent {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return {
    method: "POST",
    url: new URL("https://plan.test/"),
    req: new Request("https://plan.test/", { method: "POST", body: form }),
    headers: {},
    status: 200,
  };
}

describe("plan asset route", () => {
  beforeEach(() => {
    state.asset = {
      id: "asset_1",
      planId: "plan_1",
      data: Buffer.from("PNGDATA").toString("base64"),
      mimeType: "image/png",
      filename: "diagram.png",
    };
    state.access = { resource: { deletedAt: null } };
    state.session = { email: "reader@example.com" };
    state.accessContexts = [];
    state.opened = null;
    state.editorError = null;
    state.stored.mockReset();
  });

  it("keeps a plan's image out of shared caches, since it loads only for people who can open the plan", async () => {
    const response = await handler(request());

    expect(response).toBeInstanceOf(Response);
    const headers = (response as Response).headers;
    expect(headers.get("cache-control")).toBe("private, no-store");
    expect(headers.get("cdn-cache-control")).toBe("no-store");
    expect(headers.get("content-type")).toBe("image/png");
    expect(
      Buffer.from(await (response as Response).arrayBuffer()).toString(),
    ).toBe("PNGDATA");
  });

  it("sends the same cache headers for a HEAD request", async () => {
    const event = request("HEAD");

    await expect(handler(event)).resolves.toBe("");
    expect(event.headers["Cache-Control"]).toBe("private, no-store");
    expect(event.headers["CDN-Cache-Control"]).toBe("no-store");
  });

  it("answers 404 to someone who can't open the plan", async () => {
    state.access = null;
    const event = request();

    await expect(handler(event)).resolves.toEqual({ error: "Not found" });
    expect(event.status).toBe(404);
  });

  it("checks access with the reader's workspace, so a workspace plan's members can load its images", async () => {
    state.session = { email: "member@example.com", orgId: "org_1" };

    await handler(request());

    expect(state.accessContexts).toEqual([
      { userEmail: "member@example.com", orgId: "org_1" },
    ]);
  });

  it("serves an image kept in private storage", async () => {
    state.asset!.data = "private:media_1";
    state.opened = {
      kind: "bytes",
      data: Buffer.from("WEBPDATA"),
      media: { mimeType: "image/webp" },
    };

    const response = (await handler(request())) as Response;

    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe(
      "WEBPDATA",
    );
  });

  it("guards an SVG kept in private storage with a content security policy", async () => {
    state.asset!.data = "private:media_1";
    state.opened = {
      kind: "bytes",
      data: Buffer.from("<svg/>"),
      media: { mimeType: "image/svg+xml" },
    };

    const response = (await handler(request())) as Response;

    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'",
    );
  });

  it("sends the reader to storage's short-lived link when it has one", async () => {
    state.asset!.data = "private:media_1";
    state.opened = { kind: "redirect", url: "https://storage.test/signed" };
    const event = request();

    await handler(event);

    expect(event.status).toBe(302);
    expect(event.headers.Location).toBe("https://storage.test/signed");
    expect(event.headers["Cache-Control"]).toBe("private, no-store");
  });

  it("doesn't open a private image for someone who can't open the plan", async () => {
    state.asset!.data = "private:media_1";
    state.opened = { kind: "redirect", url: "https://storage.test/signed" };
    state.access = null;
    const event = request();

    await expect(handler(event)).resolves.toEqual({ error: "Not found" });
    expect(event.status).toBe(404);
    expect(event.headers.Location).toBeUndefined();
  });

  it("sends the reader to the public URL of an image added before private storage", async () => {
    state.asset!.data = "cdn:https://cdn.test/old.png";
    const event = request();

    await handler(event);

    expect(event.status).toBe(302);
    expect(event.headers.Location).toBe("https://cdn.test/old.png");
  });

  describe("upload", () => {
    const image = () =>
      new File(["PNGDATA"], "shot.png", { type: "image/png" });

    it("adds an image to a plan the caller can edit", async () => {
      state.stored.mockResolvedValue({
        assetId: "passet_1",
        src: "/_agent-native/plan-asset/passet_1/shot.png",
      });
      const event = upload({ file: image(), planId: "plan_1" });

      await expect(handler(event)).resolves.toEqual({
        id: "passet_1",
        url: "/_agent-native/plan-asset/passet_1/shot.png",
      });
      expect(event.status).toBe(201);
      expect(state.stored).toHaveBeenCalledWith({
        planId: "plan_1",
        filename: "shot.png",
        mimeType: "image/png",
        data: new Uint8Array(Buffer.from("PNGDATA")),
        orgId: "org_plan",
      });
    });

    it("asks a signed-out caller to sign in", async () => {
      state.session = null;
      const event = upload({ file: image(), planId: "plan_1" });

      await expect(handler(event)).resolves.toEqual({
        error: "Sign in to add images",
      });
      expect(event.status).toBe(401);
      expect(state.stored).not.toHaveBeenCalled();
    });

    it("answers 404 when the caller can't edit the plan", async () => {
      state.editorError = new errors.ForbiddenError("read-only");
      const event = upload({ file: image(), planId: "plan_1" });

      await expect(handler(event)).resolves.toEqual({ error: "Not found" });
      expect(event.status).toBe(404);
      expect(state.stored).not.toHaveBeenCalled();
    });

    it("says so when no storage can keep the image", async () => {
      state.stored.mockRejectedValue(
        new errors.PlanAssetStorageUnavailableError("Connect storage"),
      );
      const event = upload({ file: image(), planId: "plan_1" });

      await expect(handler(event)).resolves.toEqual({
        error: "Connect storage",
        code: "storage_unavailable",
      });
      expect(event.status).toBe(503);
    });

    it("passes on a refused image's status and reason", async () => {
      state.stored.mockRejectedValue(
        new errors.PrivateMediaValidationError("Not an image", 415),
      );
      const event = upload({ file: image(), planId: "plan_1" });

      await expect(handler(event)).resolves.toEqual({ error: "Not an image" });
      expect(event.status).toBe(415);
    });

    it("needs a plan", async () => {
      const event = upload({ file: image() });

      await expect(handler(event)).resolves.toEqual({
        error: "A plan is required",
      });
      expect(event.status).toBe(400);
    });
  });
});
