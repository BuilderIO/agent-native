import { describe, it, expect, vi } from "vitest";
import { CliRegistry } from "./registry.js";
import type { CliAdapter, CliResult } from "./types.js";

function createMockAdapter(
  name: string,
  available = true,
): CliAdapter {
  return {
    name,
    description: `Mock ${name} CLI`,
    isAvailable: vi.fn().mockResolvedValue(available),
    execute: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
  };
}

describe("CliRegistry", () => {
  it("registers and retrieves an adapter", () => {
    const registry = new CliRegistry();
    const adapter = createMockAdapter("gh");
    registry.register(adapter);
    expect(registry.get("gh")).toBe(adapter);
  });

  it("returns undefined for unregistered adapter", () => {
    const registry = new CliRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("replaces adapter with same name", () => {
    const registry = new CliRegistry();
    const first = createMockAdapter("gh");
    const second = createMockAdapter("gh");
    registry.register(first);
    registry.register(second);
    expect(registry.get("gh")).toBe(second);
    expect(registry.list()).toHaveLength(1);
  });

  it("unregisters an adapter", () => {
    const registry = new CliRegistry();
    registry.register(createMockAdapter("gh"));
    registry.unregister("gh");
    expect(registry.get("gh")).toBeUndefined();
    expect(registry.list()).toHaveLength(0);
  });

  it("unregister is a no-op for unknown name", () => {
    const registry = new CliRegistry();
    registry.unregister("nonexistent"); // should not throw
    expect(registry.list()).toHaveLength(0);
  });

  it("lists all registered adapters", () => {
    const registry = new CliRegistry();
    registry.register(createMockAdapter("gh"));
    registry.register(createMockAdapter("ffmpeg"));
    registry.register(createMockAdapter("stripe"));
    const list = registry.list();
    expect(list).toHaveLength(3);
    expect(list.map((a) => a.name).sort()).toEqual(["ffmpeg", "gh", "stripe"]);
  });

  it("listAvailable filters by isAvailable", async () => {
    const registry = new CliRegistry();
    registry.register(createMockAdapter("gh", true));
    registry.register(createMockAdapter("ffmpeg", false));
    registry.register(createMockAdapter("stripe", true));

    const available = await registry.listAvailable();
    expect(available).toHaveLength(2);
    expect(available.map((a) => a.name).sort()).toEqual(["gh", "stripe"]);
  });

  it("listAvailable handles adapter that throws", async () => {
    const registry = new CliRegistry();
    const broken: CliAdapter = {
      name: "broken",
      description: "Throws on check",
      isAvailable: vi.fn().mockRejectedValue(new Error("crash")),
      execute: vi.fn(),
    };
    registry.register(broken);
    registry.register(createMockAdapter("gh", true));

    const available = await registry.listAvailable();
    expect(available).toHaveLength(1);
    expect(available[0].name).toBe("gh");
  });

  it("describe returns name, description, and availability", async () => {
    const registry = new CliRegistry();
    registry.register(createMockAdapter("gh", true));
    registry.register(createMockAdapter("ffmpeg", false));

    const descriptions = await registry.describe();
    expect(descriptions).toHaveLength(2);

    const gh = descriptions.find((d) => d.name === "gh");
    expect(gh).toEqual({
      name: "gh",
      description: "Mock gh CLI",
      available: true,
    });

    const ffmpeg = descriptions.find((d) => d.name === "ffmpeg");
    expect(ffmpeg).toEqual({
      name: "ffmpeg",
      description: "Mock ffmpeg CLI",
      available: false,
    });
  });

  it("describe handles isAvailable throwing", async () => {
    const registry = new CliRegistry();
    const broken: CliAdapter = {
      name: "broken",
      description: "Throws",
      isAvailable: vi.fn().mockRejectedValue(new Error("nope")),
      execute: vi.fn(),
    };
    registry.register(broken);

    const descriptions = await registry.describe();
    expect(descriptions[0]).toEqual({
      name: "broken",
      description: "Throws",
      available: false,
    });
  });
});
