import * as Y from "yjs";

export function searchAndReplaceInYXml(
  element: Y.XmlFragment | Y.XmlElement,
  find: string,
  replace: string,
): boolean {
  for (let i = 0; i < element.length; i++) {
    const child = element.get(i) as any;
    if (
      child &&
      typeof child.toString === "function" &&
      typeof child.delete === "function" &&
      typeof child.insert === "function" &&
      child.length !== undefined &&
      typeof child.get !== "function"
    ) {
      const text = child.toString();
      const idx = text.indexOf(find);
      if (idx !== -1) {
        child.delete(idx, find.length);
        child.insert(idx, replace);
        return true;
      }
    } else if (child && typeof child.get === "function") {
      if (searchAndReplaceInYXml(child, find, replace)) {
        return true;
      }
    }
  }
  return false;
}

export function extractTextFromYXml(
  element: Y.XmlFragment | Y.XmlElement,
): string {
  const parts: string[] = [];
  for (let i = 0; i < element.length; i++) {
    const child = element.get(i) as any;
    if (child && typeof child.get === "function") {
      parts.push(extractTextFromYXml(child));
    } else if (child) {
      parts.push(child.toString());
    }
  }
  return parts.join("\n");
}
