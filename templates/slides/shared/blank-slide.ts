import { parseHTML } from "linkedom/worker";

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/&#x[0-9a-f]+;/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasVisibleBackgroundClass(html: string): boolean {
  const { document } = parseHTML(html);
  const attributeMatches = (
    type: string,
    value: string | null | undefined,
    expected: string,
  ) =>
    type.toLowerCase() === "aria"
      ? value?.toLowerCase() === expected.toLowerCase()
      : value === expected;

  return Array.from(document.querySelectorAll("*")).some((element) => {
    const classNames =
      element.getAttribute("class") ?? element.getAttribute("className") ?? "";
    return classNames.split(/\s+/).some((className) => {
      const variants =
        className.match(
          /^(?:(?:[\w-]+(?:-\[[^\]]+\])?(?:\/[\w-]+)?|\[[^\]]+\]):)+/,
        )?.[0] ?? "";
      const variantNames =
        variants.slice(0, -1).match(/(?:\[[^\]]*\]|[^:])+/g) ?? [];
      const hasInactiveState = variantNames.some((variant) => {
        const selectorVariant = variant.match(/^(has|not)-\[(.+)\]$/i);
        if (selectorVariant) {
          const [, mode, selector] = selectorVariant;
          let matches: boolean;
          try {
            matches =
              mode.toLowerCase() === "has"
                ? element.matches(`:has(${selector.replaceAll("_", " ")})`)
                : element.matches(selector.replaceAll("_", " "));
          } catch {
            // coercion-ok: invalid variants stay active.
            return false;
          }
          return mode.toLowerCase() === "has" ? !matches : matches;
        }

        const relatedAttribute = variant.match(
          /^(group|peer)-(aria|data)-\[([\w-]+)=([^\]]+)\](?:\/([\w-]+))?$/i,
        );
        if (relatedAttribute) {
          const [
            ,
            relation,
            attributeType,
            attributeName,
            rawExpected,
            relationName,
          ] = relatedAttribute;
          const attributeNameWithType = `${attributeType}-${attributeName}`;
          const relationClass = `${relation.toLowerCase()}${relationName ? `/${relationName}` : ""}`;
          const expected = rawExpected.replace(/^['"]|['"]$/g, "");
          const matches = (candidate: Element | null | undefined) =>
            attributeMatches(
              attributeType,
              candidate?.getAttribute(attributeNameWithType),
              expected,
            );
          if (relation.toLowerCase() === "group") {
            for (
              let ancestor = element.parentElement;
              ancestor;
              ancestor = ancestor.parentElement
            ) {
              if (
                ancestor.classList.contains(relationClass) &&
                matches(ancestor)
              ) {
                return false;
              }
            }
            return true;
          }

          for (
            let sibling = element.previousElementSibling;
            sibling;
            sibling = sibling.previousElementSibling
          ) {
            if (sibling.classList.contains(relationClass) && matches(sibling)) {
              return false;
            }
          }
          return true;
        }

        // ponytail: dynamic group/peer pseudo states remain unknown; extend related-node checks as needed.
        if (
          /^(?:hover|focus(?:-visible|-within)?|active|visited|disabled|enabled|checked|indeterminate|required|optional|valid|invalid|in-range|out-of-range|placeholder-shown|autofill|read-only|read-write|open|modal|fullscreen|target|group-.+|peer-.+|has-.+|not-.+)$/i.test(
            variant,
          )
        ) {
          return true;
        }

        const aria = variant.match(/^aria-([\w-]+)$/i);
        if (aria) {
          const name = `aria-${aria[1]}`;
          const expected =
            aria[1].toLowerCase() === "current" ? "page" : "true";
          return !attributeMatches(
            "aria",
            element.getAttribute(name),
            expected,
          );
        }

        const attribute = variant.match(/^(aria|data)-\[([\w-]+)=([^\]]+)\]$/i);
        if (attribute) {
          const name = `${attribute[1]}-${attribute[2]}`;
          const expected = attribute[3].replace(/^['"]|['"]$/g, "");
          return !attributeMatches(
            attribute[1],
            element.getAttribute(name),
            expected,
          );
        }

        return /^(?:aria|data)-/i.test(variant);
      });
      if (hasInactiveState) {
        return false;
      }
      return /^bg-(?!(?:none|transparent)(?:\/|$)|opacity-|clip-|origin-|blend-|repeat(?:-|\/|$)|size-|position-|attachment-|(?:auto|cover|contain|fixed|local|scroll|center|top|bottom|left|right|no-repeat)(?:\/|$))\S+/i.test(
        className.slice(variants.length),
      );
    });
  });
}

export function isBlankSlideContent(html: string): boolean {
  if (stripHtml(html)) return false;
  return !(
    hasVisibleBackgroundClass(html) ||
    /<(?:img|svg|video|canvas|table|iframe|object|embed)\b|data-slide-object-id|fmd-img-placeholder/i.test(
      html,
    ) ||
    /(?:background(?:-color|-image)?|border(?:-(?:top|right|bottom|left))?(?:-(?:width|style|color))?|box-shadow)\s*:\s*(?!none\b|transparent\b)/i.test(
      html,
    )
  );
}

// SlideRenderer draws a parsed excalidrawData with elements instead of the
// slide's HTML, so such a slide is real whatever its content says.
function hasExcalidrawElements(data: unknown): boolean {
  if (typeof data !== "string") return false;
  try {
    const elements = JSON.parse(data)?.elements;
    return Array.isArray(elements) && elements.length > 0;
  } catch {
    // coercion-ok: the renderer also falls back to content on unparseable data.
    return false;
  }
}

export function isRealSlide(slide: unknown): boolean {
  const { content, excalidrawData } = (slide ?? {}) as {
    content?: unknown;
    excalidrawData?: unknown;
  };
  return (
    hasExcalidrawElements(excalidrawData) ||
    !isBlankSlideContent(typeof content === "string" ? content : "")
  );
}
