import { describe, expect, it } from "vitest";
import {
  coerceLocalContentComponentProps,
  normalizeLocalContentComponentInputs,
  serializeLocalMdxComponentSource,
} from "./local-component-config";

describe("local component config", () => {
  it("normalizes supported input definitions", () => {
    expect(
      normalizeLocalContentComponentInputs({
        label: { label: "Label" },
        count: { type: "number", default: 3 },
        active: { type: "boolean", default: true },
        tone: {
          type: "select",
          options: ["blue", { label: "Green", value: "green" }],
        },
        ignored: "nope",
      }),
    ).toEqual({
      label: { type: "string", label: "Label" },
      count: { type: "number", default: 3 },
      active: { type: "boolean", default: true },
      tone: {
        type: "select",
        options: ["blue", { label: "Green", value: "green" }],
      },
    });
  });

  it("coerces string MDX attributes with the component input schema", () => {
    expect(
      coerceLocalContentComponentProps(
        {
          label: "wins",
          count: "7",
          active: "false",
        },
        {
          label: { type: "string" },
          count: { type: "number" },
          active: { type: "boolean", default: true },
        },
      ),
    ).toEqual({
      label: "wins",
      count: 7,
      active: false,
    });
  });

  it("treats cleared number inputs as unset", () => {
    expect(
      coerceLocalContentComponentProps(
        {
          label: "wins",
          count: "",
        },
        {
          label: { type: "string" },
          count: { type: "number", default: 3 },
        },
      ),
    ).toEqual({
      label: "wins",
    });
  });

  it("serializes edited inputs back to an MDX component tag", () => {
    expect(
      serializeLocalMdxComponentSource({
        name: "ImpactCounter",
        props: {
          label: "wins",
          count: 7,
          active: false,
          empty: "",
        },
      }),
    ).toBe('<ImpactCounter label="wins" count="7" active="false" />');
  });
});
