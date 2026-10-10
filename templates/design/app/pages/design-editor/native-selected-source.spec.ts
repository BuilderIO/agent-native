// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  FROSTED_REFRACTION_EFFECT,
  GRAIN_GRADIENT_EFFECT,
  HALFTONE_EFFECT,
} from "../../../shared/native-effect-presets";
import { hashEffectDefinition } from "../../../shared/native-effect-trust";
import {
  parseEffectsFromHtml,
  writeEffectsToHtml,
  type EffectDocument,
} from "../../../shared/native-effects";
import {
  buildNativeCodePackage,
  buildNativeStandaloneHtml,
} from "./native-code-package";
import { extractNativeSelectedSource } from "./native-selected-source";

const crop = { nodeId: "selected", x: 218, y: 2069, width: 1162, height: 887 };

async function source(): Promise<string> {
  const selectedHash = await hashEffectDefinition(GRAIN_GRADIENT_EFFECT);
  const otherHash = await hashEffectDefinition(HALFTONE_EFFECT);
  const authored = `<!doctype html><html><head><title>Selected Design</title><style>.card{padding:12px}</style></head><body><main data-agent-native-node-id="wrapper">Drop plain text<section data-agent-native-node-id="selected" class="card"><strong data-agent-native-node-id="child">Editable</strong></section><p data-agent-native-node-id="inner-sibling">Drop</p></main><article data-agent-native-node-id="other">Other</article><script type="application/x-agent-native-effect-approvals" data-agent-native-export-approvals>${JSON.stringify({ schemaVersion: 1, hashes: [selectedHash, otherHash] })}</script><script data-agent-native-native-shader-runtime data-runtime-version="2" nonce="testnonce">/* bundled */</script></body></html>`;
  const manifest: EffectDocument = {
    schemaVersion: 2,
    definitions: [GRAIN_GRADIENT_EFFECT, HALFTONE_EFFECT],
    instances: [
      {
        id: "selected-effect",
        nodeId: "selected",
        definitionId: GRAIN_GRADIENT_EFFECT.id,
        definitionVersion: GRAIN_GRADIENT_EFFECT.version,
        placement: "fill",
        params: {},
        enabled: true,
        opacity: 1,
        seed: 77,
        clip: "bounds",
        blend: "normal",
        timing: { speed: 1, paused: true, time: 0 },
      },
      {
        id: "other-effect",
        nodeId: "other",
        definitionId: HALFTONE_EFFECT.id,
        definitionVersion: HALFTONE_EFFECT.version,
        placement: "layer",
        params: {},
        enabled: true,
        opacity: 1,
        seed: 78,
        clip: "bounds",
        blend: "normal",
        timing: { speed: 1, paused: true, time: 0 },
      },
    ],
  };
  return writeEffectsToHtml(authored, manifest);
}

