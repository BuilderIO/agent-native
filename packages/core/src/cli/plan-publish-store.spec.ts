import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  isFirstPartyPlanHost,
  planPublishConfigPath,
  readPlanPublishAuth,
  writePlanPublishAuth,
} from "./plan-publish-store.js";

const tmpRoots: string[] = [];

function tmpFile(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-plan-publish-"));
  tmpRoots.push(root);
  return path.join(root, "nested", "plan-publish.json");
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  delete process.env.PLAN_PUBLISH_CONFIG_PATH;
});

describe("planPublishConfigPath", () => {
  it("defaults to ~/.agent-native/plan-publish.json", () => {
    delete process.env.PLAN_PUBLISH_CONFIG_PATH;
    expect(planPublishConfigPath()).toBe(
      path.join(os.homedir(), ".agent-native", "plan-publish.json"),
    );
  });

  it("honors the PLAN_PUBLISH_CONFIG_PATH override", () => {
    process.env.PLAN_PUBLISH_CONFIG_PATH = "/tmp/custom/plan-publish.json";
    expect(planPublishConfigPath()).toBe("/tmp/custom/plan-publish.json");
  });
});

describe("isFirstPartyPlanHost", () => {
  it("accepts plan.agent-native.com (the canonical Plans host)", () => {
    expect(isFirstPartyPlanHost("https://plan.agent-native.com")).toBe(true);
    expect(
      isFirstPartyPlanHost("https://plan.agent-native.com/_agent-native/mcp"),
    ).toBe(true);
  });

  it("rejects other first-party subdomains to prevent last-write-wins token clobber", () => {
    // connect --all iterates every first-party app; only the Plans app should
    // update plan-publish.json — other apps (assets, mail, …) must not overwrite
    // the canonical Plans token.
    expect(isFirstPartyPlanHost("https://mail.agent-native.com")).toBe(false);
    expect(isFirstPartyPlanHost("https://assets.agent-native.com")).toBe(false);
    expect(isFirstPartyPlanHost("https://agent-native.com")).toBe(false);
  });

  it("rejects custom, look-alike, and invalid hosts", () => {
    expect(isFirstPartyPlanHost("https://my-app.ngrok-free.dev")).toBe(false);
    expect(isFirstPartyPlanHost("http://localhost:8100")).toBe(false);
    // Look-alike domain must not match the suffix check.
    expect(isFirstPartyPlanHost("https://evil-agent-native.com")).toBe(false);
    expect(isFirstPartyPlanHost("not-a-url")).toBe(false);
  });
});

describe("writePlanPublishAuth", () => {
  it("writes the canonical { url, token } shape and creates the dir", () => {
    const file = tmpFile();
    const written = writePlanPublishAuth(
      { url: "https://plan.agent-native.com", token: "tok-1" },
      file,
    );

    expect(written).toBe(file);
    const rec = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(rec).toMatchObject({
      url: "https://plan.agent-native.com",
      token: "tok-1",
    });
    expect(typeof rec.updatedAt).toBe("string");
  });

  it("strips a trailing slash from the url", () => {
    const file = tmpFile();
    writePlanPublishAuth(
      { url: "https://plan.agent-native.com/", token: "tok-2" },
      file,
    );
    expect(JSON.parse(fs.readFileSync(file, "utf-8")).url).toBe(
      "https://plan.agent-native.com",
    );
  });

  it("merges into an existing file without clobbering sibling keys", () => {
    const file = tmpFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ keepMe: true, token: "old", url: "https://old" }),
    );

    writePlanPublishAuth(
      { url: "https://plan.agent-native.com", token: "tok-3" },
      file,
    );

    const rec = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(rec.keepMe).toBe(true);
    expect(rec.url).toBe("https://plan.agent-native.com");
    expect(rec.token).toBe("tok-3");
  });

  it("returns null and writes nothing when token or url is empty", () => {
    const file = tmpFile();
    expect(
      writePlanPublishAuth(
        { url: "https://plan.agent-native.com", token: "" },
        file,
      ),
    ).toBeNull();
    expect(writePlanPublishAuth({ url: "", token: "tok" }, file)).toBeNull();
    expect(fs.existsSync(file)).toBe(false);
  });

  it("recovers from a corrupt existing file by starting fresh", () => {
    const file = tmpFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ not valid json");

    const written = writePlanPublishAuth(
      { url: "https://plan.agent-native.com", token: "tok-4" },
      file,
    );

    expect(written).toBe(file);
    const rec = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(rec.token).toBe("tok-4");
  });

  it("reads canonical and legacy alias token shapes", () => {
    const file = tmpFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        hostedUrl: "https://plan.agent-native.com/",
        bearerToken: "tok-alias",
      }),
    );

    expect(readPlanPublishAuth(file)).toEqual({
      url: "https://plan.agent-native.com",
      token: "tok-alias",
    });
  });

  it("returns null for missing or incomplete publish auth", () => {
    expect(readPlanPublishAuth(tmpFile())).toBeNull();

    const file = tmpFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ url: "https://plan.agent-native.com" }),
    );
    expect(readPlanPublishAuth(file)).toBeNull();
  });
});
