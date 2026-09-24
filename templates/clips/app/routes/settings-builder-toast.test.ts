import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Clips Builder connection toast", () => {
  it("gates the success toast on an explicit connect request", () => {
    const source = readFileSync(
      new URL("./_app.settings._index.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const connectRequestedRef = useRef(false);");
    expect(source).toContain("connectRequestedRef.current = true;");
    expect(source).toContain(
      "const shouldShowConnectedToast = connectRequestedRef.current;",
    );
    expect(source).toContain(
      'if (shouldShowConnectedToast) {\n        toast.success(t("settings.builderConnectedToast"));',
    );
  });
});
