import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";

const lowlight = createLowlight(common);

/**
 * Content's fenced code block.
 *
 * Keep the node on Tiptap's native DOM renderer. Mounting the former React
 * node view could synchronously lock a collaborative editor as soon as a code
 * block entered the document. The native renderer preserves the same
 * `codeBlock` schema, language attribute, lowlight decorations, markdown
 * round-trip, and keyboard behavior without a second React render tree inside
 * ProseMirror.
 */
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
