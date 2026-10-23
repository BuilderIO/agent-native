import { fail } from "@agent-native/core/action";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { parse, serialize, type DefaultTreeAdapterTypes } from "parse5";
import postcss, { type Declaration } from "postcss";

import { parseHubLInterpolation } from "./hubl-interpolation.js";

type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.Node;
type Specificity = [number, number, number];
type SelectorPart = { compound: string; combinator: " " | ">" | "+" | "~" };
type ImageReference = { url: string; location: string };
type EmailExportOptions = { preserveLinksFromHtml?: string };

function invalid(message: string): never {
  return fail(message, { errorCode: "invalid_hubspot_email", statusCode: 422 });
}

const HUBSPOT_EMAIL_URL_VARIABLES = new Set([
  "unsubscribe_link",
  "unsubscribe_link_all",
  "unsubscribe_link_single",
  "view_as_page_url",
  "subscription_confirmation_url",
  "content.absolute_url",
]);
function isLiteralLinkDestination(value: string | undefined): boolean {
  const destination = value?.trim();
  if (!destination) return false;
  try {
    const url = new URL(destination);
    if (url.protocol === "http:" || url.protocol === "https:")
      return (
        /^https?:\/\//i.test(destination) &&
        !!url.hostname &&
        !url.username &&
        !url.password
      );
    return ["mailto:", "tel:"].includes(url.protocol) && !!url.pathname.trim();
  } catch {
    return false;
  }
}

function validateContactInterpolation(token: string): void {
  const parsed = parseHubLInterpolation(token);
  if (
    !parsed?.personalization ||
    parsed.filtered ||
    parsed.fallback === undefined
  )
    invalid(
      "Email contact personalization needs personalization_token('contact.field', 'fallback') without filters; HubSpot does not support contact personalization filters in emails.",
    );
}

function validateLinkDestination(value: string, at: string): void {
  const destination = value.trim();
  if (destination.startsWith("#") || isLiteralLinkDestination(destination))
    return;
  const parsed = parseHubLInterpolation(destination);
  if (parsed) {
    if (!parsed.personalization && HUBSPOT_EMAIL_URL_VARIABLES.has(parsed.name))
      return;
    if (/^contact\.[\w.]+$/.test(parsed.name)) {
      validateContactInterpolation(destination);
      if (isLiteralLinkDestination(parsed.fallback)) return;
      invalid(
        `Link at ${at} needs a literal URL fallback for contact personalization (absolute HTTP(S), mailto, or tel).`,
      );
    }
  }
  if (destination.startsWith("{{"))
    invalid(
      `Link at ${at} has an unsupported HubL URL destination. Use a documented HubSpot email URL variable or a contact URL with a default fallback.`,
    );
  invalid(
    `Link at ${at} needs an HTTPS, mailto, tel, or supported HubL destination.`,
  );
}

function attribute(element: Element, name: string): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value;
}

function elements(node: Node): Element[] {
  const result: Element[] = [];
  if ("tagName" in node) result.push(node);
  if ("childNodes" in node) {
    for (const child of node.childNodes) result.push(...elements(child));
  }
  return result;
}

function parseHtmlWithHubL(content: string) {
  const tokens: string[] = [];
  const protectedContent = content.replace(/{{[\s\S]*?}}/g, (token) => {
    const key = `ANHUBL${tokens.length}TOKEN`;
    if (content.includes(key))
      invalid("The HTML contains a reserved token placeholder.");
    tokens.push(token);
    return key;
  });
  const restoreTokens = (value: string) =>
    value.replace(
      /ANHUBL(\d+)TOKEN/g,
      (_, index: string) => tokens[Number(index)],
    );
  return { document: parse(protectedContent), tokens, restoreTokens };
}

