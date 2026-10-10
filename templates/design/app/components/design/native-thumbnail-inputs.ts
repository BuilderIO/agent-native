import { parseNativeEmbeddedAssetRegistry } from "@shared/native-embedded-assets";

import type { PreparedNativeThumbnail } from "./native-thumbnail-plan";

export const NATIVE_THUMBNAIL_SYNTHETIC_INPUT_PATH =
  "/__native-thumbnail__/synthetic-image-v1.png";

const INPUT_REGISTRY = parseNativeEmbeddedAssetRegistry({
  schemaVersion: 1,
  assets: [
    {
      path: "/__native-thumbnail__/synthetic-image-v1.png",
      mimeType: "image/png",
      byteLength: 156,
      sha256:
        "cbfaf969ad798ebca6c16e49330c92584d30f07d02a7dab0fd5c9aa6eaac97a9",
      base64:
        "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAYAAACinX6EAAAAY0lEQVR4nO3RQQ2AQBADwJOCBCQhBQlIWGnnBET0QTY7TSqg07Wf8016XDtqVd1JVxoAAAAAAABgMED3AemBAAAAAAAAwGSA7gPSAwEAAAAAAIDJAN0H/H0gAAAAAAAA0BjgAwTZvNN4YpRhAAAAAElFTkSuQmCC",
    },
  ],
});

export const NATIVE_THUMBNAIL_INPUT_REGISTRY_TEXT =
  JSON.stringify(INPUT_REGISTRY);

export function isolateNativeThumbnailInputs(
  entry: PreparedNativeThumbnail,
): PreparedNativeThumbnail {
  const definition = entry.item.definition;
  const produced = new Set(
    definition.passes.flatMap((pass) => [
      pass.output,
      ...(pass.additionalOutputs ?? []),
    ]),
  );
  const required = new Set(
    definition.passes
      .flatMap((pass) => pass.reads)
      .filter((name) => !produced.has(name)),
  );
  const params = { ...entry.instance.params };
  const bindings = { ...entry.instance.bindings };
  const isolated: string[] = [];
  for (const [name, port] of Object.entries(definition.inputs ?? {})) {
    if (
      (port.kind !== "texture-2d" && port.kind !== "mask") ||
      !port.resource ||
      !required.has(port.resource)
    )
      continue;
    const properties = Object.entries(definition.properties).filter(
      ([, property]) => property.type === "texture" && property.input === name,
    );
    const resource = definition.resources?.find(
      (candidate) => candidate.name === port.resource,
    );
    if (
      ["source", "mask", "backdrop"].includes(port.resource) &&
      !properties.length &&
      resource?.sampleEncoding !== "linear-data" &&
      resource?.sampleEncoding !== "srgb-encoded-straight"
    )
      continue;
    for (const [key] of properties) params[key] = null;
    bindings[name] = {
      kind: "asset",
      url: NATIVE_THUMBNAIL_SYNTHETIC_INPUT_PATH,
    };
    isolated.push(name);
  }
  if (!isolated.length) return entry;
  return {
    ...entry,
    instance: { ...entry.instance, params, bindings },
    cacheKey: JSON.stringify([
      entry.cacheKey,
      "isolated-image-v1",
      INPUT_REGISTRY.assets[0].sha256,
      isolated,
    ]),
  };
}
