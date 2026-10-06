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
