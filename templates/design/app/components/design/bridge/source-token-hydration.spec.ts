import { describe, expect, it } from "vitest";

import { hydrateInitialSourceTokens } from "./source-token-hydration";

const INITIAL_SOURCE_HEAD_TOKEN = "__INITIAL_SOURCE_HEAD__";
const INITIAL_SOURCE_OWNERSHIP_TOKEN = "__INITIAL_SOURCE_OWNERSHIP__";
const BRIDGE_TEMPLATE = `const sourceHead = ${INITIAL_SOURCE_HEAD_TOKEN};
const sourceOwnership = ${INITIAL_SOURCE_OWNERSHIP_TOKEN};`;

function previousHydrationOutput(
  initialSourceHead: string,
  initialSourceOwnership: string,
): string {
  return BRIDGE_TEMPLATE.replace(/__INITIAL_SOURCE_HEAD__/g, () =>
    JSON.stringify(initialSourceHead).replace(/</g, "\\u003c"),
  ).replace(/__INITIAL_SOURCE_OWNERSHIP__/g, () =>
    JSON.stringify(initialSourceOwnership).replace(/</g, "\\u003c"),
  );
}

describe("hydrateInitialSourceTokens", () => {
  it("keeps standard hydration byte-identical to the previous output", () => {
    const initialSourceHead =
      '<meta name="viewport" content="width=device-width"><style>body{color:red}</style>';
    const initialSourceOwnership = JSON.stringify({
      body: { attrs: ["class", "style"], className: "page", style: "" },
      nodes: [],
    });

    expect(
      hydrateInitialSourceTokens(
        BRIDGE_TEMPLATE,
        initialSourceHead,
        initialSourceOwnership,
      ),
    ).toBe(previousHydrationOutput(initialSourceHead, initialSourceOwnership));
  });

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
