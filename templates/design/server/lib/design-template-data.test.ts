import { describe, expect, it } from "vitest";

import {
  extractTemplateFonts,
  firstTemplateDimensions,
  redactTemplateDesignData,
  remapTemplateFileIds,
} from "./design-template-data.js";

describe("design template data", () => {
  it("captures quoted CSS font families", () => {
    const fonts = extractTemplateFonts(
      "<style>h1{font-family:\"DM Sans\", sans-serif} p{font-family: 'Helvetica Neue', sans-serif}</style>",
    );

    expect(fonts).toEqual(["DM Sans", "Helvetica Neue"]);
  });

  it("skips a malformed Google Fonts URL instead of throwing", () => {
    const fonts = extractTemplateFonts(
      '<link href="https://fonts.googleapis.com/css2?family=Sora&family=%E0%A4%A">',
    );

    expect(fonts).toEqual(["Sora"]);
  });

  it("remaps file-addressed canvas and screen metadata", () => {
    const data = remapTemplateFileIds(
      JSON.stringify({
        canvasFrames: { old: { width: 1080, height: 1080 } },
        screenMetadata: { old: { name: "Square" } },
        boardFileId: "old",
        lockedScreenIds: ["old"],
      }),
      new Map([["old", "new"]]),
    );

    expect(data).toMatchObject({
      canvasFrames: { new: { width: 1080, height: 1080 } },
      screenMetadata: { new: { name: "Square" } },
      boardFileId: "new",
      lockedScreenIds: ["new"],
    });
    expect(firstTemplateDimensions(data, "new")).toEqual({
      width: 1080,
      height: 1080,
    });
  });

  it("strips local bindings before template persistence or reuse", () => {
    const redacted = redactTemplateDesignData(
      JSON.stringify({
        sourceType: "localhost",
        sourceMode: "localhost",
        connectionId: "root-connection",
        bridgeUrl: "http://127.0.0.1:7331",
        bridgeToken: "example-private-root-bridge-token",
        previewToken: "example-private-root-preview-token",
        localhostScreens: {
          screen: {
            connectionId: "legacy-connection",
            bridgeUrl: "http://127.0.0.1:7331",
          },
        },
        url: "http://127.0.0.1:3000/",
        previewUrl: "http://127.0.0.1:3000/preview",
        screenMetadata: {
          screen: {
            sourceType: "localhost",
            connectionId: "connection-example",
            bridgeUrl: "http://127.0.0.1:7331",
            bridgeToken: "example-private-bridge-token",
            previewToken: "example-private-preview-token",
            url: "http://127.0.0.1:3000/route",
            previewUrl: "http://127.0.0.1:3000/preview",
            title: "Live home screen",
            width: 1080,
            height: 720,
            nested: {
              connectionId: "nested-connection",
              bridgeUrl: "http://127.0.0.1:7331",
              bridgeToken: "example-nested-token",
            },
          },
          staticScreen: {
            sourceType: "inline",
            url: "https://example.com/static-preview.png",
            previewUrl: "https://example.com/preview",
            title: "Static screen",
            width: 320,
          },
          legacyLocalSourceScreen: {
            source: "local",
            url: "http://127.0.0.1:3000/legacy-route",
            previewUrl: "http://127.0.0.1:3000/legacy-preview",
            title: "Legacy local screen",
          },
          legacyBridgeUrlScreen: {
            sourceType: "retired-local-source",
            bridgeUrl: "http://127.0.0.1:7331",
            url: "http://127.0.0.1:3000/bridge-route",
            previewUrl: "http://127.0.0.1:3000/bridge-preview",
            title: "Legacy bridge URL screen",
          },
          fusionBridgeScreen: {
            sourceType: "fusion",
            bridgeUrl: "http://127.0.0.1:7331",
            url: "https://example.com/fusion-screen",
            previewUrl: "https://example.com/fusion-preview",
            title: "Fusion screen",
          },
        },
      }),
    );

    const data = JSON.parse(redacted) as Record<string, unknown>;
    expect(data).toMatchObject({ sourceType: "inline", sourceMode: "inline" });
    expect(data).not.toHaveProperty("connectionId");
    expect(data).not.toHaveProperty("localhostScreens");
    expect(data).not.toHaveProperty("bridgeUrl");
    expect(data).not.toHaveProperty("bridgeToken");
    expect(data).not.toHaveProperty("previewToken");
    expect(data).not.toHaveProperty("url");
    expect(data).not.toHaveProperty("previewUrl");

    const screenMetadata = data.screenMetadata as Record<
      string,
      Record<string, unknown>
    >;
    expect(screenMetadata.screen).toMatchObject({
      sourceType: "inline",
      title: "Live home screen",
      width: 1080,
      height: 720,
      nested: {},
    });
    expect(screenMetadata.screen).not.toHaveProperty("connectionId");
    expect(screenMetadata.screen).not.toHaveProperty("bridgeUrl");
    expect(screenMetadata.screen).not.toHaveProperty("bridgeToken");
    expect(screenMetadata.screen).not.toHaveProperty("previewToken");
    expect(screenMetadata.screen).not.toHaveProperty("url");
    expect(screenMetadata.screen).not.toHaveProperty("previewUrl");
    expect(screenMetadata.staticScreen).toMatchObject({
      sourceType: "inline",
      url: "https://example.com/static-preview.png",
      previewUrl: "https://example.com/preview",
      title: "Static screen",
      width: 320,
    });
    expect(screenMetadata.legacyLocalSourceScreen).toMatchObject({
      source: "inline",
      title: "Legacy local screen",
    });
    expect(screenMetadata.legacyLocalSourceScreen).not.toHaveProperty("url");
    expect(screenMetadata.legacyLocalSourceScreen).not.toHaveProperty(
      "previewUrl",
    );
    expect(screenMetadata.legacyBridgeUrlScreen).toMatchObject({
      sourceType: "inline",
      title: "Legacy bridge URL screen",
    });
    expect(screenMetadata.legacyBridgeUrlScreen).not.toHaveProperty(
      "bridgeUrl",
    );
    expect(screenMetadata.legacyBridgeUrlScreen).not.toHaveProperty("url");
    expect(screenMetadata.legacyBridgeUrlScreen).not.toHaveProperty(
      "previewUrl",
    );
    expect(screenMetadata.fusionBridgeScreen).toMatchObject({
      sourceType: "fusion",
      url: "https://example.com/fusion-screen",
      previewUrl: "https://example.com/fusion-preview",
      title: "Fusion screen",
    });
    expect(screenMetadata.fusionBridgeScreen).not.toHaveProperty("bridgeUrl");
  });

  it("clears root legacy localhost URLs when its bridge URL is stripped", () => {
    const data = JSON.parse(
      redactTemplateDesignData(
        JSON.stringify({
          bridgeUrl: "http://127.0.0.1:7331",
          url: "http://127.0.0.1:3000/route",
          previewUrl: "http://127.0.0.1:3000/preview",
          title: "Legacy local design",
        }),
      ),
    ) as Record<string, unknown>;

    expect(data).toMatchObject({
      sourceType: "inline",
      title: "Legacy local design",
    });
    expect(data).not.toHaveProperty("bridgeUrl");
    expect(data).not.toHaveProperty("url");
    expect(data).not.toHaveProperty("previewUrl");
  });

  it("preserves remote root URLs for explicit non-local sources", () => {
    const data = JSON.parse(
      redactTemplateDesignData(
        JSON.stringify({
          sourceType: "fusion",
          bridgeUrl: "http://127.0.0.1:7331",
          url: "https://example.com/design",
          previewUrl: "https://example.com/preview",
        }),
      ),
    ) as Record<string, unknown>;

    expect(data).toMatchObject({
      sourceType: "fusion",
      url: "https://example.com/design",
      previewUrl: "https://example.com/preview",
    });
    expect(data).not.toHaveProperty("bridgeUrl");
  });
});
