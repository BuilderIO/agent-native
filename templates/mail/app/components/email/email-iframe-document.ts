/**
 * Builds the inert document rendered by Mail's same-origin, script-disabled
 * message iframe. Using srcDoc gives rrweb a normal iframe navigation/load
 * lifecycle; the host adds theme styles and interaction listeners after load.
 */
export function buildEmailIframeDocument(
  headHtml: string,
  bodyHtml: string,
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  ${headHtml}
</head>
<body>${bodyHtml}</body>
</html>`;
}
