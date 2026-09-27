/**
 * The document shell every built-in preset shares: fonts, palette tokens, and
 * an artboard sized exactly to the canvas frame. The preset's own markup and
 * CSS are hand-authored per file — do not grow this into a layout generator.
 *
 * The body centers the artboard so the same file renders correctly in a
 * width x height canvas frame (no margin) and in a larger preview viewport.
 */
export function presetDocument({
  title,
  width,
  height,
  fonts,
  palette,
  css,
  body,
  alpine = false,
}: {
  title: string;
  width: number;
  height: number;
  /** Google Fonts css2 `family=` query, without the leading `?`. */
  fonts: string;
  palette: Record<string, string>;
  css: string;
  body: string;
  alpine?: boolean;
}): string {
  const tokens = Object.entries(palette)
    .map(([name, value]) => `--${name}:${value};`)
    .join(" ");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?${fonts}&display=swap" rel="stylesheet" />${
      alpine
        ? `
    <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"></script>`
        : ""
    }
    <style>
      :root { ${tokens} }
      *, *::before, *::after { box-sizing:border-box; }
      [x-cloak] { display:none !important; }
      html, body { margin:0; }
      body { min-height:100vh; display:grid; place-items:center; background:var(--canvas); -webkit-font-smoothing:antialiased; }
      h1, h2, h3, h4, p, ul, ol, dl, dd, figure, blockquote { margin:0; }
      ul, ol { padding:0; list-style:none; }
      .artboard { position:relative; width:${width}px; height:${height}px; overflow:hidden; isolation:isolate; }
${css}
    </style>
  </head>
  <body>
    <main class="artboard" data-agent-native-node-id="template-artboard" data-agent-native-layer-name="Artboard">
${body}
    </main>
  </body>
</html>`;
}
