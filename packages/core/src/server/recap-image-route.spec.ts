import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// h3 stub. defineEventHandler returns the handler as-is; the rest read/write
// fields on the fake event. Mirrors open-route.spec / poll-handler.spec.
vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getHeader: (event: any, name: string) =>
    event.headers?.[name] ?? event.headers?.[name.toLowerCase()],
  getMethod: (event: any) => event.method ?? "GET",
  readRawBody: async (event: any) => event.rawBody,
  setResponseStatus: (event: any, status: number) => {
    event.statusCode = status;
  },
  setResponseHeader: (event: any, name: string, value: string) => {
    (event.responseHeaders ??= {})[name] = value;
  },
}));

const getSession = vi.hoisted(() => vi.fn());
vi.mock("./auth.js", () => ({
  getSession: (...a: any[]) => getSession(...a),
}));

vi.mock("./google-oauth.js", () => ({
  getAppUrl: (_event: any, path: string) => `https://app.example.com${path}`,
}));

const saveRecapImage = vi.hoisted(() => vi.fn());
const getRecapImage = vi.hoisted(() => vi.fn());
vi.mock("./recap-image-store.js", async () => {
  const actual = await vi.importActual<typeof import("./recap-image-store.js")>(
    "./recap-image-store.js",
  );
  return {
    ...actual,
    saveRecapImage: (...a: any[]) => saveRecapImage(...a),
    getRecapImage: (...a: any[]) => getRecapImage(...a),
  };
});

// verifyAuth / getMcpOAuthResource are only imported when getSession misses;
// stub them so the connect-token path is exercisable.
const verifyAuth = vi.hoisted(() => vi.fn());
vi.mock("../mcp/build-server.js", () => ({
  verifyAuth: (...a: any[]) => verifyAuth(...a),
  resolveOrgIdFromDomain: async () => undefined,
}));
vi.mock("../mcp/oauth-route.js", () => ({
  getMcpOAuthResource: () => "https://app.example.com/_agent-native/mcp",
}));

const { createRecapImageHandler } = await import("./recap-image-route.js");

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x10, 0x20,
]);
const TOKEN = "a".repeat(64);

function fakeEvent(opts: {
  method: string;
  pathname: string;
  headers?: Record<string, string>;
  rawBody?: Buffer;
}) {
  return {
    method: opts.method,
    url: { pathname: opts.pathname },
    headers: opts.headers ?? {},
    rawBody: opts.rawBody,
    responseHeaders: {} as Record<string, string>,
    statusCode: 200,
  } as any;
}

beforeEach(() => {
  getSession.mockReset();
  saveRecapImage.mockReset();
  getRecapImage.mockReset();
  verifyAuth.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe("recap-image upload (POST /_agent-native/recap-image)", () => {
  it("401s an unauthenticated upload", async () => {
    getSession.mockResolvedValue(null);
    const handler = createRecapImageHandler();
    const event = fakeEvent({
      method: "POST",
      pathname: "/",
      headers: { "content-type": "image/png" },
      rawBody: PNG,
    });
    const res = await handler(event);
    expect(event.statusCode).toBe(401);
    expect(res).toMatchObject({ error: expect.stringMatching(/auth/i) });
    expect(saveRecapImage).not.toHaveBeenCalled();
  });

  it("stores a raw image/png body for a cookie-session caller and returns an imageUrl", async () => {
    getSession.mockResolvedValue({ email: "u@example.com" });
    saveRecapImage.mockResolvedValue({ token: TOKEN });
    const handler = createRecapImageHandler();
    const event = fakeEvent({
      method: "POST",
      pathname: "/",
      headers: { "content-type": "image/png" },
      rawBody: PNG,
    });
    const res = (await handler(event)) as { imageUrl: string };
    expect(event.statusCode).toBe(201);
    expect(res.imageUrl).toBe(
      `https://app.example.com/_agent-native/recap-image/${TOKEN}.png`,
    );
    expect(saveRecapImage).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ ownerEmail: "u@example.com" }),
    );
  });

  it("accepts the connect bearer token via verifyAuth when there is no session", async () => {
    getSession.mockResolvedValue(null);
    verifyAuth.mockResolvedValue({
      authed: true,
      identity: { userEmail: "connect@example.com" },
    });
    saveRecapImage.mockResolvedValue({ token: TOKEN });
    const handler = createRecapImageHandler();
    const event = fakeEvent({
      method: "POST",
      pathname: "/",
      headers: {
        authorization: "Bearer connect-tok",
        "content-type": "image/png",
      },
      rawBody: PNG,
    });
    const res = (await handler(event)) as { imageUrl: string };
    expect(event.statusCode).toBe(201);
    expect(res.imageUrl).toContain(`${TOKEN}.png`);
    expect(verifyAuth).toHaveBeenCalled();
  });

  it("accepts JSON { pngBase64 }", async () => {
    getSession.mockResolvedValue({ email: "u@example.com" });
    saveRecapImage.mockResolvedValue({ token: TOKEN });
    const handler = createRecapImageHandler();
    const event = fakeEvent({
      method: "POST",
      pathname: "/",
      headers: { "content-type": "application/json" },
      rawBody: Buffer.from(
        JSON.stringify({ pngBase64: PNG.toString("base64") }),
        "utf8",
      ),
    });
    await handler(event);
    expect(event.statusCode).toBe(201);
    expect(saveRecapImage).toHaveBeenCalled();
  });

  it("400s a non-PNG body", async () => {
    getSession.mockResolvedValue({ email: "u@example.com" });
    const handler = createRecapImageHandler();
    const event = fakeEvent({
      method: "POST",
      pathname: "/",
      headers: { "content-type": "image/png" },
      rawBody: Buffer.from("not a png", "utf8"),
    });
    await handler(event);
    expect(event.statusCode).toBe(400);
    expect(saveRecapImage).not.toHaveBeenCalled();
  });
});

describe("recap-image serve (GET /_agent-native/recap-image/<token>.png)", () => {
  it("serves stored bytes anonymously with strict image/png + immutable cache", async () => {
    getRecapImage.mockResolvedValue({
      bytes: PNG,
      contentType: "image/png",
    });
    const handler = createRecapImageHandler();
    const event = fakeEvent({ method: "GET", pathname: `/${TOKEN}.png` });
    const res = (await handler(event)) as Response;

    // No session lookup happens on the read path.
    expect(getSession).not.toHaveBeenCalled();
    expect(res).toBeInstanceOf(Response);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toMatch(/immutable/);
    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe(
      "cross-origin",
    );
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(PNG)).toBe(true);
  });

  it("404s an unknown token", async () => {
    getRecapImage.mockResolvedValue(null);
    const handler = createRecapImageHandler();
    const event = fakeEvent({ method: "GET", pathname: `/${TOKEN}.png` });
    const res = await handler(event);
    expect(event.statusCode).toBe(404);
    expect(res).toMatchObject({ error: expect.any(String) });
  });

  it("404s a traversal / malformed token without hitting the store", async () => {
    const handler = createRecapImageHandler();
    for (const seg of ["..%2F..%2Fsecret.png", "foo.txt", "ABC.png", "a.png"]) {
      const event = fakeEvent({ method: "GET", pathname: `/${seg}` });
      await handler(event);
      expect(event.statusCode).toBe(404);
    }
    expect(getRecapImage).not.toHaveBeenCalled();
  });

  it("405s a PUT", async () => {
    const handler = createRecapImageHandler();
    const event = fakeEvent({ method: "PUT", pathname: "/" });
    await handler(event);
    expect(event.statusCode).toBe(405);
  });
});
