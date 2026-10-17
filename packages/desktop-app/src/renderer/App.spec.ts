import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("desktop chat-first shell", () => {
  it("reports a failed app removal instead of leaving it unhandled", () => {
    const appSource = readFileSync(
      new URL("./App.tsx", import.meta.url),
      "utf8",
    );

    const handlerStart = appSource.indexOf("const handleAppRemoval");
    expect(handlerStart).toBeGreaterThan(-1);
    const handlerEnd = appSource.indexOf("[apps],\n  );", handlerStart);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    const handlerSource = appSource.slice(handlerStart, handlerEnd);

    // api.update/api.remove IPC-invoke the main process and can reject
    // (disk full, permission denied); that rejection must be caught and
    // surfaced, not left as an unhandled promise rejection.
    expect(handlerSource).toContain("try {");
    expect(handlerSource).toContain("catch");
    expect(handlerSource).toContain("toast.error(");
  });
});
