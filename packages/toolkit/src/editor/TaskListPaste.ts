import { Extension } from "@tiptap/core";

const CHECKBOX_HINT =
  /(to-do-list|contains-task-list|task-list-item|checkbox|type=["']?checkbox)/i;

function isCheckboxMarker(el: Element): boolean {
  if (el.tagName === "INPUT") {
    return (el.getAttribute("type") ?? "").toLowerCase() === "checkbox";
  }
  const className =
    typeof el.className === "string" ? el.className.toLowerCase() : "";
  return /\bcheckbox\b/.test(className);
}

function findCheckboxMarker(item: Element): Element | null {
  for (const child of Array.from(item.children)) {
    if (isCheckboxMarker(child)) return child;
    if (child.tagName !== "UL" && child.tagName !== "OL") {
      const nested = Array.from(child.children).find(isCheckboxMarker);
      if (nested) return nested;
    }
  }
  return null;
}

function ownsCheckedSpan(item: Element): boolean {
  for (const span of Array.from(
    item.querySelectorAll(".to-do-children-checked"),
  )) {
    if (span.closest("li") === item) return true;
  }
  return false;
}

function readChecked(item: Element, marker: Element): boolean {
  if (marker.tagName === "INPUT") {
    if (marker.hasAttribute("checked")) return true;
    if ((marker as HTMLInputElement).checked) return true;
  }
  const markerClass =
    typeof marker.className === "string" ? marker.className.toLowerCase() : "";
  if (/\bcheckbox-on\b/.test(markerClass)) return true;

  if (ownsCheckedSpan(item)) return true;

  const explicit = item.getAttribute("data-checked");
  if (explicit === "true") return true;

  return false;
}

const BLOCK_TAGS = new Set([
  "P",
  "UL",
  "OL",
  "DIV",
  "PRE",
  "BLOCKQUOTE",
  "TABLE",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
]);

function wrapLeadingInlineContent(doc: Document, item: Element): void {
  const leading: ChildNode[] = [];
  for (const node of Array.from(item.childNodes)) {
    if (node.nodeType === 1 && BLOCK_TAGS.has((node as Element).tagName)) break;
    leading.push(node);
  }
  if (leading.length === 0) return;
  if (
    leading.length === 1 &&
    leading[0].nodeType === 3 &&
    !(leading[0].textContent ?? "").trim()
  ) {
    return;
  }

  const paragraph = doc.createElement("p");
  item.insertBefore(paragraph, leading[0]);
  for (const node of leading) paragraph.appendChild(node);
}

function convertList(doc: Document, list: Element): boolean {
  if (list.tagName !== "UL") return false;

  const items = Array.from(list.children).filter(
    (child) => child.tagName === "LI",
  );
  if (items.length === 0) return false;

  const markers = items.map((item) => findCheckboxMarker(item));
  if (markers.some((marker) => marker === null)) return false;

  list.setAttribute("data-type", "taskList");
  items.forEach((item, index) => {
    const marker = markers[index]!;
    const checked = readChecked(item, marker);
    marker.remove();
    item.setAttribute("data-type", "taskItem");
    item.setAttribute("data-checked", checked ? "true" : "false");
    wrapLeadingInlineContent(doc, item);
  });
  return true;
}

export function normalizePastedTaskListHtml(html: string): string {
  if (!html || !CHECKBOX_HINT.test(html)) return html;
  if (typeof DOMParser === "undefined") return html;

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
    // coercion-ok: unparseable clipboard HTML is passed through untouched.
  } catch {
    return html;
  }
  if (!doc?.body) return html;

  const lists = Array.from(doc.body.querySelectorAll("ul")).reverse();
  let changed = false;
  for (const list of lists) {
    if (convertList(doc, list)) changed = true;
  }
  if (!changed) return html;

  return doc.body.innerHTML;
}

export const TaskListPasteNormalization = Extension.create({
  name: "taskListPasteNormalization",
  transformPastedHTML(html) {
    return normalizePastedTaskListHtml(html);
  },
});
