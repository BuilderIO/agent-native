import { describe, expect, it } from "vitest";
import { renderStaticChartSvg } from "./generate-chart.js";

const lightTheme = {
  background: "#ffffff",
  gridColor: "#d4d4d8",
  tickColor: "#71717a",
  titleColor: "#09090b",
  labelColor: "#09090b",
} as const;

const palette = ["#0284C7", "#0D9488", "#16a34a", "#d97706"] as const;

describe("renderStaticChartSvg", () => {
  it("renders a portable svg chart without native canvas", () => {
    const svg = renderStaticChartSvg({
      title: "MCP smoke",
      subtitle: "Hosted fallback",
      labels: ["OAuth", "Tools", "Apps"],
      datasets: [{ label: "Pass", data: [1, 1, 1], color: "#2563eb" }],
      type: "bar",
      width: 800,
      height: 400,
      theme: lightTheme,
      palette,
      primaryColor: "#2563eb",
      stacked: false,
    });

    expect(svg).toContain("<svg");
    expect(svg).toContain("MCP smoke");
    expect(svg).toContain("OAuth");
    expect(svg).toContain("<rect");
  });

  it("escapes user-controlled labels before embedding them in svg text", () => {
    const svg = renderStaticChartSvg({
      title: "<script>alert(1)</script>",
      subtitle: "Unsafe <b>subtitle</b>",
      labels: ['"><img src=x onerror=alert(1)>'],
      datasets: [{ label: "Series", data: [3], color: "red" }],
      type: "line",
      width: 800,
      height: 400,
      theme: lightTheme,
      palette,
      primaryColor: "#2563eb",
      stacked: false,
    });

    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("<img");
    expect(svg).not.toContain("red");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("#2563eb");
  });
});
