import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table as BaseTable } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Markdown } from "tiptap-markdown";

const CustomTable = BaseTable.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          state.inTable = true;
          node.forEach((row, _p, i) => {
            state.write("| ");
            row.forEach((col, _p, j) => {
              if (j) state.write(" | ");
              col.forEach((child, _offset, index) => {
                if (index > 0) state.write("<br>");
                if (child.isTextblock) {
                  state.renderInline(child);
                } else {
                  state.write(state.esc(child.textContent || ""));
                }
              });
            });
            state.write(" |");
            state.ensureNewLine();

            if (i === 0) {
              const delimiterRow = Array.from({ length: row.childCount })
                .map(() => "---")
                .join(" | ");
              state.write(`| ${delimiterRow} |`);
              state.ensureNewLine();
            }
          });
          state.closeBlock(node);
          state.inTable = false;
        },
      },
    };
  },
});

const editor = new Editor({
  extensions: [
    StarterKit,
    CustomTable,
    TableRow,
    TableHeader,
    TableCell,
    Markdown,
  ],
  content:
    "<table><tr><th>Hello</th><th>World</th></tr><tr><td><p>This is a test</p></td><td><p>Some more text</p></td></tr></table>",
});

console.log("MARKDOWN OUTPUT:");
console.log(editor.storage.markdown.getMarkdown());
