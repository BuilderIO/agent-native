import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addFont,
  analyzeCodeFile,
  classifyFile,
  createCodeAnalysisState,
  detectStylingFramework,
  extractCssVars,
  extractDocumentColors,
  extractDocumentFonts,
  fetchGitHubJsonResult,
  fetchGitHubRaw,
  parseCss,
  parseOwnerRepo,
  parseTailwindConfig,
  suggestionsForType,
  unique,
  validateUrl,
} from "./design-token-utils.js";

describe("design-token GitHub helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses common GitHub repository URL formats", () => {
    expect(parseOwnerRepo("builderio/agent-native")).toEqual({
      owner: "builderio",
      repo: "agent-native",
    });
    expect(parseOwnerRepo("builderio/agent-native.git")).toEqual({
      owner: "builderio",
      repo: "agent-native",
    });
    expect(
      parseOwnerRepo(
        "https://github.com/builderio/agent-native/tree/main?tab=readme",
      ),
    ).toEqual({ owner: "builderio", repo: "agent-native" });
    expect(parseOwnerRepo("git@github.com:builderio/agent-native.git")).toEqual(
      {
        owner: "builderio",
        repo: "agent-native",
      },
    );
    expect(
      parseOwnerRepo("ssh://git@github.com/builderio/agent-native.git"),
    ).toEqual({ owner: "builderio", repo: "agent-native" });
  });

  it("sends the GitHub token only when one is provided", async () => {
    const fetchSpy = vi.fn(async () => {
      return new Response(JSON.stringify([{ name: "package.json" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    await fetchGitHubJsonResult("builderio", "agent-native", "", {
      token: "github-secret",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({
      Authorization: "Bearer github-secret",
      Accept: "application/vnd.github.v3+json",
    });
  });

  it("returns classified GitHub JSON errors without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ message: "Not Found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    await expect(
      fetchGitHubJsonResult("builderio", "private-app", ""),
    ).resolves.toMatchObject({
      ok: false,
      status: 404,
      message: "Not Found",
    });
  });

  it("uses the GitHub token when fetching raw file content", async () => {
    const fetchSpy = vi.fn(async () => {
      return new Response(":root { --brand: #123456; }", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      fetchGitHubRaw("builderio", "agent-native", "app.css", {
        token: "github-secret",
      }),
    ).resolves.toContain("--brand");

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({
      Authorization: "Bearer github-secret",
      Accept: "application/vnd.github.v3.raw",
    });
  });

  it("throws a clear error for unparseable repo references", () => {
    expect(() => parseOwnerRepo("not a repo at all")).toThrow(
      /Could not parse GitHub owner\/repo/,
    );
  });
});

// ---------------------------------------------------------------------------
// SSRF pre-filter — the highest-value security invariant in this module.
// ---------------------------------------------------------------------------
describe("validateUrl (SSRF pre-filter)", () => {
  it("accepts public http(s) URLs", () => {
    expect(() => validateUrl("https://example.com/path")).not.toThrow();
    expect(() => validateUrl("http://github.com")).not.toThrow();
  });

  it("rejects non-http(s) protocols (file:, ftp:, data:)", () => {
    expect(() => validateUrl("file:///etc/passwd")).toThrow(
      /Only http and https/,
    );
    expect(() => validateUrl("ftp://example.com")).toThrow(
      /Only http and https/,
    );
    expect(() => validateUrl("data:text/html,<h1>x</h1>")).toThrow(
      /Only http and https/,
    );
  });

  it("rejects loopback and unspecified hosts", () => {
    for (const host of [
      "http://localhost",
      "http://127.0.0.1",
      "http://0.0.0.0",
      "http://[::1]",
    ]) {
      expect(() => validateUrl(host), host).toThrow(/Internal\/private/);
    }
  });

  it("rejects RFC1918 private ranges", () => {
    for (const host of [
      "http://10.0.0.5",
      "http://192.168.1.1",
      "http://172.16.0.1",
      "http://172.31.255.255",
    ]) {
      expect(() => validateUrl(host), host).toThrow(/Internal\/private/);
    }
  });

  it("rejects cloud metadata endpoints and internal TLDs", () => {
    expect(() =>
      validateUrl("http://169.254.169.254/latest/meta-data"),
    ).toThrow(/Internal\/private/);
    expect(() => validateUrl("http://metadata.google.internal")).toThrow(
      /Internal\/private/,
    );
    expect(() => validateUrl("http://db.internal")).toThrow(
      /Internal\/private/,
    );
    expect(() => validateUrl("http://printer.local")).toThrow(
      /Internal\/private/,
    );
  });

  it("does not block public hosts that merely start with a private-looking octet", () => {
    // 10.x is blocked by prefix, but a public IP like 100.x must pass — the
    // guard must not over-block legitimate public addresses.
    expect(() => validateUrl("http://100.20.30.40")).not.toThrow();
    expect(() => validateUrl("http://11.0.0.1")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tailwind config parser
// ---------------------------------------------------------------------------
describe("parseTailwindConfig", () => {
  it("extracts colors, fontFamily, spacing, and borderRadius blocks", () => {
    const config = `
module.exports = {
  theme: {
    colors: {
      primary: "#5b21b6",
      'accent-2': "#10b981",
    },
    fontFamily: {
      sans: ["Inter", "sans-serif"],
    },
    spacing: {
      "1": "4px",
      "2": "8px",
    },
    borderRadius: {
      lg: "12px",
    },
  },
};`;
    const result = parseTailwindConfig(config);
    expect(result.colors).toMatchObject({
      primary: "#5b21b6",
      "accent-2": "#10b981",
    });
    expect(result.fontFamily).toMatchObject({ sans: "Inter" });
    expect(result.spacing).toMatchObject({ "1": "4px", "2": "8px" });
    expect(result.borderRadius).toMatchObject({ lg: "12px" });
  });

  it("returns an empty object when no token blocks are present", () => {
    expect(parseTailwindConfig("export default { plugins: [] }")).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// CSS parser
// ---------------------------------------------------------------------------
describe("parseCss", () => {
  it("extracts custom properties and @font-face / Google Fonts families", () => {
    const css = `
:root {
  --brand-primary: #123456;
  --space-2: 0.5rem;
}
@font-face {
  font-family: "Custom Sans";
  src: url(/fonts/custom.woff2);
}
@import url('fonts.googleapis.com/css2?family=Inter+Tight&display=swap');
`;
    const result = parseCss(css);
    expect(result.cssCustomProperties).toEqual({
      "--brand-primary": "#123456",
      "--space-2": "0.5rem",
    });
    expect(result.fonts).toContain("Custom Sans");
    // Google Fonts family is URL-decoded and '+' becomes a space.
    expect(result.fonts).toContain("Inter Tight");
  });

  it("dedupes fonts and returns undefined sections when nothing is found", () => {
    const css = `
@font-face { font-family: "Dup"; }
@font-face { font-family: "Dup"; }
`;
    const result = parseCss(css);
    expect(result.fonts).toEqual(["Dup"]);
    // No CSS variables present → undefined, not an empty object.
    expect(result.cssCustomProperties).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Styling framework detection
// ---------------------------------------------------------------------------
describe("detectStylingFramework", () => {
  it("detects tailwind from dependencies or devDependencies", () => {
    expect(
      detectStylingFramework(
        JSON.stringify({ dependencies: { tailwindcss: "^4.0.0" } }),
      ),
    ).toBe("tailwindcss");
    expect(
      detectStylingFramework(
        JSON.stringify({ devDependencies: { "@tailwindcss/cli": "^4.0.0" } }),
      ),
    ).toBe("tailwindcss");
  });

  it("detects emotion, styled-components, sass, and vanilla-extract", () => {
    expect(
      detectStylingFramework(
        JSON.stringify({ dependencies: { "@emotion/react": "11" } }),
      ),
    ).toBe("emotion");
    expect(
      detectStylingFramework(
        JSON.stringify({ dependencies: { "styled-components": "6" } }),
      ),
    ).toBe("styled-components");
    expect(
      detectStylingFramework(
        JSON.stringify({ devDependencies: { "node-sass": "9" } }),
      ),
    ).toBe("sass");
    expect(
      detectStylingFramework(
        JSON.stringify({ dependencies: { "@vanilla-extract/css": "1" } }),
      ),
    ).toBe("vanilla-extract");
  });

  it("returns undefined for unknown deps and for invalid JSON", () => {
    expect(
      detectStylingFramework(JSON.stringify({ dependencies: { react: "19" } })),
    ).toBeUndefined();
    expect(detectStylingFramework("{not valid json")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Code analysis state + helpers
// ---------------------------------------------------------------------------
describe("addFont", () => {
  it("normalizes quotes/whitespace and dedupes case-insensitively", () => {
    const state = createCodeAnalysisState();
    addFont(state, '  "Inter" ', "a.css");
    addFont(state, "inter", "b.css"); // duplicate (case-insensitive)
    addFont(state, "Roboto");
    expect(state.fonts).toEqual([
      { family: "Inter", source: "a.css" },
      { family: "Roboto", source: undefined },
    ]);
  });

  it("ignores empty font names", () => {
    const state = createCodeAnalysisState();
    addFont(state, "   ", "x.css");
    expect(state.fonts).toEqual([]);
  });
});

describe("extractCssVars", () => {
  it("classifies custom properties into colors / spacing / radius buckets", () => {
    const state = createCodeAnalysisState();
    extractCssVars(
      state,
      `:root {
        --primary-color: #ff0000;
        --gap-md: 12px;
        --radius-lg: 8px;
        --z-index: 10;
      }`,
    );
    // Everything goes into cssCustomProperties…
    expect(Object.keys(state.cssCustomProperties)).toEqual([
      "--primary-color",
      "--gap-md",
      "--radius-lg",
      "--z-index",
    ]);
    // …and color/spacing/radius are also bucketed by name heuristics.
    expect(state.colors["--primary-color"]).toBe("#ff0000");
    expect(state.spacing["--gap-md"]).toBe("12px");
    expect(state.borderRadius["--radius-lg"]).toBe("8px");
    // Unclassifiable var stays only in the generic map.
    expect(state.colors["--z-index"]).toBeUndefined();
    expect(state.spacing["--z-index"]).toBeUndefined();
  });
});

describe("analyzeCodeFile (routing by filename)", () => {
  it("routes a tailwind config and records the styling framework", () => {
    const state = createCodeAnalysisState();
    analyzeCodeFile(
      state,
      "src/tailwind.config.ts",
      `export default { theme: { colors: { brand: "#abcdef" } } };`,
    );
    expect(state.stylingFramework).toBe("tailwind");
    expect(state.colors.brand).toBe("#abcdef");
    expect(state.rawExtracts.at(-1)?.type).toBe("tailwind-config");
  });

  it("routes package.json to dependency detection", () => {
    const state = createCodeAnalysisState();
    analyzeCodeFile(
      state,
      "package.json",
      JSON.stringify({ dependencies: { tailwindcss: "^4" } }),
    );
    expect(state.stylingFramework).toBe("tailwind");
    expect(state.rawExtracts.at(-1)).toMatchObject({
      type: "package-json",
      data: { stylingDeps: ["tailwind"] },
    });
  });

  it("routes a .css file through the CSS analyzer", () => {
    const state = createCodeAnalysisState();
    analyzeCodeFile(
      state,
      "app/globals.css",
      `:root { --accent-color: #00ff00; } @font-face { font-family: "Brand"; }`,
    );
    expect(state.colors["--accent-color"]).toBe("#00ff00");
    expect(state.fonts.map((f) => f.family)).toContain("Brand");
    expect(state.rawExtracts.at(-1)?.type).toBe("css");
  });

  it("infers a styling framework from .scss / .less extensions", () => {
    const scss = createCodeAnalysisState();
    analyzeCodeFile(scss, "styles/main.scss", "$primary: #fff;");
    expect(scss.stylingFramework).toBe("sass");

    const less = createCodeAnalysisState();
    analyzeCodeFile(less, "styles/main.less", "@primary: #fff;");
    expect(less.stylingFramework).toBe("less");
  });

  it("records a parse error for malformed JSON themes instead of throwing", () => {
    const state = createCodeAnalysisState();
    expect(() =>
      analyzeCodeFile(state, "theme.json", "{ not: valid"),
    ).not.toThrow();
    expect(state.rawExtracts.at(-1)).toMatchObject({
      type: "json-theme",
      data: { parseError: true },
    });
  });
});

// ---------------------------------------------------------------------------
// Document analysis helpers
// ---------------------------------------------------------------------------
describe("document helpers", () => {
  it("unique trims and dedupes", () => {
    expect(unique([" a ", "a", "b "])).toEqual(["a", "b"]);
  });

  it("extracts hex and named colors, lowercasing named ones", () => {
    const colors = extractDocumentColors(
      "Our brand uses #FF0000 and a deep Navy, plus #abc.",
    );
    expect(colors).toContain("#FF0000");
    expect(colors).toContain("#abc");
    expect(colors).toContain("navy");
  });

  it("extracts known font family names from prose", () => {
    const fonts = extractDocumentFonts(
      "Headlines use Playfair Display, body copy uses Inter.",
    );
    expect(fonts).toEqual(
      expect.arrayContaining(["Playfair Display", "Inter"]),
    );
  });

  it("classifyFile maps file-type hints to content categories", () => {
    expect(classifyFile("application/pdf")).toBe("pdf");
    expect(classifyFile("MyDeck.pptx")).toBe("presentation");
    expect(classifyFile("report.docx")).toBe("document");
    expect(classifyFile("data.csv")).toBe("spreadsheet");
    expect(classifyFile("notes.txt")).toBe("other");
  });

  it("suggestionsForType returns per-type guidance and a no-text hint when empty", () => {
    const withText = suggestionsForType("presentation", true);
    expect(withText.length).toBeGreaterThan(0);
    expect(withText.some((s) => /no text content/i.test(s))).toBe(false);

    const noText = suggestionsForType("presentation", false);
    expect(noText.some((s) => /no text content/i.test(s))).toBe(true);
  });
});
