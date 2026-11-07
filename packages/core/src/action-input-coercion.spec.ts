import { describe, expect, it } from "vitest";

import { coerceGatewayStringifiedArgs } from "./action-input-coercion.js";

const parameters = {
  type: "object" as const,
  properties: {
    compact: { type: "string", enum: ["true", "false"] },
    format: { type: "string", enum: ["true", "false"] },
    mode: { type: "string", enum: ["fast", "slow"] },
    force: { type: "boolean" },
    limit: { type: "number" },
  },
};

describe("coerceGatewayStringifiedArgs", () => {
  it("turns a boolean into the string a true/false enum declares", () => {
    expect(
      coerceGatewayStringifiedArgs({ compact: false, limit: 3 }, parameters),
    ).toEqual({ compact: "false", limit: 3 });
    expect(
      coerceGatewayStringifiedArgs(
        { compact: true, format: false },
        parameters,
      ),
    ).toEqual({ compact: "true", format: "false" });
  });

  it("leaves a boolean alone where the enum has no matching string", () => {
    const args = { mode: true };
    expect(coerceGatewayStringifiedArgs(args, parameters)).toBe(args);
  });

  it("still undoes a gateway-stringified boolean and number", () => {
    expect(
      coerceGatewayStringifiedArgs({ force: "true", limit: "20" }, parameters),
    ).toEqual({ force: true, limit: 20 });
  });

  it("returns the same object when nothing changes", () => {
    const args = { compact: "false", force: false, extra: true };
    expect(coerceGatewayStringifiedArgs(args, parameters)).toBe(args);
  });
});
