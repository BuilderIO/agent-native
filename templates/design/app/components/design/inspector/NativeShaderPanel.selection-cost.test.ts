import * as codeLayer from "@shared/code-layer";
import { NATIVE_EFFECT_LATEST_DEFINITIONS } from "@shared/native-effect-presets";
import { writeEffectsToHtml } from "@shared/native-effects";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  hasSelectedNativeEffects,
  selectedNativeInstances,
} from "./NativeShaderPanel";

vi.mock("@shared/code-layer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@shared/code-layer")>();
  return {
    ...actual,
    resolveCodeLayerTarget: vi.fn(actual.resolveCodeLayerTarget),
  };
});

const resolveCodeLayerTarget = vi.mocked(codeLayer.resolveCodeLayerTarget);

const PLAIN_SCREEN_HTML = `<!DOCTYPE html>
<html><body>
  <div data-agent-native-node-id="card-1" class="card">Finalize Q3 roadmap deck</div>
  <div data-agent-native-node-id="card-2" class="card">Review pull request #482</div>
</body></html>`;

function screenWithBackdropOn(nodeId: string): string {
  const definition = NATIVE_EFFECT_LATEST_DEFINITIONS.find(
    (candidate) => candidate.id === "an-native-frosted-refraction",
  );
  if (!definition) throw new Error("frosted refraction preset is missing");
  return writeEffectsToHtml(PLAIN_SCREEN_HTML, {
    schemaVersion: 2,
    definitions: [definition],
    instances: [
      {
        id: "frost",
        nodeId,
        definitionId: definition.id,
        definitionVersion: definition.version,
        placement: "backdrop",
        params: {},
        enabled: true,
        opacity: 1,
        seed: 0,
        clip: "bounds",
        blend: "normal",
        timing: { speed: 1, paused: true, time: 0 },
      },
    ],
  });
}

beforeEach(() => {
  resolveCodeLayerTarget.mockClear();
});

describe("selected native effects on the inspector's render path", () => {
  it("does not scan the screen's layers when no effect could match", () => {
    expect(
      hasSelectedNativeEffects(
        PLAIN_SCREEN_HTML,
        "runtime-id",
        "div.card:nth-of-type(2)",
      ),
    ).toBe(false);
    expect(resolveCodeLayerTarget).not.toHaveBeenCalled();
  });

  it("does not scan when the selection's own id already names the effect's layer", () => {
    const html = screenWithBackdropOn("card-1");

    expect(
      selectedNativeInstances(html, "card-1", "backdrop", "div.card").instances,
    ).toHaveLength(1);
    expect(resolveCodeLayerTarget).not.toHaveBeenCalled();
  });

  it("still finds an effect through the selector when the selection carries another id", () => {
    const html = screenWithBackdropOn("card-2");

    expect(
      selectedNativeInstances(
        html,
        "runtime-id",
        "backdrop",
        '[data-agent-native-node-id="card-2"]',
      ).instances.map((instance) => instance.id),
    ).toEqual(["frost"]);
    expect(resolveCodeLayerTarget).toHaveBeenCalledTimes(1);
  });
});