function approvedAnchorDestinations(
  document: Node,
  restoreTokens: (value: string) => string,
): Set<string> {
  const destinations = new Set<string>();
  for (const element of elements(document)) {
    if (element.tagName !== "a") continue;
    const href = restoreTokens(attribute(element, "href") ?? "").trim();
    const parsed = parseHubLInterpolation(href);
    const destination =
      parsed?.personalization &&
      !parsed.filtered &&
      /^contact\./.test(parsed.name)
        ? parsed.fallback
        : href;
    if (isLiteralLinkDestination(destination))
      destinations.add(new URL(destination!.trim()).href);
  }
  return destinations;
}

function assertPreservedAnchorDestinations(
  source: string,
  target: Node,
  restoreTokens: (value: string) => string,
): void {
  if (source.length > 1_000_000)
    invalid(
      "The link-preservation source is too large to parse (maximum 1 MB).",
    );
  const parsedSource = parseHtmlWithHubL(source);
  const expected = approvedAnchorDestinations(
    parsedSource.document,
    parsedSource.restoreTokens,
  );
  const actual = approvedAnchorDestinations(target, restoreTokens);
  const missing = [...expected].filter(
    (destination) => !actual.has(destination),
  );
  if (missing.length) {
    const labels = missing.slice(0, 10).map((destination) => {
      const url = new URL(destination);
      url.search = "";
      url.hash = "";
      return url.href.slice(0, 180);
    });
    invalid(
      `The email is missing ${missing.length} approved source link destinations: ${labels.join(", ")}${missing.length > 10 ? ", …" : ""}. Restore the original destinations before exporting; URL query values and fragments are omitted from this message.`,
    );
  }
}

function location(element: Element): string {
  return `${element.tagName}${attribute(element, "id") ? `#${attribute(element, "id")}` : ""}`;
}

function parentElement(element: Element): Element | undefined {
  return element.parentNode && "tagName" in element.parentNode
    ? element.parentNode
    : undefined;
}

function previousElements(element: Element): Element[] {
  const siblings = element.parentNode?.childNodes ?? [];
  return siblings
    .slice(0, siblings.indexOf(element))
    .filter((node): node is Element => "tagName" in node)
    .reverse();
}

