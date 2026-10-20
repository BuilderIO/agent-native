import type { Page } from "@playwright/test";

export async function normalizedStyle(page: Page, css: string | undefined) {
  return page.evaluate((text) => {
    const removeComments = (source: string) => {
      let result = "";
      let quote = "";
      let escaped = false;
      for (let index = 0; index < source.length; index += 1) {
        const character = source[index];
        const next = source[index + 1];
        if (quote) {
          result += character;
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === quote) quote = "";
        } else if (character === "'" || character === '"') {
          quote = character;
          result += character;
        } else if (character === "/" && next === "*") {
          const end = source.indexOf("*/", index + 2);
          if (end === -1) break;
          result += " ";
          index = end + 1;
        } else {
          result += character;
        }
      }
      return result;
    };

    const splitTopLevel = (source: string, separator: string) => {
      const parts: string[] = [];
      let start = 0;
      let quote = "";
      let escaped = false;
      let depth = 0;
      for (let index = 0; index < source.length; index += 1) {
        const character = source[index];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (character === "\\") {
          escaped = true;
          continue;
        }
        if (quote) {
          if (character === quote) quote = "";
          continue;
        }
        if (character === "'" || character === '"') {
          quote = character;
          continue;
        }
        if (character === "(" || character === "[" || character === "{") {
          depth += 1;
        } else if (")]}".includes(character)) {
          depth -= 1;
        } else if (character === separator && depth === 0) {
          parts.push(source.slice(start, index));
          start = index + 1;
        }
      }
      parts.push(source.slice(start));
      return parts;
    };

    const declarationSource = removeComments(text);
    const sourceDeclarations = splitTopLevel(declarationSource, ";")
      .map((declaration) => declaration.trim())
      .filter(Boolean);
    for (const declaration of sourceDeclarations) {
      const colon = splitTopLevel(declaration, ":");
      if (colon.length < 2) {
        throw new Error(`Invalid CSS declaration: ${declaration}`);
      }
      const property = colon[0].trim();
      const value = colon.slice(1).join(":").trim();
      if (!property) throw new Error(`Invalid CSS declaration: ${declaration}`);
      const valueWithoutPriority = value
        .replace(/\s*!important\s*$/i, "")
        .trim();
      if (!CSS.supports(property, valueWithoutPriority)) {
        throw new Error(`Unsupported CSS declaration: ${declaration}`);
      }
    }

    const parsed = document.createElement("div");
    parsed.style.cssText = text;
    const parsedProperties = new Set<string>();
    for (let index = 0; index < parsed.style.length; index += 1) {
      parsedProperties.add(parsed.style.item(index));
    }

    const host = document.createElement("div");
    host.style.cssText =
      "all: initial !important; display: block !important; position: fixed !important; width: 1000px !important; height: 1000px !important; top: -10000px !important; left: -10000px !important; contain: strict !important; visibility: hidden !important; pointer-events: none !important; direction: ltr !important; writing-mode: horizontal-tb !important; font: 16px/normal sans-serif !important";
    const shadow = host.attachShadow({ mode: "open" });
    const probe = document.createElement("div");
    probe.style.cssText = `all: initial; display: block; direction: ltr; writing-mode: horizontal-tb; box-sizing: content-box; font: 16px/normal sans-serif; ${text}`;
    shadow.append(probe);
    (document.body ?? document.documentElement).append(host);

    try {
      const computed = getComputedStyle(probe);
      const allComputedProperties: [string, string][] = [];
      if (parsedProperties.has("all")) {
        for (let index = 0; index < computed.length; index += 1) {
          const property = computed.item(index);
          allComputedProperties.push([
            property,
            computed.getPropertyValue(property),
          ]);
        }
        allComputedProperties.sort(([left], [right]) =>
          left.localeCompare(right),
        );
      }

      const declarations: [string, string, string, string][] = [];
      for (let index = 0; index < parsed.style.length; index += 1) {
        const property = parsed.style.item(index);
        declarations.push([
          property,
          parsed.style.getPropertyValue(property),
          parsed.style.getPropertyPriority(property),
          property === "all"
            ? JSON.stringify(allComputedProperties)
            : computed.getPropertyValue(property),
        ]);
      }
      return declarations.sort(([left], [right]) => left.localeCompare(right));
    } finally {
      host.remove();
    }
  }, css ?? "");
}
