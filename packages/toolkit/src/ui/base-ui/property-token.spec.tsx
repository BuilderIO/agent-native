// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { useTokenBinding, type PropertyToken } from "./property-token.js";

it("persists a stable ID and fallback, follows catalog edits, and detaches the latest value", () => {
  const change = vi.fn();
  const inset = { id: "space-2", label: "Medium", value: 8 };
  const { result, rerender } = renderHook(
    ({ tokens, property }) => useTokenBinding(property, tokens, change),
    {
      initialProps: {
        tokens: [inset] as readonly PropertyToken<number>[],
        property: { value: 4 } as { value: number; token?: string },
      },
    },
  );
  result.current.assign(inset.id);
  const property = change.mock.calls[0][0];
  expect(property).toEqual({ token: "space-2", value: 8 });
  rerender({ tokens: [{ ...inset, label: "Roomy", value: 12 }], property });
  expect(result.current.token?.label).toBe("Roomy");
  expect(result.current.resolved).toBe(12);
  result.current.detach();
  expect(change).toHaveBeenLastCalledWith({ value: 12 });
  rerender({ tokens: [], property });
  expect(result.current.token).toBeUndefined();
  expect(result.current.id).toBe("space-2");
  result.current.detach();
  expect(change).toHaveBeenLastCalledWith({ value: 8 });
});
