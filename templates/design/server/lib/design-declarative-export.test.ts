import { parse } from "parse5";
import { describe, expect, it } from "vitest";

import { GRAIN_GRADIENT_EFFECT } from "../../shared/native-effect-presets.js";
import { applyNativeEffectToHtml } from "../../shared/native-effects.js";
import {
  buildShaderRuntimeScriptTag,
  serializeShaderScriptBlock,
} from "../../shared/shader-fills.js";
import {
  DeclarativeExportError,
  buildDeclarativeNativeExport,
} from "./design-declarative-export.js";

function nativeSource(body = "Live editable text"): string {
  const applied = applyNativeEffectToHtml(
    `<!doctype html><html><head><style>body{margin:0}</style></head><body><div data-agent-native-node-id="hero">${body}</div></body></html>`,
    {
      nodeId: "hero",
      definition: GRAIN_GRADIENT_EFFECT,
      placement: "fill",
    },
  );
  expect(applied.errors).toEqual([]);
  return applied.html;
}

function build(source = nativeSource()): Promise<string> {
  return buildDeclarativeNativeExport({
    title: "Selected screen",
    files: [{ filename: "index.html", fileType: "html", content: source }],
    approvedDefinitionHashes: [],
    fontLicenses: [],
    pixelRatio: 1,
  });
}

