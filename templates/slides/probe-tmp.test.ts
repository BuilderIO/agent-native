import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { cssGradientToDrawingMl } from "./actions/export-pptx";

const cases = [
  "linear-gradient(140.02deg, #013445 0%, #018589 100%)",
  "radial-gradient(circle at 0% 0%, #013445 0%, #018589 100%)",
  "linear-gradient(red, blue)",
  "linear-gradient(to right, #013445, #018589)",
  "linear-gradient(to bottom, #013445, #018589)",
  "linear-gradient(to top right, #013445, #018589)",
  "radial-gradient(circle, #013445, #018589)",
  "radial-gradient(ellipse at center, #013445, #018589)",
  "conic-gradient(#013445, #018589)",
  "linear-gradient(45deg, #013445 0%, #0a5f6b 50%, #018589 100%)",
];
it("probe", () => {
  const lines: string[] = [];
  for (const c of cases) {
    lines.push("IN : " + c);
    lines.push("OUT: " + (cssGradientToDrawingMl(c) ?? "undefined"));
    lines.push("");
  }
  writeFileSync("/tmp/probe-out.txt", lines.join("\n"));
});
