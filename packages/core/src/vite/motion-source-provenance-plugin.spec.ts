import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { generatedMotionNodeId } from "../shared/motion-source-node-id.js";
import { motionSourceProvenancePlugin } from "./motion-source-provenance-plugin.js";

function transform(
  source: string,
  fileName: string,
  command = "serve",
  servedSource = source,
) {
  mkdirSync(path.join(process.cwd(), ".tmp"), { recursive: true });
  const root = mkdtempSync(
    path.join(process.cwd(), ".tmp", "motion-provenance-"),
  );
  const absolutePath = path.join(root, fileName);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, source);
  const plugin = motionSourceProvenancePlugin();
  plugin.configResolved?.({ root, command } as never);
  try {
    return (plugin.transform as Function).call(
      {},
      servedSource,
      absolutePath,
    ) as { code: string; map: { toString(): string } } | null;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("motionSourceProvenancePlugin", () => {
  it("binds rendered host JSX IDs to their original module path and SHA-256", () => {
    const source = `export function Card() { return <section><button>Go</button><style>{"p { margin: 0 }"}</style><script>{"window.ready = true"}</script></section>; }`;
    const result = transform(source, "templates/design/src/Card.tsx");

    expect(result?.code).toContain(
      `data-agent-native-motion-source-file="templates/design/src/Card.tsx"`,
    );
    expect(result?.code).toContain(
      `data-agent-native-motion-source-hash="${createHash("sha256").update(source).digest("hex")}"`,
    );
    expect(result?.code.match(/data-agent-native-node-id=/g)).toHaveLength(2);
    expect(result?.code).not.toContain("<Card data-agent-native-node-id");
    const map = JSON.parse(result!.map.toString());
    expect(map.sourcesContent).toEqual([source]);
    expect(map.sources).toEqual(["templates/design/src/Card.tsx"]);
  });

  it("preserves a literal ID and generates stable IDs from module and host order", () => {
    const source = `export const Card = () => <><div data-agent-native-node-id="hero"/><span /></>;`;
    const result = transform(source, "src/components/Card.tsx");
    expect(result?.code).toContain(`data-agent-native-node-id="hero"`);
    expect(result?.code).toContain(
      `data-agent-native-node-id="${generatedMotionNodeId("src/components/Card.tsx", 1)}"`,
    );
    expect(generatedMotionNodeId("src/components/Card.tsx", 1)).toBe(
      generatedMotionNodeId("src/components/Card.tsx", 1),
    );
    expect(generatedMotionNodeId("src/components/Card.tsx", 1)).not.toBe(
      generatedMotionNodeId("src/components/Other.tsx", 1),
    );
  });

  it("skips spread and dynamic node identity and never transforms production builds", () => {
    const source = `export const Card = ({ nodeId, ...props }) => <><div {...props}/><span data-agent-native-node-id={nodeId}/></>;`;
    expect(transform(source, "src/Card.tsx")?.code).toBeUndefined();
    expect(transform(source, "src/Card.tsx", "build")).toBeNull();
  });

  it("does not stamp transformed source that differs from the file on disk", () => {
    const source = `export const Card = () => <button>Go</button>;`;
    expect(
      transform(source, "src/Card.tsx", "serve", `${source}\n// stale`),
    ).toBeNull();
  });

  it("reports unreadable source instead of silently skipping provenance", () => {
    const root = mkdtempSync(
      path.join(process.cwd(), ".tmp", "motion-provenance-missing-"),
    );
    const plugin = motionSourceProvenancePlugin();
    plugin.configResolved?.({ root, command: "serve" } as never);
    try {
      expect(() =>
        (plugin.transform as Function).call(
          {},
          "export const Card = () => <button />;",
          path.join(root, "src", "Removed.tsx"),
        ),
      ).toThrow("Unable to read the Motion source module");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
