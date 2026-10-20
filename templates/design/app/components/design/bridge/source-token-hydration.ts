const INITIAL_SOURCE_HEAD_TOKEN = "__INITIAL_SOURCE_HEAD__";

function inlineScriptJson(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function hydrateInitialSourceTokens(
  script: string,
  initialSourceHead: string,
  initialSourceOwnership: string,
): string {
  return script.replace(
    /__INITIAL_SOURCE_HEAD__|__INITIAL_SOURCE_OWNERSHIP__/g,
    (token) =>
      inlineScriptJson(
        token === INITIAL_SOURCE_HEAD_TOKEN
          ? initialSourceHead
          : initialSourceOwnership,
      ),
  );
}
