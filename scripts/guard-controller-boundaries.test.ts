import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findControllerBoundaryViolations } from "./guard-controller-boundaries";

describe("controller boundary guard", () => {
  it("rejects presentation imports, JSX, class names, and Tailwind classes", () => {
    const violations = findControllerBoundaryViolations(
      "packages/example/useExampleController.tsx",
      `
        import { Button } from "@agent-native/toolkit/ui/button";
        export function useExampleController() {
          const className = "flex items-center gap-2";
          return <Button className={className} />;
        }
      `,
    );

    assert.deepEqual(
      violations.map(({ reason }) => reason),
      [
        "imports presentation module @agent-native/toolkit/ui/button",
        "contains className presentation state",
        "contains JSX",
        "contains Tailwind utility classes",
      ],
    );
  });

  it("allows React hooks, semantic state, and HTML embed strings", () => {
    const violations = findControllerBoundaryViolations(
      "packages/example/useExampleController.ts",
      `
        import { useMemo } from "react";
        export function useExampleController() {
          return useMemo(() => ({ status: "ready", embed: "<iframe style='position:absolute'></iframe>" }), []);
        }
      `,
    );
    assert.deepEqual(violations, []);
  });
});
