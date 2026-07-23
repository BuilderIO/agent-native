import { describe, expect, it } from "vitest";

import {
  resolveNewSessionExtensionComposerState,
  type CodeAgentsNewSessionExtension,
} from "./CodeAgentsApp.js";

const extension: CodeAgentsNewSessionExtension = {
  active: true,
  async submit() {
    return { ok: true };
  },
};

describe("CodeAgentsApp new-session extension seam", () => {
  it("hands an active extension the existing composer without showing a second model selector", () => {
    expect(resolveNewSessionExtensionComposerState(extension)).toEqual({
      active: true,
      useDefaultModeControl: false,
      showModelSelector: false,
    });
  });

  it("keeps the standard composer available when no extension is installed", () => {
    expect(resolveNewSessionExtensionComposerState()).toEqual({
      active: false,
      useDefaultModeControl: true,
      showModelSelector: true,
    });
  });
});
