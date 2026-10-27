import { actionsToEngineTools } from "@agent-native/core/server";
import { describe, expect, it } from "vitest";

import { SLIDES_REALTIME_VOICE } from "./realtime-voice.js";

describe("slides realtime voice", () => {
  it("preloads actions that exist and fit the voice tool budget", async () => {
    let bytes = 0;
    for (const name of SLIDES_REALTIME_VOICE.priorityToolNames) {
      const { default: action } = await import(`../../actions/${name}.ts`);
      const [tool] = actionsToEngineTools({ [name]: action });
      expect(tool?.name).toBe(name);
      bytes += Buffer.byteLength(
        JSON.stringify({
          description: tool!.description.slice(0, 2_000),
          parameters: tool!.inputSchema,
        }),
      );
    }
    // Under two fifths of the 64 KB voice session leaves room for the
    // framework's tools and the discoveries a session adds.
    expect(bytes).toBeLessThan(26_000);
  });
});
