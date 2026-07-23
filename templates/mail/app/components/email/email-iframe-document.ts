/**
 * Builds the inert document rendered by Mail's same-origin, script-disabled
 * message iframe. Using srcDoc gives rrweb a normal iframe navigation/load
 * lifecycle; the host includes theme styles up front and adds interaction
 * listeners after load.
 */
export function buildEmailIframeDocument(
  headHtml: string,
  bodyHtml: string,
  themeCss = "",
): string {
  const themeStyle = themeCss
    ? `  <style data-mail-theme>\n${themeCss}\n  </style>\n`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  ${headHtml}
${themeStyle}</head>
<body>${bodyHtml}</body>
</html>`;
}
