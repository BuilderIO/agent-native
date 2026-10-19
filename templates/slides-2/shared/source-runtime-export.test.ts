import { describe, expect, it } from "vitest";

import {
  sourceRuntimeExportError,
  SOURCE_RUNTIME_EXPORT_ERROR_CODE,
} from "./source-runtime-export.js";

describe("sourceRuntimeExportError", () => {
  it("requires Worker rendering when a source slide has no static preview", () => {
    const error = sourceRuntimeExportError(
      [{ id: "source-only", sourceTsx: "export default function Slide() {}" }],
      "html",
    );

    expect(error).toMatchObject({
      errorCode: SOURCE_RUNTIME_EXPORT_ERROR_CODE,
      format: "html",
      slideIds: ["source-only"],
      slideCount: 1,
    });
  });

  it("allows a source slide with a static preview when runtime rendering is not required", () => {
    expect(
      sourceRuntimeExportError(
        [
          {
            id: "source-with-preview",
            sourceTsx: "export default function Slide() {}",
            content: "<main>Static preview</main>",
          },
        ],
        "pptx",
      ),
    ).toBeNull();
  });

  it("does not export a stale preview when the slide is marked runtime-required", () => {
    const error = sourceRuntimeExportError(
      [
        {
          id: "stale-preview",
          sourceTsx: "export default function Slide() {}",
          sourceRuntimeRequired: true,
          content: "<main>Preview from an earlier source revision</main>",
        },
      ],
      "pdf",
    );

    expect(error).toMatchObject({
      errorCode: SOURCE_RUNTIME_EXPORT_ERROR_CODE,
      format: "pdf",
      slideIds: ["stale-preview"],
      slideCount: 1,
    });
  });
});
