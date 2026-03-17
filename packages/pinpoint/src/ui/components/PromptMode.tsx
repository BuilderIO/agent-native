// @agent-native/pinpoint — Prompt mode for quick agent instructions
// MIT License

import { createSignal, onMount, type Component } from "solid-js";
import { icons } from "../icons/index.js";

interface PromptModeProps {
  element: Element;
  onSend: (instruction: string) => void;
  onCancel: () => void;
}

export const PromptMode: Component<PromptModeProps> = (props) => {
  const [instruction, setInstruction] = createSignal("");
  let inputRef: HTMLInputElement | undefined;

  onMount(() => inputRef?.focus());

  function handleSubmit() {
    const text = instruction().trim();
    if (!text) return;
    props.onSend(text);
  }

  // Position near the element
  const rect = props.element.getBoundingClientRect();
  const x = Math.max(8, Math.min(rect.left, window.innerWidth - 300));
  const y =
    rect.bottom + 8 > window.innerHeight - 40 ? rect.top - 40 : rect.bottom + 8;

  return (
    <div class="pp-prompt" style={{ left: `${x}px`, top: `${y}px` }}>
      <input
        ref={inputRef}
        class="pp-prompt__input"
        type="text"
        placeholder="Tell the agent what to do..."
        value={instruction()}
        onInput={(e) => setInstruction(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
          if (e.key === "Escape") props.onCancel();
        }}
      />
      <button class="pp-btn pp-btn--primary pp-btn--sm" onClick={handleSubmit}>
        <span innerHTML={icons.send} />
      </button>
    </div>
  );
};
