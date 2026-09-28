// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import {
  normalizePastedTaskListHtml,
  TaskListPasteNormalization,
} from "./TaskListPaste.js";

function parse(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body;
}

const NOTION_CHECKLIST = `
<ul id="abc" class="to-do-list">
  <li><div class="checkbox checkbox-off"></div><span class="to-do-children-unchecked">ENG-13549 fix drag handle</span></li>
  <li><div class="checkbox checkbox-on"></div><span class="to-do-children-checked">ENG-13486 ship paste fix</span></li>
</ul>`;

describe("normalizePastedTaskListHtml", () => {
  it("turns a Notion checklist into a task list", () => {
    const body = parse(normalizePastedTaskListHtml(NOTION_CHECKLIST));

    const list = body.querySelector("ul");
    expect(list?.getAttribute("data-type")).toBe("taskList");

    const items = Array.from(body.querySelectorAll("li"));
    expect(items).toHaveLength(2);
    expect(items.map((li) => li.getAttribute("data-type"))).toEqual([
      "taskItem",
      "taskItem",
    ]);
    expect(items.map((li) => li.getAttribute("data-checked"))).toEqual([
      "false",
      "true",
    ]);
  });

  it("keeps the item text and drops only the checkbox marker", () => {
    const body = parse(normalizePastedTaskListHtml(NOTION_CHECKLIST));

    expect(body.querySelector(".checkbox")).toBeNull();
    expect(body.textContent).toContain("ENG-13549 fix drag handle");
    expect(body.textContent).toContain("ENG-13486 ship paste fix");
  });

  it("wraps item text in a paragraph so taskItem content is valid", () => {
    const body = parse(normalizePastedTaskListHtml(NOTION_CHECKLIST));

    const firstItem = body.querySelector("li");
    expect(firstItem?.firstElementChild?.tagName).toBe("P");
    expect(firstItem?.querySelector("p")?.textContent).toContain("ENG-13549");
  });

  it("normalizes GitHub-flavored task lists", () => {
    const html = `<ul class="contains-task-list">
      <li class="task-list-item"><input type="checkbox" disabled> open item</li>
      <li class="task-list-item"><input type="checkbox" checked disabled> done item</li>
    </ul>`;

    const items = Array.from(
      parse(normalizePastedTaskListHtml(html)).querySelectorAll("li"),
    );

    expect(items.map((li) => li.getAttribute("data-checked"))).toEqual([
      "false",
      "true",
    ]);
    expect(
      parse(normalizePastedTaskListHtml(html)).querySelector("input"),
    ).toBeNull();
  });

  it("does not let a checked nested child check its unchecked parent", () => {
    const html = `<ul class="to-do-list">
      <li><div class="checkbox checkbox-off"></div><span class="to-do-children-unchecked">parent unchecked</span>
        <ul class="to-do-list">
          <li><div class="checkbox checkbox-on"></div><span class="to-do-children-checked">child checked</span></li>
        </ul>
      </li>
    </ul>`;

    const items = Array.from(
      parse(normalizePastedTaskListHtml(html)).querySelectorAll("li"),
    );

    expect(items.map((li) => li.getAttribute("data-checked"))).toEqual([
      "false",
      "true",
    ]);
  });

  it("keeps a checked parent checked above an unchecked child", () => {
    const html = `<ul class="to-do-list">
      <li><div class="checkbox checkbox-on"></div><span class="to-do-children-checked">parent checked</span>
        <ul class="to-do-list">
          <li><div class="checkbox checkbox-off"></div><span class="to-do-children-unchecked">child unchecked</span></li>
        </ul>
      </li>
    </ul>`;

    const items = Array.from(
      parse(normalizePastedTaskListHtml(html)).querySelectorAll("li"),
    );

    expect(items.map((li) => li.getAttribute("data-checked"))).toEqual([
      "true",
      "false",
    ]);
  });

  it("leaves an ordered checkbox list untouched", () => {
    const html =
      '<ol><li><input type="checkbox"> a</li><li><input type="checkbox" checked> b</li></ol>';

    expect(normalizePastedTaskListHtml(html)).toBe(html);
  });

  it("converts a ul checklist nested inside an ordered list", () => {
    const html = `<ol><li>step
      <ul class="to-do-list"><li><div class="checkbox checkbox-on"></div><span>done</span></li></ul>
    </li></ol>`;

    const body = parse(normalizePastedTaskListHtml(html));
    expect(body.querySelector("ol")?.getAttribute("data-type")).toBeNull();
    expect(body.querySelector("ul")?.getAttribute("data-type")).toBe(
      "taskList",
    );
  });

  it("converts a nested checklist without flattening it into its parent", () => {
    const html = `<ul class="to-do-list">
      <li><div class="checkbox checkbox-off"></div><span>parent</span>
        <ul class="to-do-list">
          <li><div class="checkbox checkbox-on"></div><span>child</span></li>
        </ul>
      </li>
    </ul>`;

    const body = parse(normalizePastedTaskListHtml(html));
    const lists = Array.from(body.querySelectorAll("ul"));

    expect(lists).toHaveLength(2);
    expect(
      lists.every((ul) => ul.getAttribute("data-type") === "taskList"),
    ).toBe(true);

    const parentItem = body.querySelector("li")!;
    expect(parentItem.querySelector("p")?.textContent?.trim()).toBe("parent");
    expect(parentItem.querySelector("p > ul")).toBeNull();
    expect(parentItem.querySelector(":scope > ul")).not.toBeNull();
  });

  it("leaves a plain bullet list untouched", () => {
    const html = "<ul><li>one</li><li>two</li></ul>";
    expect(normalizePastedTaskListHtml(html)).toBe(html);
  });

  it("leaves a mixed list alone rather than guessing a shape for it", () => {
    const html = `<ul>
      <li><input type="checkbox"> checkable</li>
      <li>plain</li>
    </ul>`;

    const body = parse(normalizePastedTaskListHtml(html));
    expect(body.querySelector("ul")?.getAttribute("data-type")).toBeNull();
  });

  it("returns the input unchanged when there is no checkbox hint", () => {
    const html = "<p>just a paragraph</p>";
    expect(normalizePastedTaskListHtml(html)).toBe(html);
  });

  it("handles empty input", () => {
    expect(normalizePastedTaskListHtml("")).toBe("");
  });
});

