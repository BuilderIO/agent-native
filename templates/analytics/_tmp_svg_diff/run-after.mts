import { renderStaticChartSvg } from "../server/lib/report-chart-svg.ts";
import { buildCases } from "./gen-cases.ts";

const cases = buildCases();
const out: string[] = [];
for (const c of cases) {
  out.push(`=== ${c.name} ===`);
  out.push(renderStaticChartSvg(c.args as any));
}
console.log(out.join("\n"));
