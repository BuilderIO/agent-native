import { describe, expect, it } from "vitest";

import { inspectorFitsViewport, resolveEditorChrome } from "./editor-chrome";

const standalone = {
  shellMode: false,
  embedded: false,
  embedChromeRequested: false,
  widgetEmbed: false,
};

describe("resolveEditorChrome", () => {
  it("gives the standalone editor the full docked layout", () => {
    expect(resolveEditorChrome(standalone)).toEqual({
      hostOwnsChrome: false,
      minimalUiByDefault: false,
      minimalUiLocked: false,
    });
  });

  it("leaves a plain host embed to the host", () => {
    expect(resolveEditorChrome({ ...standalone, embedded: true })).toEqual({
      hostOwnsChrome: true,
      minimalUiByDefault: false,
      minimalUiLocked: false,
    });
  });

  it("opens the visual-edit shell in minimal UI", () => {
    expect(
      resolveEditorChrome({ ...standalone, shellMode: true, embedded: true }),
    ).toEqual({
      hostOwnsChrome: false,
      minimalUiByDefault: true,
      minimalUiLocked: false,
    });
  });

  it.each([
    ["with embed auth", { embedded: true }],
    ["without embed auth", { embedded: false }],
    ["with chrome requested", { embedded: true, embedChromeRequested: true }],
  ])(
    "gives an MCP widget %s the same minimal-UI editor as the shell, not a layout of its own",
    (_name, override) => {
      const shell = resolveEditorChrome({
        ...standalone,
        shellMode: true,
        embedded: true,
      });
      const widget = resolveEditorChrome({
        ...standalone,
        ...override,
        widgetEmbed: true,
      });
      expect(widget.hostOwnsChrome).toBe(shell.hostOwnsChrome);
      expect(widget.minimalUiByDefault).toBe(shell.minimalUiByDefault);
    },
  );

  it("keeps a widget in minimal UI, since the full layout brings back the app rail and its agent chat", () => {
    expect(
      resolveEditorChrome({ ...standalone, widgetEmbed: true }).minimalUiLocked,
    ).toBe(true);
  });
});

describe("inspectorFitsViewport", () => {
  it.each([true, false])(
    "floats the minimal-UI inspector at every width (mobile viewport: %s)",
    (isMobileViewport) => {
      expect(inspectorFitsViewport({ minimalUi: true, isMobileViewport })).toBe(
        true,
      );
    },
  );

  it("hands the docked rail's narrow-screen fallback to the sheet", () => {
    expect(
      inspectorFitsViewport({ minimalUi: false, isMobileViewport: true }),
    ).toBe(false);
    expect(
      inspectorFitsViewport({ minimalUi: false, isMobileViewport: false }),
    ).toBe(true);
  });
});
