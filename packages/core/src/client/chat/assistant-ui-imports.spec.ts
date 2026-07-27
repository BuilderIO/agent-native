import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(import.meta.dirname, "../../..");

describe("assistant-ui imports", () => {
  it("uses the React package's store context instead of a separately bundled store", () => {
    const messageComponents = fs.readFileSync(
      path.join(packageRoot, "src/client/chat/message-components.tsx"),
      "utf8",
    );
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(messageComponents).not.toContain('from "@assistant-ui/store"');
    expect(packageJson.dependencies?.["@assistant-ui/store"]).toBe(
      ">=0.2.9 <0.2.14",
    );
    expect(packageJson.devDependencies?.["@assistant-ui/store"]).toBe(
      ">=0.2.9 <0.2.14",
    );
  });
});
