import { describe, expect, it } from "vitest";

import { EXTENSION, flattenTokens, type DtcgToken } from "./dtcg.js";
import {
  exportForFigma,
  formatTokenFile,
  importFromFigma,
  TokenImportError,
} from "./round-trip.js";
import { readTokenFiles, TOKEN_FILES } from "./source.js";

const MAIL_LIGHT = "Theme mail/Light.tokens.json";
const MAIL_DARK = "Theme mail/Dark.tokens.json";

const clone = <T>(value: T): T => structuredClone(value);

/** The export as Figma writes it back: no extension of ours, its own variable ids. */
function asFigmaWrites(group: unknown): unknown {
  const tokens = flattenTokens(clone(group), "export");
  const root: Record<string, unknown> = {};
  for (const [tokenPath, token] of tokens) {
    const names = tokenPath.split(".");
    let node = root;
    for (const name of names.slice(0, -1)) {
      node = (node[name] ??= {}) as Record<string, unknown>;
    }
    const { $extensions: _ours, ...rest } = token;
    node[names[names.length - 1] as string] = {
      ...rest,
      $extensions: { "com.figma.variableId": `VariableID:${tokenPath}` },
    };
  }
  return root;
}

function setToken(
  group: unknown,
  tokenPath: string,
  update: (token: DtcgToken) => void,
) {
  let node = group as Record<string, unknown>;
  for (const name of tokenPath.split(".")) {
    node = node[name] as Record<string, unknown>;
  }
  update(node as unknown as DtcgToken);
}

function problems(run: () => unknown): readonly string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof TokenImportError) return error.problems;
    throw error;
  }
  throw new Error("expected the import to be refused");
}

