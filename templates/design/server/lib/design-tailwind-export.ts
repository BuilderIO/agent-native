import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";

import { compile } from "tailwindcss";

const MAX_CANDIDATES = 2048;
const MAX_CANDIDATE_LENGTH = 256;
const MAX_AUTHORED_CSS_BYTES = 100_000;
const MAX_COMPILED_CSS_BYTES = 1_500_000;

const require = createRequire(import.meta.url);
const tailwindPath = require.resolve("tailwindcss/index.css");
let tailwindSource: Promise<string> | undefined;

export class StaticTailwindExportError extends Error {
  constructor(
    readonly code: "source-unsupported" | "package-too-large",
    message: string,
  ) {
    super(message);
    this.name = "StaticTailwindExportError";
  }
}

export async function compileStaticTailwind(args: {
  classes: readonly string[];
  authoredCss: string;
}): Promise<string> {
  const candidates = [...new Set(args.classes)];
  if (
    candidates.length > MAX_CANDIDATES ||
    candidates.some(
      (candidate) => !candidate || candidate.length > MAX_CANDIDATE_LENGTH,
    ) ||
    new TextEncoder().encode(args.authoredCss).byteLength >
      MAX_AUTHORED_CSS_BYTES
  )
    throw new StaticTailwindExportError(
      "package-too-large",
      "Native export Tailwind source exceeds its static compilation limit.",
    );
  if (
    /@(?:import|plugin|config|source|reference)\b|url\s*\(/i.test(
      args.authoredCss,
    )
  )
    throw new StaticTailwindExportError(
      "source-unsupported",
      "Native export cannot resolve Tailwind imports, plugins, config, source directives, or CSS URLs.",
    );
  try {
    tailwindSource ??= readFile(tailwindPath, "utf8");
    const source = await tailwindSource;
    const compiler = await compile(`${source}\n${args.authoredCss}`, {
      base: dirname(tailwindPath),
    });
    const css = compiler.build(candidates);
    if (new TextEncoder().encode(css).byteLength > MAX_COMPILED_CSS_BYTES)
      throw new StaticTailwindExportError(
        "package-too-large",
        "Native export compiled Tailwind CSS exceeds its package limit.",
      );
    if (/<\/style/i.test(css))
      throw new StaticTailwindExportError(
        "source-unsupported",
        "Native export compiled Tailwind CSS cannot be embedded safely.",
      );
    return css;
  } catch (error) {
    if (error instanceof StaticTailwindExportError) throw error;
    throw new StaticTailwindExportError(
      "source-unsupported",
      `Native export could not compile static Tailwind CSS: ${String(error)}`,
    );
  }
}