const COMPOUND_TOKEN =
  /^(\*|[a-zA-Z][\w-]*|[.#][\w-]+|\[\s*[\w-]+(?:\s*(?:[~|^$*]?=)\s*(?:"[^"]*"|'[^']*'|[\w-]+))?\s*\])/;

function parseSelector(selector: string): {
  parts: SelectorPart[];
  specificity: Specificity;
} {
  const specificity: Specificity = [0, 0, 0];
  const parts: SelectorPart[] = [];
  let rest = selector.trim();
  let combinator: SelectorPart["combinator"] = " ";
  while (rest) {
    let compound = "";
    while (rest && !/^[\s>+~]/.test(rest)) {
      const token = rest.match(COMPOUND_TOKEN)?.[0];
      if (!token)
        invalid(
          `CSS selector "${selector}" cannot be inlined. Use element, class, id, or attribute selectors.`,
        );
      compound += token;
      if (token[0] === "#") specificity[0]++;
      else if (token[0] === "." || token[0] === "[") specificity[1]++;
      else if (token !== "*") specificity[2]++;
      rest = rest.slice(token.length);
    }
    if (!compound) invalid(`Invalid CSS selector "${selector}".`);
    parts.push({ compound, combinator });
    const separator = rest.match(/^\s*([>+~])?\s*/)?.[0] ?? "";
    const explicit = separator.match(/[>+~]/)?.[0];
    combinator = (explicit ?? " ") as SelectorPart["combinator"];
    rest = rest.slice(separator.length);
    if (explicit && !rest) invalid(`Invalid CSS selector "${selector}".`);
  }
  if (!parts.length) invalid("An empty CSS selector cannot be exported.");
  return { parts, specificity };
}

function matchesCompound(element: Element, compound: string): boolean {
  let rest = compound;
  while (rest) {
    const token = rest.match(COMPOUND_TOKEN)![0];
    rest = rest.slice(token.length);
    if (token === "*") continue;
    if (token[0] === "#") {
      if (attribute(element, "id") !== token.slice(1)) return false;
    } else if (token[0] === ".") {
      if (
        !(attribute(element, "class") ?? "")
          .split(/\s+/)
          .includes(token.slice(1))
      )
        return false;
    } else if (token[0] === "[") {
      const match = token.match(
        /^\[\s*([\w-]+)(?:\s*([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([\w-]+)))?\s*\]$/,
      )!;
      const value = attribute(element, match[1].toLowerCase());
      if (value === undefined) return false;
      const expected = match[3] ?? match[4] ?? match[5] ?? "";
      const operation = match[2];
      if (operation === "=" && value !== expected) return false;
      if (operation === "~=" && !value.split(/\s+/).includes(expected))
        return false;
      if (
        operation === "|=" &&
        value !== expected &&
        !value.startsWith(`${expected}-`)
      )
        return false;
      if (operation === "^=" && (!expected || !value.startsWith(expected)))
        return false;
      if (operation === "$=" && (!expected || !value.endsWith(expected)))
        return false;
      if (operation === "*=" && (!expected || !value.includes(expected)))
        return false;
    } else if (element.tagName !== token.toLowerCase()) return false;
  }
  return true;
}

function matchesSelector(
  element: Element,
  parts: SelectorPart[],
  index = parts.length - 1,
): boolean {
  if (!matchesCompound(element, parts[index].compound)) return false;
  if (index === 0) return true;
  const combinator = parts[index].combinator;
  if (combinator === "+") {
    const previous = previousElements(element)[0];
    return !!previous && matchesSelector(previous, parts, index - 1);
  }
  if (combinator === "~")
    return previousElements(element).some((previous) =>
      matchesSelector(previous, parts, index - 1),
    );
  let parent = parentElement(element);
  while (parent) {
    if (matchesSelector(parent, parts, index - 1)) return true;
    if (combinator === ">") break;
    parent = parentElement(parent);
  }
  return false;
}

function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function validateDeclaration(declaration: Declaration): void {
  const property = declaration.prop.toLowerCase();
  const value = declaration.value.toLowerCase();
  if (
    property.startsWith("--") ||
    /var\s*\(|expression\s*\(|url\s*\(/i.test(value)
  ) {
    invalid(
      `CSS "${property}: ${declaration.value}" requires browser behavior or background assets. Use resolved values and HTTPS <img> elements.`,
    );
  }
  if (
    (property === "display" && /(?:flex|grid)/.test(value)) ||
    /^(?:flex|grid|gap|row-gap|column-gap|animation|transition|transform|backdrop-filter|filter)/.test(
      property,
    ) ||
    (property === "position" && value !== "static")
  ) {
    invalid(
      `CSS "${property}: ${declaration.value}" is not supported for this email export. Rebuild the layout with presentation tables.`,
    );
  }
  if (/[\\]/.test(property + value))
    invalid(
      "Escaped CSS must be replaced with plain email-safe declarations before export.",
    );
}

function parseStyles(css: string) {
  try {
    return postcss.parse(css);
  } catch {
    return invalid(
      "The email contains invalid CSS. Fix the stylesheet before exporting.",
    );
  }
}

function visibleTextByElement(document: Node): Map<Element, string> {
  const result = new Map<Element, string>();
  const visit = (
    node: Node,
    inherited = { visibility: "visible", zeroFont: false },
  ): string => {
    if (node.nodeName === "#text")
      return inherited.visibility === "visible" && !inherited.zeroFont
        ? (node as DefaultTreeAdapterTypes.TextNode).value
        : "";
    let state = inherited;
    if ("tagName" in node) {
      if (
        ["head", "style"].includes(node.tagName) ||
        attribute(node, "hidden") !== undefined ||
        attribute(node, "data-email-preheader") !== undefined
      )
        return "";
      const declarations = new Map<string, Declaration>();
      parseStyles(`email { ${attribute(node, "style") ?? ""} }`).walkDecls(
        (declaration) => {
          const property = declaration.prop.toLowerCase();
          const previous = declarations.get(property);
          if (!previous?.important || declaration.important)
            declarations.set(property, declaration);
        },
      );
      const value = (property: string) =>
        declarations.get(property)?.value.trim().toLowerCase();
      const opacity = value("opacity");
      if (
        value("display") === "none" ||
        (opacity !== undefined && Number(opacity.replace(/%$/, "")) === 0)
      )
        return "";
      const visibility = value("visibility");
      const font = value("font-size");
      let zeroFont = inherited.zeroFont;
      if (font && !["inherit", "unset"].includes(font)) {
        const numeric = font.match(/^([+-]?(?:\d*\.)?\d+)([a-z%]*)$/);
        zeroFont = numeric
          ? Number(numeric[1]) === 0 ||
            (inherited.zeroFont && ["em", "%", "ex", "ch"].includes(numeric[2]))
          : ["smaller", "larger"].includes(font) && inherited.zeroFont;
      }
      state = {
        visibility:
          !visibility || ["inherit", "unset"].includes(visibility)
            ? inherited.visibility
            : ["hidden", "collapse"].includes(visibility)
              ? "hidden"
              : "visible",
        zeroFont,
      };
    }
    const text =
      "childNodes" in node
        ? node.childNodes.map((child) => visit(child, state)).join(" ")
        : "";
    if ("tagName" in node) result.set(node, text);
    return text;
  };
  visit(document);
  return result;
}

function imageReference(url: string, at: string): ImageReference {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return invalid(
      `Image at ${at} needs an absolute public HTTPS URL: ${url.slice(0, 180)}`,
    );
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    !hostname.includes(".") ||
    /^(?:\d+\.){3}\d+$/.test(hostname) ||
    hostname.includes(":")
  ) {
    invalid(
      `Image at ${at} needs a public HTTPS hostname without credentials or a custom port: ${url.slice(0, 180)}`,
    );
  }
  return { url, location: at };
}

/** Deterministic preflight and CSS inlining; remote image availability is checked by exportHubSpotEmailHtml. */
export function prepareHubSpotEmailHtml(
  content: string,
  options: EmailExportOptions = {},
): {
  html: string;
  images: ImageReference[];
} {
  if (content.length > 1_000_000)
    invalid("The email source is too large to export (maximum 1 MB).");
  if (/{%/.test(content))
    invalid(
      "HubL control tags are not supported by the email inliner. Use interpolation tokens and personalization defaults.",
    );
  if (/<!--\s*\[if\b/i.test(content))
    invalid(
      "Conditional-comment markup cannot be validated by this email exporter. Use the presentation table layout directly.",
    );
  const { document, tokens, restoreTokens } = parseHtmlWithHubL(content);
  const all = elements(document);
  const images: ImageReference[] = [];
  const forbidden = new Set([
    "script",
    "iframe",
    "object",
    "embed",
    "canvas",
    "svg",
    "video",
    "audio",
    "form",
    "input",
    "button",
    "select",
    "textarea",
    "link",
    "base",
    "template",
    "picture",
    "source",
  ]);
  for (const element of all) {
    const at = location(element);
    if (forbidden.has(element.tagName))
      invalid(
        `Remove <${element.tagName}> at ${at}; email exports cannot depend on browser scripts, external styles, or interactive content.`,
      );
    for (const attr of element.attrs) {
      if (
        /^(?:on|x-|@|:)/.test(attr.name) ||
        ["srcdoc", "srcset", "background", "action", "formaction"].includes(
          attr.name,
        )
      )
        invalid(
          `Attribute "${attr.name}" at ${at} is not supported in an email. Use static HTML and HTTPS <img> elements.`,
        );
      if (attr.name === "href")
        validateLinkDestination(restoreTokens(attr.value), at);
    }
    if (element.tagName === "img") {
      if (attribute(element, "alt") === undefined)
        invalid(
          `Image at ${at} needs an alt attribute (use alt="" for a decorative image).`,
        );
      const image = imageReference(
        restoreTokens(attribute(element, "src") ?? ""),
        at,
      );
      for (const dimension of ["width", "height"]) {
        const value = attribute(element, dimension);
        if (
          value === undefined ||
          !/^\d+$/.test(value.trim()) ||
          !Number.isSafeInteger(Number(value)) ||
          Number(value) <= 0
        )
          invalid(
            `Image at ${at} needs an explicit positive integer ${dimension} attribute in pixels (for example, ${dimension}="600"). CSS sizing alone is not enough for email layout.`,
          );
      }
      images.push(image);
    }
  }
  const body = all.find((element) => element.tagName === "body");
  if (!body) invalid("The email needs a body element.");
  const textNodes = (node: Node): string => {
    if (node.nodeName === "#text")
      return (node as DefaultTreeAdapterTypes.TextNode).value;
    if ("tagName" in node && ["style", "head"].includes(node.tagName))
      return "";
    return "childNodes" in node ? node.childNodes.map(textNodes).join(" ") : "";
  };
  if (
    !all.some(
      (element) =>
        attribute(element, "data-email-preheader") !== undefined &&
        textNodes(element).trim(),
    )
  )
    invalid(
      "The email needs non-empty preheader text marked with data-email-preheader.",
    );
  for (const token of tokens) {
    const parsed = parseHubLInterpolation(token);
    if (
      /^contact\./.test(parsed?.name ?? "") ||
      (!parsed && /^{{\s*(?:contact\.|personalization_token\s*\()/.test(token))
    )
      validateContactInterpolation(token);
  }
  const rules: Array<{
    parts: SelectorPart[];
    specificity: Specificity;
    css: string;
    order: number;
  }> = [];
  let order = 0;
  for (const element of all.filter((entry) => entry.tagName === "style")) {
    const root = parseStyles(textNodes(element.childNodes[0] ?? element));
    root.walkDecls(validateDeclaration);
    root.walkAtRules((rule) => {
      if (rule.name.toLowerCase() !== "media" || rule.parent?.type !== "root")
        invalid(
          `CSS @${rule.name} cannot be exported. Keep only responsive @media rules.`,
        );
    });
    const media: string[] = [];
    for (const node of root.nodes) {
      if (node.type === "atrule") media.push(node.toString());
      else if (node.type === "rule") {
        if (
          node.nodes.some(
            (child) => child.type !== "decl" && child.type !== "comment",
          )
        )
          invalid("Nested CSS rules must be flattened before exporting.");
        const css = node.nodes
          .filter((child) => child.type === "decl")
          .map((child) => `${child.toString()};`)
          .join("");
        for (const selector of node.selectors)
          rules.push({ ...parseSelector(selector), css, order: order++ });
      } else if (node.type !== "comment")
        invalid("The email stylesheet contains unsupported CSS.");
    }
    element.childNodes = [
      { nodeName: "#text", value: media.join("\n"), parentNode: element },
    ];
    if (!media.length && element.parentNode)
      element.parentNode.childNodes = element.parentNode.childNodes.filter(
        (node) => node !== element,
      );
  }
  rules.sort(
    (a, b) =>
      compareSpecificity(a.specificity, b.specificity) || a.order - b.order,
  );
  const inlinedStyles = new Map(
    all.map((element) => [
      element,
      rules
        .filter((rule) => matchesSelector(element, rule.parts))
        .map((rule) => rule.css)
        .join(""),
    ]),
  );
  for (const element of all) {
    const inline = attribute(element, "style");
    if (inline) {
      const root = parseStyles(`email { ${inline} }`);
      root.walkDecls(validateDeclaration);
      if (
        root.nodes.length !== 1 ||
        root.first?.type !== "rule" ||
        root.first.nodes.some(
          (node) => node.type !== "decl" && node.type !== "comment",
        )
      )
        invalid(`Invalid inline style at ${location(element)}.`);
    }
    const css = inlinedStyles.get(element)!;
    if (css) {
      const existing = element.attrs.find((attr) => attr.name === "style");
      if (existing) existing.value = css + existing.value;
      else element.attrs.push({ name: "style", value: css });
    }
  }
  const visibleText = visibleTextByElement(document);
  const footerTokens = (
    restoreTokens(visibleText.get(body) ?? "").match(/{{[\s\S]*?}}/g) ?? []
  ).map(parseHubLInterpolation);
  for (const token of [
    "company_name",
    "company_street_address_1",
    "company_city",
    "company_state",
  ]) {
    if (
      !footerTokens.some((parsed) => parsed?.name === `site_settings.${token}`)
    )
      invalid(
        `The visible footer is missing {{ site_settings.${token} }} outside the preheader.`,
      );
  }
  if (
    !all.some((element) => {
      if (element.tagName !== "a" || !visibleText.get(element)?.trim())
        return false;
      const parsed = parseHubLInterpolation(
        restoreTokens(attribute(element, "href") ?? ""),
      );
      return parsed?.name === "unsubscribe_link" && !parsed.personalization;
    })
  )
    invalid(
      'The email needs a visible unsubscribe link with href="{{ unsubscribe_link }}" and a non-empty text label outside the preheader.',
    );
  const leadingComments =
    content
      .replace(/^\uFEFF/, "")
      .match(/^\s*((?:<!--[\s\S]*?-->\s*)+)/)?.[1] ?? "";
  const templateTypes = [...leadingComments.matchAll(/<!--([\s\S]*?)-->/g)]
    .flatMap((comment) => [
      ...comment[1].matchAll(/^\s*templateType\s*:\s*(\S+)\s*$/gm),
    ])
    .map((match) => match[1].replace(/^(['"])(.*)\1$/, "$2"));
  if (!templateTypes.length || templateTypes.some((type) => type !== "email"))
    invalid(
      "The email needs a leading HubSpot template annotation with templateType: email before document markup.",
    );
  if (
    !all.some(
      (element) =>
        element.tagName === "table" &&
        attribute(element, "role") === "presentation",
    )
  )
    invalid("The email needs a presentation table layout.");
  if (options.preserveLinksFromHtml !== undefined)
    assertPreservedAnchorDestinations(
      options.preserveLinksFromHtml,
      document,
      restoreTokens,
    );
  return { html: restoreTokens(serialize(document)), images };
}

export async function exportHubSpotEmailHtml(
  content: string,
  options: EmailExportOptions = {},
): Promise<{ html: string; imageCount: number }> {
  const prepared = prepareHubSpotEmailHtml(content, options);
  const uniqueImages = [
    ...new Map(prepared.images.map((image) => [image.url, image])).values(),
  ];
  if (uniqueImages.length > 32)
    invalid(
      "The email has more than 32 unique images. Reduce the image count before exporting.",
    );
  const signal = AbortSignal.timeout(15_000);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, uniqueImages.length) }, async () => {
      while (next < uniqueImages.length) {
        const image = uniqueImages[next++];
        let response: Response;
        try {
          response = await ssrfSafeFetch(
            image.url,
            {
              method: "GET",
              signal,
              headers: { Accept: "image/png,image/jpeg,image/gif" },
            },
            { httpsOnly: true, requireDispatcher: true, maxRedirects: 3 },
          );
        } catch {
          invalid(
            `Image at ${image.location} could not be verified as publicly reachable: ${image.url.slice(0, 180)}. Host it on a public HTTPS image URL and retry.`,
          );
        }
        await response.body?.cancel();
        if (!response.ok)
          invalid(
            `Image at ${image.location} returned HTTP ${response.status}: ${image.url.slice(0, 180)}.`,
          );
        const type = response.headers
          .get("content-type")
          ?.split(";")[0]
          .trim()
          .toLowerCase();
        if (!type || !["image/png", "image/jpeg", "image/gif"].includes(type))
          invalid(
            `Image at ${image.location} must serve a PNG, JPEG, or GIF (received ${type ?? "no content type"}): ${image.url.slice(0, 180)}.`,
          );
      }
    }),
  );
  return { html: prepared.html, imageCount: prepared.images.length };
}
