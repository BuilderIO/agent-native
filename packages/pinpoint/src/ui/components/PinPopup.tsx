// @agent-native/pinpoint — Pin creation popup
// MIT License

import { createSignal, onMount, type Component } from "solid-js";
import type { ElementContext } from "../../types/index.js";
import { icons } from "../icons/index.js";

interface PinPopupProps {
  context: ElementContext;
  author?: string;
  onAdd: (comment: string) => void;
  onCancel: () => void;
}

export const PinPopup: Component<PinPopupProps> = (props) => {
  const [comment, setComment] = createSignal("");
  let textareaRef: HTMLTextAreaElement | undefined;

  onMount(() => {
    textareaRef?.focus();
  });

  function handleSubmit() {
    const text = comment().trim();
    if (!text) return;
    props.onAdd(text);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      props.onCancel();
    }
  }

  // Position popup near the selected element
  const rect = props.context.element.boundingRect;
  const popupX = Math.min(rect.x, window.innerWidth - 440);
  const popupY = rect.y + rect.height + 8;
  const adjustedY = popupY + 200 > window.innerHeight ? rect.y - 208 : popupY;

  return (
    <div
      class="pp-popup"
      style={{
        left: `${Math.max(8, popupX)}px`,
        top: `${Math.max(8, adjustedY)}px`,
      }}
    >
      {/* Element info */}
      <div class="pp-popup__element-info">{props.context.cssSelector}</div>

      {/* Component path */}
      {props.context.framework && (
        <div class="pp-popup__component">
          {props.context.framework.componentPath}
        </div>
      )}

      {/* Source file */}
      {props.context.framework?.sourceFile && (
        <div
          class="pp-popup__source"
          onClick={async () => {
            try {
              const file = props.context.framework!.sourceFile!;
              const { openFile } = await import("../../utils/open-file.js");
              openFile(file);
            } catch {
              // Can't open file
            }
          }}
        >
          <span innerHTML={icons.fileCode} />{" "}
          {props.context.framework.sourceFile}
        </div>
      )}

      {/* Comment textarea */}
      <textarea
        ref={textareaRef}
        class="pp-popup__textarea"
        placeholder="Add your feedback..."
        value={comment()}
        onInput={(e) => setComment(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />

      {/* Author */}
      {props.author && (
        <div style={{ "font-size": "11px", color: "var(--pp-text-muted)" }}>
          as {props.author}
        </div>
      )}

      {/* Actions */}
      <div class="pp-popup__actions">
        <button class="pp-btn" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          class="pp-btn pp-btn--primary"
          onClick={handleSubmit}
          disabled={!comment().trim()}
        >
          <span innerHTML={icons.pin} />
          Add Pin
        </button>
      </div>
    </div>
  );
};
