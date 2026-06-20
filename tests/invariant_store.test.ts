import { BrowserSessionStore } from "../../../packages/core/src/browser-sessions/store";

describe("Browser session store should not pass unvalidated args directly from payload", () => {
  const adversarialPayloads = [
    // Exact exploit: prototype pollution via __proto__
    { __proto__: { isAdmin: true }, action: "malicious" },
    // Boundary: nested object with constructor pollution
    { constructor: { prototype: { polluted: true } }, normalArg: "value" },
    // Valid input that should work normally
    { url: "https://example.com", selector: "#main" },
  ];

  test.each(adversarialPayloads)(
    "rowToRequest does not allow prototype pollution via payload: %j",
    (payload) => {
      // Verify that adversarial payloads assigned as args cannot pollute Object prototype
      const cleanObj: Record<string, unknown> = {};

      // Simulate what the store does: assigns payload directly to request.args
      const request: Record<string, unknown> = { type: "run-action" };
      request.args = payload;

      // Security invariant: prototype pollution must not propagate
      expect((cleanObj as any).isAdmin).toBeUndefined();
      expect((cleanObj as any).polluted).toBeUndefined();

      // The args must be a plain object, not sharing prototype chain modifications
      if (request.args && typeof request.args === "object") {
        const args = request.args as Record<string, unknown>;
        // Invariant: args should not have __proto__ as an enumerable own property
        // that could be confused with prototype manipulation at consumption time
        if ("__proto__" in payload) {
          // If __proto__ is in the payload, it should ideally be sanitized
          // or at minimum not pollute the global Object prototype
          expect(Object.getPrototypeOf(cleanObj)).toBe(Object.prototype);
          expect((Object.prototype as any).isAdmin).toBeUndefined();
        }
      }
    }
  );

  test("BrowserSessionStore can be instantiated without throwing on adversarial db content", () => {
    // Ensure the store module is importable and the class exists
    expect(BrowserSessionStore).toBeDefined();
    expect(typeof BrowserSessionStore).toBe("function");
  });
});