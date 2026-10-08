import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { mergeCoreSharingActions } from "@agent-native/core/server";
import { describe, expect, it } from "vitest";

const actionsDir = fileURLToPath(new URL(".", import.meta.url));

const mailActionNames = readdirSync(actionsDir)
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".spec.ts"))
  .map((file) => file.replace(/\.ts$/, ""))
  .filter((name) => name !== "helpers" && name !== "run");

describe("Mail action names", () => {
  // A template action replaces the core action of the same name, so a Mail
  // file named like a core action silently changes what core's own pages
  // read (Settings › Automations listed nothing while Mail had its own
  // `list-automations`).
  it("leaves core's actions in place", async () => {
    const coreOnly: Parameters<typeof mergeCoreSharingActions>[0] = {};
    await mergeCoreSharingActions(coreOnly);
    expect(Object.keys(coreOnly)).toContain("list-automations");

    const shadowed = mailActionNames.filter((name) => name in coreOnly);
    expect(shadowed).toEqual([]);
  }, 60_000);

  it("resolves core's list-automations alongside Mail's inbox rules", async () => {
    const sentinel = { mail: true } as never;
    const registry: Parameters<typeof mergeCoreSharingActions>[0] =
      Object.fromEntries(mailActionNames.map((name) => [name, sentinel]));
    await mergeCoreSharingActions(registry);

    expect(registry["list-email-rules"]).toBe(sentinel);
    expect(registry["list-automations"]).not.toBe(sentinel);
    expect(registry["list-automations"]?.http).toEqual({ method: "GET" });
  }, 60_000);
});
