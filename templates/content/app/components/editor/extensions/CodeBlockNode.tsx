import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";

const lowlight = createLowlight(common);

export const CodeBlock = CodeBlockLowlight.extend({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Tab: ({ editor }) => {
        if (editor.isActive("codeBlock")) {
          editor.commands.insertContent("\t");
          return true;
        }
        return false;
      },
    };
  },
}).configure({
  lowlight,
  HTMLAttributes: { class: "notion-code-block" },
  defaultLanguage: null,
});
