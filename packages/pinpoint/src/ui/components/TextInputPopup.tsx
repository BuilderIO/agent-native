// @agent-native/pinpoint — Text annotation input popup for draw mode
// MIT License

import { createSignal, onMount, type Component } from "solid-js";

interface TextInputPopupProps {
  x: number;
  y: number;
  color: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

export const TextInputPopup: Component<TextInputPopupProps> = (props) => {
  const [text, setText] = createSignal("");
  let inputRef: HTMLInputElement | undefined;

  onMount(() => inputRef?.focus());

  function handleSubmit() {
    const t = text().trim();
    if (t) props.onSubmit(t);
    else props.onCancel();
  }

  // Position below the click point, adjusted for viewport
  const x = Math.max(8, Math.min(props.x, window.innerWidth - 260));
  const y = Math.max(8, Math.min(props.y + 8, window.innerHeight - 50));

  return (
    <div class="pp-text-input-popup" style={{ left: `${x}px`, top: `${y}px` }}>
      <div
        class="pp-text-input-popup__indicator"
        style={{ background: props.color }}
      />
      <input
        ref={inputRef}
        class="pp-text-input-popup__input"
        type="text"
        placeholder="Add text note..."
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
          if (e.key === "Escape") props.onCancel();
        }}
        onBlur={handleSubmit}
      />
    </div>
  );
};