describe("declarative native scene package", () => {
  const assetRegistry = `<script type="application/x-agent-native-effect-assets" data-agent-native-export-assets>${JSON.stringify(
    {
      schemaVersion: 1,
      assets: [
        {
          path: "/assets/texture.png",
          mimeType: "image/png",
          byteLength: 3,
          sha256: "0".repeat(64),
          base64: "AQID",
        },
      ],
    },
  )}</script>`;
  const legacyDefinition = serializeShaderScriptBlock({
    id: "legacy-grain",
    name: "Legacy grain",
    mode: "fill",
    glsl: "void main() { gl_FragColor = vec4(1.0); }",
    uniforms: {},
  });
  const legacyRuntime = buildShaderRuntimeScriptTag();

  it("includes one trusted runtime with a matching CSP nonce and inert approval metadata", async () => {
    const html = await build();
    const policyNonce = html.match(/script-src 'nonce-([^']+)'/)?.[1];
    const runtimeNonce = html.match(
      /<script data-agent-native-native-shader-runtime[^>]* nonce="([^"]+)"/,
    )?.[1];
    expect(policyNonce).toBeTruthy();
    expect(runtimeNonce).toBe(policyNonce);
    expect(html).toContain('data-agent-native-export-initial-pixel-ratio="1"');
    expect(html).toContain("application/x-agent-native-effects");
    expect(html).toContain("application/x-agent-native-effect-approvals");
    expect(html.match(/data-agent-native-native-shader-runtime/g)).toHaveLength(
      1,
    );
    expect(html).toContain("Live editable text");
    expect(html).not.toContain("cdn.jsdelivr.net");
  });

  it("binds the requested initial density only to the verified runtime", async () => {
    const html = await buildDeclarativeNativeExport({
      title: "Selected screen",
      files: [
        { filename: "index.html", fileType: "html", content: nativeSource() },
      ],
      approvedDefinitionHashes: [],
      fontLicenses: [],
      pixelRatio: 2,
    });
    expect(html).toContain('data-agent-native-export-initial-pixel-ratio="2"');
    await expect(
      buildDeclarativeNativeExport({
        title: "Selected screen",
        files: [
          { filename: "index.html", fileType: "html", content: nativeSource() },
        ],
        approvedDefinitionHashes: [],
        fontLicenses: [],
        pixelRatio: Infinity,
      }),
    ).rejects.toMatchObject({ code: "source-unsupported" });
  });

  it("preserves one validated inert native asset registry through standalone packaging", async () => {
    const html = await build(
      nativeSource().replace("</body>", `${assetRegistry}</body>`),
    );
    type HtmlNode = {
      tagName?: string;
      attrs?: { name: string; value: string }[];
      childNodes?: HtmlNode[];
      content?: HtmlNode;
    };
    const registries: HtmlNode[] = [];
    const visit = (node: HtmlNode): void => {
      if (
        node.tagName === "script" &&
        node.attrs?.some(
          (attribute) => attribute.name === "data-agent-native-export-assets",
        )
      )
        registries.push(node);
      for (const child of node.childNodes ?? []) visit(child);
      if (node.content) visit(node.content);
    };
    visit(parse(html) as HtmlNode);
    expect(registries).toHaveLength(1);
    expect(registries[0]?.attrs).toEqual(
      expect.arrayContaining([
        {
          name: "type",
          value: "application/x-agent-native-effect-assets",
        },
      ]),
    );
    expect(html).toContain('"path":"/assets/texture.png"');
    for (const registry of [
      assetRegistry.replace('"byteLength":3', '"byteLength":4'),
      assetRegistry.replace(
        "data-agent-native-export-assets",
        'data-agent-native-export-assets onclick="alert(1)"',
      ),
      `${assetRegistry}${assetRegistry}`,
    ]) {
      await expect(
        build(nativeSource().replace("</body>", `${registry}</body>`)),
      ).rejects.toMatchObject({
        code: expect.stringMatching(/resource-unsupported|script-unsupported/),
      });
    }
  });

  it("rejects independent scripts and event handlers instead of silently removing them", async () => {
    for (const source of [
      nativeSource().replace("</body>", "<script>alert(1)</script></body>"),
      nativeSource().replace("<body>", '<body onload="alert(1)">'),
      nativeSource().replace(
        "</body>",
        "<div data-agent-native-measured-flow-group></div></body>",
      ),
      nativeSource().replace(
        "</body>",
        '<script data-agent-native-native-shader-runtime data-runtime-version="2" src="https://example.invalid/remote.js"></script></body>',
      ),
      nativeSource().replace(
        'type="application/x-agent-native-effects"',
        'type="application/x-agent-native-effects" src="https://example.invalid/manifest.json"',
      ),
    ]) {
      await expect(build(source)).rejects.toThrow(DeclarativeExportError);
    }
  });

  it("removes only a verified dormant legacy runtime and definition", async () => {
    const source = nativeSource().replace(
      "</body>",
      `${legacyDefinition}${legacyRuntime}</body>`,
    );
    const html = await build(source);
    expect(html).not.toContain('type="application/x-agent-native-shader"');
    expect(html).not.toContain("data-agent-native-shader-runtime");
    expect(html.match(/data-agent-native-native-shader-runtime/g)).toHaveLength(
      1,
    );
  });

  it("rejects an active legacy fill and a changed legacy executable", async () => {
    const source = nativeSource()
      .replace(
        'data-agent-native-node-id="hero"',
        'data-agent-native-node-id="hero" data-an-shader-fill="legacy-grain"',
      )
      .replace("</body>", `${legacyDefinition}${legacyRuntime}</body>`);
    await expect(build(source)).rejects.toMatchObject({
      code: "script-unsupported",
      message:
        "Active legacy GLSL fills or effects cannot be synchronized for native export.",
    });
    await expect(
      build(
        source
          .replace(' data-an-shader-fill="legacy-grain"', "")
          .replace(
            'data-runtime-version="1"',
            'data-runtime-version="1" src="https://example.invalid/legacy.js"',
          ),
      ),
    ).rejects.toMatchObject({ code: "script-unsupported" });
    await expect(
      build(
        nativeSource().replace(
          "</body>",
          `${legacyDefinition.replace("/*! an-shader v1", "/*! an-shader v1x")}${legacyRuntime}</body>`,
        ),
      ),
    ).rejects.toMatchObject({ code: "script-unsupported" });
  });

  it("rejects external CSS imports and unsynchronized authored media", async () => {
    await expect(
      build(
        nativeSource().replace(
          "body{margin:0}",
          '@import url("https://example.invalid/a.css")',
        ),
      ),
    ).rejects.toThrow(DeclarativeExportError);
    await expect(
      build(
        nativeSource().replace(
          "</body>",
          '<video src="/clip.mp4"></video></body>',
        ),
      ),
    ).rejects.toThrow(DeclarativeExportError);
  });

  it("requires exactly one selected HTML source in the scene package", async () => {
    await expect(
      buildDeclarativeNativeExport({
        title: "Two screens",
        files: [
          { filename: "one.html", fileType: "html", content: nativeSource() },
          { filename: "two.html", fileType: "html", content: nativeSource() },
        ],
        approvedDefinitionHashes: [],
        fontLicenses: [],
        pixelRatio: 1,
      }),
    ).rejects.toThrow(DeclarativeExportError);
  });

  it("compiles static Tailwind classes, variants, keyframes and authored theme CSS without a browser runtime", async () => {
    const source = nativeSource()
      .replace(
        "</head>",
        '<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script><style type="text/tailwindcss">@theme { --color-brand: #ff5500; }</style></head>',
      )
      .replace(
        'data-agent-native-node-id="hero"',
        'data-agent-native-node-id="hero" class="bg-brand hover:bg-red-500 md:grid animate-pulse w-[42px]"',
      );
    const html = await build(source);
    expect(html).toContain("data-agent-native-export-tailwind-static");
    expect(html).toContain(".bg-brand");
    expect(html).toContain(".hover\\:bg-red-500");
    expect(html).toContain("@media");
    expect(html).toContain("@keyframes pulse");
    expect(html).toContain(".w-\\[42px\\]");
    expect(html).not.toContain("@tailwindcss/browser@4");
    expect(html).not.toContain('type="text/tailwindcss"');
  });

  it("rejects dynamic Alpine attributes and Tailwind directives requiring external code", async () => {
    await expect(
      build(
        nativeSource().replace("</body>", '<div x-show="open"></div></body>'),
      ),
    ).rejects.toMatchObject({ code: "script-unsupported" });
    await expect(
      build(
        nativeSource().replace(
          "</head>",
          '<style type="text/tailwindcss">@plugin "my-plugin";</style></head>',
        ),
      ),
    ).rejects.toMatchObject({ code: "source-unsupported" });
  });
});