describe("selected native standalone source", () => {
  it("feeds the existing standalone and React builders with only selected editable source", async () => {
    const html = await extractNativeSelectedSource({
      html: await source(),
      crop,
    });
    const header = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 4,
      138, 0, 0, 3, 119,
    ]);
    const options = {
      html,
      poster: new Blob([header], { type: "image/png" }),
      viewport: { width: crop.width, height: crop.height },
      pixelRatio: 1,
    };
    const standalone = await buildNativeStandaloneHtml(options).then((blob) =>
      blob.text(),
    );
    expect(standalone).toContain('data-agent-native-node-id="selected"');
    expect(standalone).not.toContain('data-agent-native-node-id="other"');
    const bundle = await buildNativeCodePackage(options);
    expect(bundle.type).toBe("application/zip");
  });

  it("keeps editable selected DOM, ancestor style, exact runtime, and only selected model/approval", async () => {
    const html = await extractNativeSelectedSource({
      html: await source(),
      crop,
    });
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(
      doc.querySelector('[data-agent-native-node-id="selected"] strong')
        ?.textContent,
    ).toBe("Editable");
    expect(
      doc.querySelector('[data-agent-native-node-id="wrapper"]'),
    ).not.toBeNull();
    expect(
      doc.querySelector('[data-agent-native-node-id="inner-sibling"]'),
    ).toBeNull();
    expect(doc.querySelector('[data-agent-native-node-id="other"]')).toBeNull();
    expect(doc.body.textContent).not.toContain("Drop plain text");
    expect(doc.querySelector("style")?.textContent).toContain(
      ".card{padding:12px}",
    );
    expect(
      doc.querySelector("style[data-agent-native-export-crop]")?.textContent,
    ).toContain("translate:-218px -2069px");
    expect(
      doc.querySelectorAll("script[data-agent-native-native-shader-runtime]"),
    ).toHaveLength(1);
    const model = parseEffectsFromHtml(html);
    expect(model.errors).toEqual([]);
    expect(model.document?.instances.map((instance) => instance.id)).toEqual([
      "selected-effect",
    ]);
    expect(
      model.document?.definitions.map((definition) => definition.id),
    ).toEqual([GRAIN_GRADIENT_EFFECT.id]);
    expect(
      JSON.parse(
        doc.querySelector("script[data-agent-native-export-approvals]")
          ?.textContent ?? "",
      ),
    ).toEqual({
      schemaVersion: 1,
      hashes: [],
    });
  });

  it("accepts exact built-in definitions without redundant viewer approvals", async () => {
    const doc = new DOMParser().parseFromString(await source(), "text/html");
    doc.querySelector<HTMLScriptElement>(
      "script[data-agent-native-export-approvals]",
    )!.textContent = JSON.stringify({ schemaVersion: 1, hashes: [] });
    const selected = await extractNativeSelectedSource({
      html: `<!doctype html>${doc.documentElement.outerHTML}`,
      crop,
    });
    const parsed = parseEffectsFromHtml(selected);
    expect(parsed.errors).toEqual([]);
    expect(parsed.document?.instances.map((instance) => instance.id)).toEqual([
      "selected-effect",
    ]);
    const packaged = new DOMParser().parseFromString(selected, "text/html");
    expect(
      JSON.parse(
        packaged.querySelector<HTMLScriptElement>(
          "script[data-agent-native-export-approvals]",
        )!.textContent ?? "",
      ),
    ).toEqual({ schemaVersion: 1, hashes: [] });
  });

  it("requires an exact approval for a selected custom execution hash", async () => {
    const html = await source();
    const parsed = parseEffectsFromHtml(html).document!;
    const custom = { ...GRAIN_GRADIENT_EFFECT, id: "custom-selected-grain" };
    const customSource = writeEffectsToHtml(html, {
      ...parsed,
      definitions: [custom, HALFTONE_EFFECT],
      instances: parsed.instances.map((instance) =>
        instance.id === "selected-effect"
          ? { ...instance, definitionId: custom.id }
          : instance,
      ),
    });
    const withoutApproval = new DOMParser().parseFromString(
      customSource,
      "text/html",
    );
    withoutApproval.querySelector<HTMLScriptElement>(
      "script[data-agent-native-export-approvals]",
    )!.textContent = JSON.stringify({ schemaVersion: 1, hashes: [] });
    await expect(
      extractNativeSelectedSource({
        html: `<!doctype html>${withoutApproval.documentElement.outerHTML}`,
        crop,
      }),
    ).rejects.toMatchObject({ code: "source-unreadable" });
    withoutApproval.querySelector<HTMLScriptElement>(
      "script[data-agent-native-export-approvals]",
    )!.textContent = JSON.stringify({
      schemaVersion: 1,
      hashes: [await hashEffectDefinition(custom)],
    });
    const selected = await extractNativeSelectedSource({
      html: `<!doctype html>${withoutApproval.documentElement.outerHTML}`,
      crop,
    });
    const packaged = new DOMParser().parseFromString(selected, "text/html");
    expect(
      JSON.parse(
        packaged.querySelector<HTMLScriptElement>(
          "script[data-agent-native-export-approvals]",
        )!.textContent ?? "",
      ).hashes,
    ).toEqual([await hashEffectDefinition(custom)]);
  });

  it("keeps only embedded assets referenced by the selected subtree", async () => {
    const entry = (path: string) => ({
      path,
      mimeType: "image/png",
      byteLength: 1,
      sha256: "0".repeat(64),
      base64: "AA==",
    });
    const html = (await source())
      .replace(
        "Editable</strong>",
        'Editable</strong><img src="/assets/selected.png">',
      )
      .replace(
        "Other</article>",
        'Other<img src="/assets/other.png"></article>',
      )
      .replace(
        "</body>",
        `<script type="application/x-agent-native-effect-assets" data-agent-native-export-assets>${JSON.stringify({ schemaVersion: 1, assets: [entry("/assets/selected.png"), entry("/assets/other.png")] })}</script></body>`,
      );
    const selected = await extractNativeSelectedSource({ html, crop });
    const doc = new DOMParser().parseFromString(selected, "text/html");
    expect(
      JSON.parse(
        doc.querySelector("script[data-agent-native-export-assets]")
          ?.textContent ?? "",
      ).assets.map((asset: { path: string }) => asset.path),
    ).toEqual(["/assets/selected.png"]);
    expect(selected).not.toContain("/assets/other.png");
  });

  it("rejects an ambiguous target or an unsupported executable script", async () => {
    const html = await source();
    await expect(
      extractNativeSelectedSource({
        html: html.replace(
          "</body>",
          '<aside data-agent-native-node-id="selected"></aside></body>',
        ),
        crop,
      }),
    ).rejects.toMatchObject({ code: "selection-unavailable" });
    await expect(
      extractNativeSelectedSource({
        html: html.replace("</body>", "<script>alert(1)</script></body>"),
        crop,
      }),
    ).rejects.toMatchObject({ code: "source-unreadable" });
    await expect(
      extractNativeSelectedSource({
        html,
        crop: { ...crop, x: Number.NaN },
      }),
    ).rejects.toMatchObject({ code: "selection-unavailable" });
    await expect(
      extractNativeSelectedSource({
        html: html.replace(
          "</section>",
          '<em data-agent-native-node-id="child">Duplicate</em></section>',
        ),
        crop,
      }),
    ).rejects.toMatchObject({ code: "selection-unavailable" });
  });

  it("refuses a backdrop or an authored-node dependency outside the selected subtree", async () => {
    const html = await source();
    const parsed = parseEffectsFromHtml(html).document!;
    const withBackdrop = writeEffectsToHtml(html, {
      ...parsed,
      definitions: [FROSTED_REFRACTION_EFFECT, HALFTONE_EFFECT],
      instances: parsed.instances.map((instance) =>
        instance.id === "selected-effect"
          ? {
              ...instance,
              definitionId: FROSTED_REFRACTION_EFFECT.id,
              definitionVersion: FROSTED_REFRACTION_EFFECT.version,
              placement: "backdrop" as const,
            }
          : instance,
      ),
    });
    await expect(
      extractNativeSelectedSource({ html: withBackdrop, crop }),
    ).rejects.toMatchObject({ code: "dependency-outside-selection" });
    const withExternalBinding = writeEffectsToHtml(html, {
      ...parsed,
      instances: parsed.instances.map((instance) =>
        instance.id === "selected-effect"
          ? {
              ...instance,
              definitionId: HALFTONE_EFFECT.id,
              definitionVersion: HALFTONE_EFFECT.version,
              placement: "layer" as const,
              bindings: {
                source: {
                  kind: "authored-node" as const,
                  nodeId: "other",
                  capture: "content" as const,
                },
              },
            }
          : instance,
      ),
    });
    await expect(
      extractNativeSelectedSource({ html: withExternalBinding, crop }),
    ).rejects.toMatchObject({ code: "dependency-outside-selection" });
  });
});
