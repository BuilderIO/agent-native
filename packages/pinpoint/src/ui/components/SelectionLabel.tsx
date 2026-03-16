// @agent-native/pinpoint — Floating label near hovered element
// MIT License

import { type Component } from "solid-js";

interface SelectionLabelProps {
  info: { text: string; rect: DOMRect } | null;
}

export const SelectionLabel: Component<SelectionLabelProps> = (props) => {
  if (!props.info) return null;

  const { text, rect } = props.info;
  // Position above the element, or below if too close to top
  const y = rect.top > 30 ? rect.top - 24 : rect.bottom + 4;
  const x = Math.max(4, Math.min(rect.left, window.innerWidth - 300));

  return (
    <div class="pp-selection-label" style={{ left: `${x}px`, top: `${y}px` }}>
      {text}
    </div>
  );
};
