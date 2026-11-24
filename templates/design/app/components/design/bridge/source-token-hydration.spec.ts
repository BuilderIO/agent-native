import { describe, expect, it } from "vitest";

import { hydrateInitialSourceTokens } from "./source-token-hydration";

// oracle-change: removed the byte-identical-to-previous-output case, a copy of the hydrator; the source token literal case pins the output

const INITIAL_SOURCE_HEAD_TOKEN = "__INITIAL_SOURCE_HEAD__";
const INITIAL_SOURCE_OWNERSHIP_TOKEN = "__INITIAL_SOURCE_OWNERSHIP__";
const BRIDGE_TEMPLATE = `const sourceHead = ${INITIAL_SOURCE_HEAD_TOKEN};
const sourceOwnership = ${INITIAL_SOURCE_OWNERSHIP_TOKEN};`;

describe("hydrateInitialSourceTokens", () => {
  it("preserves source token literals and escapes closing script text", () => {
    const initialSourceHead = `<meta content="${INITIAL_SOURCE_OWNERSHIP_TOKEN}"><meta content="</script>">`;
    const initialSourceOwnership = JSON.stringify({
      className: INITIAL_SOURCE_HEAD_TOKEN,
      style: `--authored: "${INITIAL_SOURCE_HEAD_TOKEN}"`,
    });
    const hydrated = hydrateInitialSourceTokens(
      BRIDGE_TEMPLATE,
      initialSourceHead,
      initialSourceOwnership,
    );

    expect(hydrated).toContain(INITIAL_SOURCE_OWNERSHIP_TOKEN);
    expect(hydrated).toContain(INITIAL_SOURCE_HEAD_TOKEN);
    expect(hydrated).toContain("\\u003c/script>");
    expect(hydrated).not.toContain("</script>");
    expect(() => new Function(hydrated)).not.toThrow();
  });
});
