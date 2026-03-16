// @agent-native/pinpoint — Right-click context menu
// MIT License

import { onMount, onCleanup, type Component } from "solid-js";
import { icons } from "../icons/index.js";

interface ContextMenuProps {
  position: { x: number; y: number };
  element: Element;
  onClose: () => void;
  onAnnotate: () => void;
  onCopyContext: () => void;
  onPrompt: () => void;
}

export const ContextMenu: Component<ContextMenuProps> = (props) => {
  let menuRef: HTMLDivElement | undefined;

  // Close on click outside
  onMount(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef && !menuRef.contains(e.target as Node)) {
        props.onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    // Delay to avoid closing immediately from the contextmenu event
    setTimeout(() => {
      document.addEventListener("click", handleClick, true);
      document.addEventListener("keydown", handleKeyDown, true);
    }, 0);

    onCleanup(() => {
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    });
  });

  // Ensure menu stays within viewport
  const x = Math.min(props.position.x, window.innerWidth - 200);
  const y = Math.min(props.position.y, window.innerHeight - 250);

  return (
    <div
      ref={menuRef}
      class="pp-context-menu"
      style={{ left: `${x}px`, top: `${y}px` }}
    >
      <div class="pp-context-menu__item" onClick={props.onAnnotate}>
        <span innerHTML={icons.pin} />
        Add Annotation
      </div>
      <div class="pp-context-menu__item" onClick={props.onPrompt}>
        <span innerHTML={icons.messageSquare} />
        Quick Prompt
      </div>
      <div class="pp-context-menu__separator" />
      <div class="pp-context-menu__item" onClick={props.onCopyContext}>
        <span innerHTML={icons.copy} />
        Copy Element Context
      </div>
      <div
        class="pp-context-menu__item"
        onClick={async () => {
          const html = props.element.outerHTML
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 500);
          await navigator.clipboard.writeText(html);
          props.onClose();
        }}
      >
        <span innerHTML={icons.fileCode} />
        Copy HTML Snippet
      </div>
      <div
        class="pp-context-menu__item"
        onClick={async () => {
          const styles = window.getComputedStyle(props.element);
          const relevant = [
            "color",
            "background-color",
            "font-size",
            "font-family",
            "padding",
            "margin",
            "border",
            "display",
            "position",
            "width",
            "height",
          ];
          const result = relevant
            .map((key) => `${key}: ${styles.getPropertyValue(key)}`)
            .join("\n");
          await navigator.clipboard.writeText(result);
          props.onClose();
        }}
      >
        <span innerHTML={icons.eye} />
        Copy Computed Styles
      </div>
    </div>
  );
};
