import { describe, expect, it } from "vitest";
import { z } from "zod";

import { readEnvConfigLayer } from "./env-layer.js";
import { runtimeConfig } from "./runtime.js";

const schema = z.object({ runtime: runtimeConfig.prefault({}) });

describe("Builder dev container runtime configuration", () => {
  it("reads the container environment and pod id from the platform variables", () => {
    const runtime = schema.parse(
      readEnvConfigLayer(schema, {
        FUSION_ENVIRONMENT: " cloud-v2 ",
        FUSION_POD_UID: " pod-1 ",
      }),
    ).runtime;
    expect(runtime.builderEnvironment).toBe("cloud-v2");
    expect(runtime.builderPodUid).toBe("pod-1");
  });

  it("leaves both unset outside a container", () => {
    const runtime = schema.parse(
      readEnvConfigLayer(schema, {
        FUSION_ENVIRONMENT: "",
        FUSION_POD_UID: "",
      }),
    ).runtime;
    expect(runtime.builderEnvironment).toBeUndefined();
    expect(runtime.builderPodUid).toBeUndefined();
  });
});
