// @vitest-environment jsdom
import { checkboxCardsProps } from "@agent-native/design-system";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, expect, it } from "vitest";

import { createGroupProps } from "./group-props.js";

afterEach(cleanup);

it("only propagates changes to inherited design props", () => {
  const { GroupProps, useGroupProps } = createGroupProps(checkboxCardsProps);
  let renders = 0;
  const Item = React.memo(({ override }: { override: boolean }) => {
    renders++;
    const props = useGroupProps({ highContrast: override ? false : undefined });
    return <span data-contrast={props.highContrast} />;
  });
  const items = Array.from({ length: 128 }, (_, i) => (
    <Item key={i} override={i === 0} />
  ));
  const { container, rerender } = render(
    <GroupProps value={{ color: "gray" }}>{items}</GroupProps>,
  );
  renders = 0;
  rerender(<GroupProps value={{ color: "gray" }}>{items}</GroupProps>);
  expect(renders).toBe(0);
  rerender(
    <GroupProps value={{ color: "gray", highContrast: true }}>
      {items}
    </GroupProps>,
  );
  expect(container.querySelectorAll('[data-contrast="true"]')).toHaveLength(
    127,
  );
  expect(container.firstElementChild?.getAttribute("data-contrast")).toBe(
    "false",
  );
  rerender(<GroupProps value={{}}>{items}</GroupProps>);
  expect(container.querySelectorAll("[data-contrast]")).toHaveLength(1);
});
