import { buildCases } from "./_tmp_verify_cases.ts";
import { renderStaticChartSvg } from "./_tmp_verify_original.ts";

const cases = buildCases();
const out: string[] = [];
for (const c of cases) {
  out.push(`=== ${c.name} ===`);
  out.push(renderStaticChartSvg(c.args as any));
}
console.log(out.join("\n"));
