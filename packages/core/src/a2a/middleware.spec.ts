import { describe, it, expect, vi, afterEach } from "vitest";
import { createAuthMiddleware } from "./middleware.js";

function createMockReqResNext(authHeader?: string) {
  const req: any = {
    headers: authHeader ? { authorization: authHeader } : {},
  };
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  const next = vi.fn();
  return { req, res, next };
}

describe("createAuthMiddleware", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("calls next when apiKeyEnv is undefined (no auth)", () => {
    const middleware = createAuthMiddleware(undefined);
    const { req, res, next } = createMockReqResNext();
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("calls next when env var is not set (dev mode)", () => {
    delete process.env.TEST_API_KEY;
    const middleware = createAuthMiddleware("TEST_API_KEY");
    const { req, res, next } = createMockReqResNext();
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("returns 401 when no Authorization header", () => {
    process.env.TEST_API_KEY = "secret-123";
    const middleware = createAuthMiddleware("TEST_API_KEY");
    const { req, res, next } = createMockReqResNext();
    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: "Authentication required" }),
      }),
    );
  });

  it("returns 401 when Authorization header is not Bearer", () => {
    process.env.TEST_API_KEY = "secret-123";
    const middleware = createAuthMiddleware("TEST_API_KEY");
    const { req, res, next } = createMockReqResNext("Basic abc123");
    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 401 when token does not match", () => {
    process.env.TEST_API_KEY = "secret-123";
    const middleware = createAuthMiddleware("TEST_API_KEY");
    const { req, res, next } = createMockReqResNext("Bearer wrong-token");
    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: "Invalid API key" }),
      }),
    );
  });

  it("calls next when token matches", () => {
    process.env.TEST_API_KEY = "secret-123";
    const middleware = createAuthMiddleware("TEST_API_KEY");
    const { req, res, next } = createMockReqResNext("Bearer secret-123");
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
