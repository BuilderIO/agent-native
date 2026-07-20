import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createMultiFrontierSettingsStore } from "./multi-frontier-settings-store.js";

describe("createMultiFrontierSettingsStore", () => {
  it("defaults false and survives corrupt or invalid files", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mf-settings-"));
    const filePath = path.join(directory, "settings.json");
    const store = createMultiFrontierSettingsStore(filePath);
    expect(store.read()).toEqual({ autoContinueAfterAgreement: false });

    fs.writeFileSync(filePath, "not-json", "utf8");
    expect(store.read()).toEqual({ autoContinueAfterAgreement: false });
    fs.writeFileSync(
      filePath,
      JSON.stringify({ autoContinueAfterAgreement: "yes", token: "secret" }),
      "utf8",
    );
    expect(store.read()).toEqual({ autoContinueAfterAgreement: false });
  });

  it("atomically persists only the nonsecret boolean with mode 0600", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mf-settings-"));
    const filePath = path.join(directory, "settings.json");
    const store = createMultiFrontierSettingsStore(filePath);

    expect(store.update({ autoContinueAfterAgreement: true })).toEqual({
      autoContinueAfterAgreement: true,
    });
    expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).toEqual({
      autoContinueAfterAgreement: true,
    });
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(directory)).toEqual(["settings.json"]);
  });

  it("cleans a temporary file when the atomic rename fails", () => {
    const calls: string[] = [];
    const fake = {
      mkdirSync: () => undefined,
      readFileSync: () => {
        throw new Error("missing");
      },
      writeFileSync: (filePath: string) => calls.push(`write:${filePath}`),
      renameSync: () => {
        throw new Error("rename failed");
      },
      chmodSync: () => undefined,
      unlinkSync: (filePath: string) => calls.push(`unlink:${filePath}`),
    };
    const store = createMultiFrontierSettingsStore(
      "/tmp/multi-frontier-settings.json",
      fake,
      () => "fixed",
    );
    expect(() => store.update({ autoContinueAfterAgreement: true })).toThrow(
      "rename failed",
    );
    expect(calls).toEqual([
      `write:/tmp/.multi-frontier-settings.json.${process.pid}.fixed.tmp`,
      `unlink:/tmp/.multi-frontier-settings.json.${process.pid}.fixed.tmp`,
    ]);
  });
});
