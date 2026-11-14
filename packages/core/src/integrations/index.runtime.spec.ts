import { describe, expect, it } from "vitest";

import {
  getIntegrationCatalogEntry,
  listBuiltInChannelIntegrations,
  mergeIntegrationAdapters,
  type PlatformAdapter,
} from "./index.js";
const adapter = (platform: string, tag = "default") =>
  ({ platform, tag }) as unknown as PlatformAdapter;
describe("integration public runtime exports", () => {
  it("overrides a built-in adapter without removing unrelated adapters or mutating input", () => {
    const first = adapter("personal-a"),
      second = adapter("personal-b"),
      replacement = adapter("personal-a", "override"),
      third = adapter("personal-c");
    const defaults = [first, second];
    expect(mergeIntegrationAdapters(defaults, [replacement, third])).toEqual([
      replacement,
      second,
      third,
    ]);
    expect(defaults).toEqual([first, second]);
    expect(mergeIntegrationAdapters(defaults, [replacement])[0]).toBe(
      replacement,
    );
  });
  it("resolves an available channel through the public entry point", () => {
    const channels = listBuiltInChannelIntegrations();
    expect(channels.length).toBeGreaterThan(0);
    const first = channels[0]!;
    expect(getIntegrationCatalogEntry(first.id)).toBe(first);
    expect(first.availability).toBe("available");
    expect(first.supportMaturity).toBe("built-in");
    expect(
      getIntegrationCatalogEntry("unlisted-personal-integration"),
    ).toBeUndefined();
  });
});
