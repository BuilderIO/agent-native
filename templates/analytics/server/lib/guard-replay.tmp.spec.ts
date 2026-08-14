import { readFileSync, writeFileSync } from "node:fs";

import { describe, it } from "vitest";

import {
  draftClaimsAnalyticsMetrics,
  hasDataQueryAttempt,
  isSafeNoDataAnalyticsResponse,
  looksLikeAnalyticsDataRequest,
  looksLikeDashboardConstructionRequest,
} from "./real-data-actions";

const TURNS = "/private/tmp/claude-501/-Users-steve-Projects-builder-agent-native-framework/0ffd1d9d-78f7-4775-81b3-4486a6f21b29/scratchpad/turns.json";

describe("replay of prod thread 062ab179 through the analytics guard", () => {
  it("prints the guard decision per turn", () => {
    const turns = JSON.parse(readFileSync(TURNS, "utf8")) as Array<{
      role: string;
      id: string;
      text: string;
      tools: string[];
    }>;
    const lines: string[] = [];
    const DATA_TOOLS = new Set(["bigquery", "query-agent-native-analytics"]);
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      if (t.role !== "user") continue;
      const reply = turns[i + 1];
      const userText = t.text;
      const dataReq = looksLikeAnalyticsDataRequest(userText);
      const buildReq = looksLikeDashboardConstructionRequest(userText);
      const ranQuery = (reply?.tools ?? []).some((n) => DATA_TOOLS.has(n));
      const claims = draftClaimsAnalyticsMetrics(reply?.text ?? "");
      const safeNoData = isSafeNoDataAnalyticsResponse(reply?.text ?? "");
      const wouldRetry = (dataReq || buildReq) && !ranQuery && !safeNoData;
      lines.push(
        [
          `--- ${t.id} :: ${JSON.stringify(userText.slice(0, 80))}`,
          `    dataRequest=${dataReq} buildRequest=${buildReq} ranDataQuery=${ranQuery} draftClaimsMetrics=${claims} safeNoData=${safeNoData}`,
          `    replyTools=${JSON.stringify([...new Set(reply?.tools ?? [])])}`,
          `    => GUARD WOULD ${wouldRetry ? "REJECT AND RETRY" : "pass"}`,
        ].join("\n"),
      );
    }
    writeFileSync("/private/tmp/claude-501/-Users-steve-Projects-builder-agent-native-framework/0ffd1d9d-78f7-4775-81b3-4486a6f21b29/scratchpad/guard-replay.txt", lines.join("\n"));
    // Sanity: hasDataQueryAttempt is exercised with real shapes elsewhere.
    void hasDataQueryAttempt;
  });
});
