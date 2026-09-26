
export const DIAGNOSTIC_SNIPPET_OPEN = "<<<diagnostic-snippet";
export const DIAGNOSTIC_SNIPPET_CLOSE = ">>>end-diagnostic-snippet";

export function wrapDiagnosticSnippet(text: string): string {
  const indented = text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  return `${DIAGNOSTIC_SNIPPET_OPEN}\n${indented}\n${DIAGNOSTIC_SNIPPET_CLOSE}`;
}

export function stripDiagnosticSnippets(text: string): string {
  const withoutPairs = text.replace(
    /<<<diagnostic-snippet[\s\S]*?^>>>end-diagnostic-snippet$/gm,
    "",
  );
  return withoutPairs.replace(/<<<diagnostic-snippet[\s\S]*$/, "");
}
