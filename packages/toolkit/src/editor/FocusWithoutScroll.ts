import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * Focuses the editor root without letting the browser scroll it into view.
 *
 * On iOS and Android, TipTap's `focus` command calls `view.dom.focus()` with no
 * options so the keyboard opens inside the tap, and the browser scrolls the top
 * of the editor into view. Ticking a check mark while the cursor was outside the
 * page (after writing a comment, say) jumped the page to the top. ProseMirror's
 * own focus already prevents the scroll and scrolls to the selection itself.
 */
export const FocusWithoutScroll = Extension.create({
  name: "focusWithoutScroll",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("focusWithoutScroll"),
        view(view) {
          const dom = view.dom;
          dom.focus = (options?: FocusOptions) => {
            HTMLElement.prototype.focus.call(dom, {
              ...options,
              preventScroll: true,
            });
          };
          return {
            destroy() {
              Reflect.deleteProperty(dom, "focus");
            },
          };
        },
      }),
    ];
  },
});
