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

async function transformHtml(
  source: string,
  fileName: string,
  command = "serve",
  servedSource = source,
) {
  mkdirSync(path.join(process.cwd(), ".tmp"), { recursive: true });
  const root = mkdtempSync(
    path.join(process.cwd(), ".tmp", "motion-html-provenance-"),
  );
  const absolutePath = path.join(root, fileName);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, source);
  const plugin = motionSourceProvenancePlugin();
  plugin.configResolved?.({ root, command } as never);
  try {
    const hook = plugin.transformIndexHtml as {
      handler: (
        html: string,
        context: { filename: string },
      ) => string | undefined | Promise<string | undefined>;
    };
    return await hook.handler(servedSource, { filename: absolutePath });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("motionSourceProvenancePlugin", () => {
  it("binds rendered host JSX IDs to their original module path and SHA-256", () => {
    const source = `type Props = { label: string }; export function Card({ label }: Props) { return <section><button>{label}</button><style>{"p { margin: 0 }"}</style><script>{"window.ready = true"}</script></section>; }`;
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

  it("skips JSX provenance for incomplete source without failing the dev transform", () => {
    const source = `export const Card = () => <button>`;
    expect(transform(source, "src/Card.tsx")).toBeNull();
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

  it("binds served HTML host elements to stable source IDs and a raw file hash", async () => {
    const source = `<!doctype html><html><head><script src="/app.js"></script></head><body><main><div data-agent-native-node-id="authored">Card</div><button>Go</button><script>window.ready = true</script><style>p { margin: 0 }</style></main></body></html>`;
    const modulePath = "pages/index.html";
    const result = await transformHtml(source, modulePath);
    const hash = createHash("sha256").update(source).digest("hex");

    expect(result).toContain(
      `data-agent-native-motion-source-file="${modulePath}"`,
    );
    expect(result).toContain(`data-agent-native-motion-source-hash="${hash}"`);
    expect(result).toContain(
      `data-agent-native-node-id="${generatedMotionNodeId(modulePath, 0)}"`,
    );
    expect(result).toContain(`data-agent-native-node-id="authored"`);
    expect(result).toContain(
      `data-agent-native-node-id="${generatedMotionNodeId(modulePath, 5)}"`,
    );
    expect(
      result?.match(/data-agent-native-motion-source-file=/g),
    ).toHaveLength(6);
    expect(result).toContain(`<script>window.ready = true</script>`);
    expect(result).toContain(`<style>p { margin: 0 }</style>`);
  });

  it("skips HTML provenance for stale, malformed, and production source", async () => {
    const source = `<!doctype html><html><body><button>Go</button></body></html>`;
    expect(
      await transformHtml(source, "index.html", "serve", `${source}\n`),
    ).toBeUndefined();
    expect(await transformHtml(source, "index.html", "build")).toBeUndefined();
    expect(
      await transformHtml(
        `<!doctype html><html><body><button data-agent-native-node-id="a" data-agent-native-node-id="b">Go</button></body></html>`,
        "index.html",
      ),
    ).toBeUndefined();
  });
});
