import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as agentKit from "./index.js";

describe("AgentKit root entrypoint", () => {
  it("exposes only the protocol and headless client surface", () => {
    expect(agentKit).toHaveProperty("AGENTKIT_PROTOCOL_VERSION");
    expect(agentKit).toHaveProperty("createAgentKitClient");
    expect(agentKit).not.toHaveProperty("createAgentKitHttpTransport");
    expect(agentKit).not.toHaveProperty("AgentKitRoot");
    expect(agentKit).not.toHaveProperty("assertAgentTransportConformance");
  });

  it("keeps HTTP and React implementations out of headless installations", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };

    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      "@agent-native/agentkit-client",
      "@agent-native/agentkit-protocol",
    ]);
    expect(manifest.dependencies).not.toHaveProperty(
      "@agent-native/agentkit-conformance",
    );
    expect(manifest.peerDependenciesMeta).toMatchObject({
      "@agent-native/agentkit-adapters": { optional: true },
      "@agent-native/agentkit-react": { optional: true },
    });
  });

  it("forwards the development stylesheet to the React source package", () => {
    const styles = readFileSync(
      new URL("./styles.css", import.meta.url),
      "utf8",
    );

    expect(styles).toContain(
      '@import "@agent-native/agentkit-react/styles.css";',
    );
  });
});