describe("TaskListPasteNormalization in a live editor", () => {
  function mount() {
    const element = document.createElement("div");
    document.body.appendChild(element);
    return new Editor({
      element,
      extensions: [
        StarterKit,
        TaskList,
        TaskItem.configure({ nested: true }),
        TaskListPasteNormalization,
      ],
      content: "<p></p>",
    });
  }

  function pasteHtml(editor: Editor, html: string): void {
    const transformed =
      editor.view.someProp("transformPastedHTML", (fn) =>
        fn(html, editor.view),
      ) ?? html;
    editor.commands.setContent(transformed);
  }

  function nodeNames(editor: Editor): string[] {
    const names: string[] = [];
    editor.state.doc.descendants((node) => {
      names.push(node.type.name);
      return true;
    });
    return names;
  }

  it("produces taskItem nodes from a Notion checklist paste", () => {
    const editor = mount();
    try {
      pasteHtml(editor, NOTION_CHECKLIST);

      const names = nodeNames(editor);
      expect(names).toContain("taskList");
      expect(names.filter((name) => name === "taskItem")).toHaveLength(2);
      expect(names).not.toContain("bulletList");
    } finally {
      editor.destroy();
    }
  });

  it("preserves the checked state of each pasted item", () => {
    const editor = mount();
    try {
      pasteHtml(editor, NOTION_CHECKLIST);

      const checked: boolean[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === "taskItem") checked.push(node.attrs.checked);
        return true;
      });
      expect(checked).toEqual([false, true]);
    } finally {
      editor.destroy();
    }
  });

  it("does not mangle an ordered checkbox list into a split doc", () => {
    const editor = mount();
    try {
      pasteHtml(
        editor,
        '<ol><li><input type="checkbox"> a</li><li><input type="checkbox" checked> b</li></ol>',
      );

      const names = nodeNames(editor);
      expect(names).toContain("orderedList");
      expect(names).not.toContain("taskList");
      expect(editor.state.doc.textContent).toContain("a");
      expect(editor.state.doc.textContent).toContain("b");
    } finally {
      editor.destroy();
    }
  });

  it("keeps nested checked state correct through the schema", () => {
    const editor = mount();
    try {
      pasteHtml(
        editor,
        `<ul class="to-do-list">
          <li><div class="checkbox checkbox-off"></div><span class="to-do-children-unchecked">parent</span>
            <ul class="to-do-list">
              <li><div class="checkbox checkbox-on"></div><span class="to-do-children-checked">child</span></li>
            </ul>
          </li>
        </ul>`,
      );

      const checked: boolean[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === "taskItem") checked.push(node.attrs.checked);
        return true;
      });
      expect(checked).toEqual([false, true]);
    } finally {
      editor.destroy();
    }
  });

  it("still yields a plain bullet list for a normal list paste", () => {
    const editor = mount();
    try {
      pasteHtml(editor, "<ul><li>one</li><li>two</li></ul>");

      const names = nodeNames(editor);
      expect(names).toContain("bulletList");
      expect(names).not.toContain("taskList");
    } finally {
      editor.destroy();
    }
  });
});
