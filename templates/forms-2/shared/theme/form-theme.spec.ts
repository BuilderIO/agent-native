import { describe, expect, it } from "vitest";

import {
  customCssSchema,
  formThemeSchema,
  hexToHslTriplet,
  normalizeHex,
  resolveTheme,
  sanitizeCss,
  themeRules,
  themeVars,
} from "./form-theme";

describe("sanitizeCss", () => {
  it("keeps ordinary rules unchanged", () => {
    const css =
      ".forms-root { letter-spacing: 0.5px; }\n@media (min-width: 600px) { .forms-title { color: red; } }";
    expect(sanitizeCss(css)).toBe(css);
  });

  it("removes every < so the text cannot close the style element", () => {
    const out = sanitizeCss(".a{color:red}</style><script>alert(1)</script>");
    expect(out).not.toContain("<");
    expect(out.toLowerCase()).not.toContain("</style");
  });

  it("drops a closing brace that has no opener so it cannot end the wrapper rule", () => {
    expect(sanitizeCss("} body { display: none }")).toBe(
      " body { display: none }",
    );
  });

  it("closes braces left open", () => {
    expect(sanitizeCss(".a { color: red;")).toBe(".a { color: red;}");
  });

  it("ignores braces inside strings and comments", () => {
    const css = '.a::before { content: "}"; } /* } */';
    expect(sanitizeCss(css)).toBe(css);
  });

  it("strips NUL bytes", () => {
    expect(sanitizeCss(".a\0b{}")).toBe(".ab{}");
  });
});

describe("customCssSchema", () => {
  it("accepts up to 20 KB and rejects more", () => {
    expect(customCssSchema.safeParse("a".repeat(20 * 1024)).success).toBe(true);
    expect(customCssSchema.safeParse("a".repeat(20 * 1024 + 1)).success).toBe(
      false,
    );
  });

  it("counts bytes, not characters", () => {
    expect(customCssSchema.safeParse("é".repeat(10 * 1024 + 1)).success).toBe(
      false,
    );
  });
});

describe("formThemeSchema", () => {
  it("accepts a full theme", () => {
    const theme = {
      preset: "dark",
      font: "Lora",
      background: "#101010",
      text: "#eeeeee",
      buttonBackground: "#ff0000",
      buttonText: "#ffffff",
      accent: "#00ff00",
      pageWidth: 640,
      baseFontSize: 18,
      buttonRadius: 4,
      fieldRadius: 0,
    };
    expect(formThemeSchema.parse(theme)).toEqual(theme);
  });

  it.each([
    { background: "red" },
    { background: "#fff" },
    { background: "#gggggg" },
    { font: "Comic Sans" },
    { preset: "neon" },
    { pageWidth: 100 },
    { baseFontSize: 40 },
    { buttonRadius: -1 },
    { fieldRadius: 51 },
    { pageWidth: 700.5 },
  ])("rejects %j", (bad) => {
    expect(formThemeSchema.safeParse(bad).success).toBe(false);
  });
});

describe("resolveTheme", () => {
  it("defaults to the light preset", () => {
    expect(resolveTheme(undefined)).toMatchObject({
      preset: "light",
      font: "Inter",
      background: "#ffffff",
      pageWidth: 700,
      baseFontSize: 16,
    });
  });

  it("lets explicit colours override the preset", () => {
    expect(resolveTheme({ preset: "dark", accent: "#ff0000" })).toMatchObject({
      background: "#121212",
      accent: "#ff0000",
    });
  });
});

describe("colour helpers", () => {
  it("normalizes hex input", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("0070D7")).toBe("#0070d7");
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("blue")).toBeNull();
  });

  it("converts hex to an hsl triplet", () => {
    expect(hexToHslTriplet("#ffffff")).toBe("0 0% 100%");
    expect(hexToHslTriplet("#000000")).toBe("0 0% 0%");
    expect(hexToHslTriplet("#ff0000")).toBe("0 100% 50%");
  });

  it("scales the page width so zoom keeps the chosen width", () => {
    const vars = themeVars({ baseFontSize: 20, pageWidth: 800 });
    expect(vars["--fs-scale"]).toBe("1.25");
    expect(vars["--fs-page-width"]).toBe("640px");
  });
});

describe("advanced theme", () => {
  it("emits no rules for an untouched theme", () => {
    expect(themeRules({ preset: "dark", font: "Lora" })).toBe("");
  });

  it("emits rules only for the keys that were set", () => {
    const css = themeRules({ inputHeight: 44, buttonAlign: "center" });
    expect(css).toContain("height:44px");
    expect(css).toContain("justify-content:center");
    expect(css).not.toContain("padding-inline");
  });

  it("accepts translucent colours and rejects urls that could leave a css url()", () => {
    expect(
      formThemeSchema.safeParse({ inputBorderColor: "#3d3b3529" }).success,
    ).toBe(true);
    for (const coverUrl of [
      'https://a.test/x")',
      "javascript:alert(1)",
      "//evil.test/x.png",
    ])
      expect(formThemeSchema.safeParse({ coverUrl }).success).toBe(false);
    expect(
      formThemeSchema.safeParse({ logoUrl: "https://cdn.test/a.png" }).success,
    ).toBe(true);
  });
});
