// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";

import { FontSizeField } from "./font-size.js";

afterEach(cleanup);

it("steps font sizes by one pixel, or ten pixels with Shift", () => {
  function Controlled() {
    const [value, setValue] = useState(40);
    return (
      <FontSizeField
        label="Size"
        openLabel="Font sizes"
        mixedLabel="Mixed"
        value={value}
        onChange={setValue}
      />
    );
  }
  render(<Controlled />);
  const input = screen.getByLabelText<HTMLInputElement>("Size");
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(input.value).toBe("41");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(input.value).toBe("40");
  fireEvent.keyDown(input, { key: "ArrowUp", shiftKey: true });
  expect(input.value).toBe("50");
  fireEvent.keyDown(input, { key: "ArrowDown", shiftKey: true });
  expect(input.value).toBe("40");
});