describe("token round trip", () => {
  it("exports one file per mode of each collection", () => {
    const files = exportForFigma(TOKEN_FILES);
    expect(files.get("Foundations/Value.tokens.json")).toBe(
      TOKEN_FILES["foundations.tokens.json"],
    );
    expect(files.get(MAIL_LIGHT)).toBe(
      TOKEN_FILES["themes/mail.light.tokens.json"],
    );
    expect(files.size).toBe(Object.keys(TOKEN_FILES).length);
  });

  it("imports an unchanged export as the same files", () => {
    const result = importFromFigma(exportForFigma(TOKEN_FILES), TOKEN_FILES);
    expect(result.changed.size).toBe(0);
    for (const [file, group] of result.files) {
      expect(group).toEqual(TOKEN_FILES[file]);
    }
  });

  it("keeps the HSL text and takes Figma's ids when Figma rewrites an unchanged color", () => {
    const exported = new Map([
      [MAIL_LIGHT, asFigmaWrites(TOKEN_FILES["themes/mail.light.tokens.json"])],
      [MAIL_DARK, asFigmaWrites(TOKEN_FILES["themes/mail.dark.tokens.json"])],
    ]);
    const result = importFromFigma(exported, TOKEN_FILES);
    expect(result.changed.size).toBe(0);
    const primary = flattenTokens(
      result.files.get("themes/mail.light.tokens.json"),
      "mail",
    ).get("color.primary");
    expect(primary?.$extensions).toEqual({
      [EXTENSION]: { hsl: expect.any(String) },
      "com.figma.variableId": "VariableID:color.primary",
    });
    expect(
      readTokenFiles({
        ...TOKEN_FILES,
        ...Object.fromEntries(result.files),
      }).themes.mail,
    ).toEqual(readTokenFiles(TOKEN_FILES).themes.mail);
  });

  it("writes a changed color as its new value and reads it back", () => {
    const light = clone(TOKEN_FILES["themes/mail.light.tokens.json"]);
    setToken(light, "color.primary", (token) => {
      token.$value = "#ff0000";
    });
    const result = importFromFigma(
      new Map([
        [MAIL_LIGHT, light],
        [MAIL_DARK, TOKEN_FILES["themes/mail.dark.tokens.json"]],
      ]),
      TOKEN_FILES,
    );
    expect(result.changed).toEqual(
      new Map([["themes/mail.light.tokens.json", ["color.primary"]]]),
    );
    const read = readTokenFiles({
      ...TOKEN_FILES,
      ...Object.fromEntries(result.files),
    });
    expect(read.themes.mail?.light.primary).toBe("0 100% 50%");
    expect(read.themes.mail?.dark).toEqual(
      readTokenFiles(TOKEN_FILES).themes.mail?.dark,
    );
  });

  it("writes a changed number", () => {
    const foundations = clone(TOKEN_FILES["foundations.tokens.json"]);
    setToken(foundations, "radius.1", (token) => {
      token.$value = 3;
    });
    const result = importFromFigma(
      new Map([["Foundations/Mode 1.tokens.json", foundations]]),
      TOKEN_FILES,
    );
    expect(result.changed.get("foundations.tokens.json")).toEqual(["radius.1"]);
  });

  it("refuses tokens code does not read and tokens it lost", () => {
    const light = clone(TOKEN_FILES["themes/mail.light.tokens.json"]) as {
      color: Record<string, unknown>;
    };
    light.color["brand-glow"] = light.color.primary;
    delete light.color.ring;
    expect(
      problems(() =>
        importFromFigma(
          new Map([
            [MAIL_LIGHT, light],
            [MAIL_DARK, TOKEN_FILES["themes/mail.dark.tokens.json"]],
          ]),
          TOKEN_FILES,
        ),
      ),
    ).toEqual([
      `${MAIL_LIGHT}: color.brand-glow is not a token code reads`,
      `${MAIL_LIGHT}: color.ring is missing`,
    ]);
  });

  it("refuses a changed type, an alias, and an alpha", () => {
    const light = clone(TOKEN_FILES["themes/mail.light.tokens.json"]);
    setToken(light, "radius", (token) => {
      token.$type = "string";
    });
    setToken(light, "color.ring", (token) => {
      token.$value = "{color.primary}";
    });
    setToken(light, "color.border", (token) => {
      token.$value = { ...(token.$value as object), alpha: 0.5 } as never;
    });
    expect(
      problems(() =>
        importFromFigma(
          new Map([
            [MAIL_LIGHT, light],
            [MAIL_DARK, TOKEN_FILES["themes/mail.dark.tokens.json"]],
          ]),
          TOKEN_FILES,
        ),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("color.border has an alpha"),
        expect.stringContaining("color.ring is an alias of {color.primary}"),
        expect.stringContaining("radius is a string, expected a number"),
      ]),
    );
  });

  it("refuses an unknown collection and a collection missing a mode", () => {
    expect(
      problems(() =>
        importFromFigma(
          new Map([
            ["Theme quickbooks/Light.tokens.json", {}],
            [MAIL_LIGHT, TOKEN_FILES["themes/mail.light.tokens.json"]],
          ]),
          TOKEN_FILES,
        ),
      ),
    ).toEqual([
      "Theme quickbooks/Light.tokens.json: not a known collection file (<collection>/<mode>.tokens.json)",
      `${MAIL_DARK}: is missing; export every mode of the collection`,
    ]);
  });

  it("refuses a palette status the palette cannot build", () => {
    const palette = clone(TOKEN_FILES["palette.tokens.json"]);
    setToken(palette, "status.danger", (token) => {
      token.$value = "not-a-color";
    });
    expect(
      problems(() =>
        importFromFigma(
          new Map([["Palette/Value.tokens.json", palette]]),
          TOKEN_FILES,
        ),
      ),
    ).toHaveLength(1);
  });

  it("formats files the way the formatter does", () => {
    expect(
      formatTokenFile({
        a: { $type: "color", $value: { components: [1, 0.5, 0] } },
      }),
    ).toBe(
      '{\n  "a": {\n    "$type": "color",\n    "$value": {\n      "components": [1, 0.5, 0]\n    }\n  }\n}\n',
    );
  });
});
