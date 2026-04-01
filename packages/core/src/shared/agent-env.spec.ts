import { describe, it, expect, vi, afterEach } from "vitest";

describe("agentEnv", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("setVars in Node.js (no window)", () => {
    it("logs BUILDER_PARENT_MESSAGE with env vars", async () => {
      // Ensure no window global
      vi.stubGlobal("window", undefined);

      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const { agentEnv } = await import("./agent-env.js");

      agentEnv.setVars([{ key: "FOO", value: "bar" }]);

      expect(spy).toHaveBeenCalledOnce();
      const logged = spy.mock.calls[0][0] as string;
      expect(logged.startsWith("BUILDER_PARENT_MESSAGE:")).toBe(true);

      const payload = JSON.parse(logged.replace("BUILDER_PARENT_MESSAGE:", ""));
      expect(payload.targetOrigin).toBe("*");
      expect(payload.message.type).toBe("builder.setEnvVars");
      expect(payload.message.data.vars).toEqual([{ key: "FOO", value: "bar" }]);

      spy.mockRestore();
    });

    it("handles multiple env vars", async () => {
      vi.stubGlobal("window", undefined);
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const { agentEnv } = await import("./agent-env.js");

      agentEnv.setVars([
        { key: "A", value: "1" },
        { key: "B", value: "2" },
      ]);

      const logged = spy.mock.calls[0][0] as string;
      const payload = JSON.parse(logged.replace("BUILDER_PARENT_MESSAGE:", ""));
      expect(payload.message.data.vars).toHaveLength(2);

      spy.mockRestore();
    });

    it("handles empty vars array", async () => {
      vi.stubGlobal("window", undefined);
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const { agentEnv } = await import("./agent-env.js");

      agentEnv.setVars([]);

      const logged = spy.mock.calls[0][0] as string;
      const payload = JSON.parse(logged.replace("BUILDER_PARENT_MESSAGE:", ""));
      expect(payload.message.data.vars).toEqual([]);

      spy.mockRestore();
    });
  });
});
