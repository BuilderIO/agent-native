import { readFileSync } from "node:fs";

import { getShareableResource } from "@agent-native/core/sharing";
import { describe, expect, it } from "vitest";

import "./index.js";

const indexTsSource = readFileSync(
  new URL("./index.ts", import.meta.url),
  "utf8",
);

describe("creative context shareable registrations", () => {
  it("requires org membership for creative context pack user shares", () => {
    const registration = getShareableResource("creative-context-pack");

    expect(registration).toMatchObject({
      allowPublic: false,
      requireOrgMemberForUserShares: true,
    });
  });
});

describe("creative context background startup", () => {
  it("does not run package migrations in durable background functions", () => {
    expect(indexTsSource).toMatch(
      /if \(!isInBackgroundFunctionRuntime\(\)\) \{\s*await creativeContextDbPlugin\(nitroApp\);/,
    );
  });
});
