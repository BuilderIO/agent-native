import type {
  BlockRenderContext,
  DataModelData,
} from "@agent-native/core/blocks/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DataModelRead } from "./DataModelBlock.js";

describe("DataModelRead", () => {
  it("renders a legacy data model without entities", () => {
    const data = {} as unknown as DataModelData;

    expect(() =>
      renderToStaticMarkup(
        createElement(DataModelRead, {
          data,
          blockId: "model-1",
          ctx: {} as BlockRenderContext,
        }),
      ),
    ).not.toThrow();
  });
});
