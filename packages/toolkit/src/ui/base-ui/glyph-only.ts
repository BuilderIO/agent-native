import * as React from "react";

/**
 * True when every child is an element and none is text, so a control that
 * holds only its glyph can draw square instead of padding for a label.
 */
export function glyphOnly(children: React.ReactNode): boolean {
  const items = React.Children.toArray(children);
  return (
    items.length > 0 && items.every((child) => React.isValidElement(child))
  );
}
