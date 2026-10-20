// @vitest-environment happy-dom
import { LIQUID_GLASS_EFFECT } from "@shared/native-effect-liquid-glass-v3";
import { hashEffectDefinition } from "@shared/native-effect-trust";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const renderPreviews = vi.hoisted(() => vi.fn());
vi.mock("./native-shader-catalog-preview", async (original) => ({
  ...(await original<typeof import("./native-shader-catalog-preview")>()),
  renderNativeCatalogPreviews: renderPreviews,
}));
import { nativeCatalogPreviewKey } from "./native-shader-catalog-preview";
import {
  NativeShaderCatalogPreview,
  NativeShaderCatalogPreviewProvider,
} from "./NativeShaderCatalogPreview";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  renderPreviews.mockReset();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

it("retries an unchanged custom draft after exact approval, and removes its thumbnail on revoke", async () => {
  const definition = {
    ...LIQUID_GLASS_EFFECT,
    id: "custom-preview-glass",
    version: 1,
  };
  const definitions = [definition];
  const hash = await hashEffectDefinition(definition);
  renderPreviews.mockResolvedValue(
    new Map([
      [
        nativeCatalogPreviewKey(definition),
        new Blob(["png"], { type: "image/png" }),
      ],
    ]),
  );
  const render = async (hashes: readonly string[]) => {
    await act(async () => {
      root.render(
        <NativeShaderCatalogPreviewProvider
          definitions={definitions}
          placement="backdrop"
          approvedDefinitionHashes={hashes}
        >
          <NativeShaderCatalogPreview definition={definition} />
        </NativeShaderCatalogPreviewProvider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  await render([]);
  await vi.waitFor(() => {
    expect(
      host
        .querySelector("[data-native-shader-preview-error]")
        ?.getAttribute("data-native-shader-preview-error"),
    ).toBe("native-catalog-preview-definition-unapproved");
  });
  expect(
    host
      .querySelector("[data-native-shader-preview-error]")
      ?.getAttribute("data-native-shader-preview-error"),
  ).toBe("native-catalog-preview-definition-unapproved");
  expect(renderPreviews).not.toHaveBeenCalled();
  await render([hash]);
  await vi.waitFor(() => expect(renderPreviews).toHaveBeenCalledOnce());
  expect(renderPreviews).toHaveBeenCalledOnce();
  expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:preview");
  await render([hash]);
  expect(renderPreviews).toHaveBeenCalledOnce();
  await render([]);
  await vi.waitFor(() => expect(host.querySelector("img")).toBeNull());
  expect(host.querySelector("img")).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  expect(renderPreviews).toHaveBeenCalledOnce();
});

it("does not retry a GPU failure until the custom approval revision changes", async () => {
  const definition = {
    ...LIQUID_GLASS_EFFECT,
    id: "custom-preview-error",
    version: 1,
  };
  const definitions = [definition];
  const hash = await hashEffectDefinition(definition);
  vi.spyOn(console, "error").mockImplementation(() => {});
  renderPreviews.mockRejectedValue(new Error("gpu-validation"));
  const render = async () => {
    await act(async () => {
      root.render(
        <NativeShaderCatalogPreviewProvider
          definitions={definitions}
          placement="backdrop"
          approvedDefinitionHashes={[hash]}
        >
          <NativeShaderCatalogPreview definition={definition} />
        </NativeShaderCatalogPreviewProvider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  await render();
  await vi.waitFor(() => expect(renderPreviews).toHaveBeenCalledOnce());
  await render();
  expect(renderPreviews).toHaveBeenCalledOnce();
  expect(
    host
      .querySelector("[data-native-shader-preview-error]")
      ?.getAttribute("data-native-shader-preview-error"),
  ).toBe("gpu-validation");
});

it("renders curated thumbnails while an unapproved custom draft stays blocked", async () => {
  const custom = {
    ...LIQUID_GLASS_EFFECT,
    id: "custom-preview-draft",
    version: 1,
  };
  const definitions = [LIQUID_GLASS_EFFECT, custom];
  renderPreviews.mockResolvedValue(
    new Map([
      [nativeCatalogPreviewKey(LIQUID_GLASS_EFFECT), new Blob(["png"])],
    ]),
  );
  await act(async () => {
    root.render(
      <NativeShaderCatalogPreviewProvider
        definitions={definitions}
        placement="backdrop"
        approvedDefinitionHashes={[]}
      >
        <NativeShaderCatalogPreview definition={LIQUID_GLASS_EFFECT} />
        <NativeShaderCatalogPreview definition={custom} />
      </NativeShaderCatalogPreviewProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await vi.waitFor(() => expect(renderPreviews).toHaveBeenCalledOnce());
  expect(renderPreviews).toHaveBeenCalledOnce();
  expect(renderPreviews.mock.calls[0]![0]).toEqual([LIQUID_GLASS_EFFECT]);
  expect(host.querySelectorAll("img")).toHaveLength(1);
  expect(
    host
      .querySelector("[data-native-shader-preview-error]")
      ?.getAttribute("data-native-shader-preview-error"),
  ).toBe("native-catalog-preview-definition-unapproved");
});
