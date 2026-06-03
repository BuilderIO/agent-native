import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { loadContractBundle } from "./_contracts.js";

export default defineAction({
  description:
    "Export a Visual Plan as interactive HTML, Markdown fallback, and structured JSON.",
  schema: z.object({
    contractId: z.string().describe("Visual Plan ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "Export Visual Plan",
    description: "Export a Visual Plan as HTML, Markdown, and JSON.",
  },
  run: async (args) => {
    const bundle = await loadContractBundle(args.contractId);
    const html = renderHtmlPlan(bundle);
    const lines = [
      `# ${bundle.contract.title}`,
      "",
      bundle.contract.goal,
      "",
      `Status: ${bundle.contract.status}`,
      "",
      "## Review Summary",
      "",
      `- Needs review: ${bundle.summary.reviewCount}`,
      `- Verified criteria: ${bundle.summary.verifiedCount}`,
      `- Missing evidence: ${bundle.summary.missingEvidenceCount}`,
      "",
      "## Assumptions",
      "",
      ...bundle.items
        .filter((item) => item.type === "assumption")
        .map(
          (item) =>
            `- [${item.reviewState}] ${item.title}${item.impactSummary ? ` — ${item.impactSummary}` : ""}`,
        ),
      "",
      "## Acceptance Criteria",
      "",
      ...bundle.items
        .filter((item) => item.type === "acceptance_criterion")
        .map((item) => `- [${item.reviewState}] ${item.title}`),
      "",
      "## Evidence",
      "",
      ...bundle.evidence.map(
        (item) =>
          `- [${item.trustLevel}] ${item.summary}${item.command ? ` (${item.command})` : ""}`,
      ),
    ];
    return {
      html,
      markdown: lines.join("\n"),
      json: bundle,
    };
  },
});

function renderHtmlPlan(
  bundle: Awaited<ReturnType<typeof loadContractBundle>>,
) {
  const assumptions = bundle.items.filter((item) => item.type === "assumption");
  const criteria = bundle.items.filter(
    (item) => item.type === "acceptance_criterion",
  );
  const approach = bundle.items.filter((item) =>
    ["decision", "constraint", "task"].includes(item.type),
  );
  const artifacts = bundle.evidence.filter((item) =>
    ["artifact", "screenshot", "diff"].includes(item.type),
  );
  const title = escapeHtml(bundle.contract.title);
  const status = escapeHtml(bundle.contract.status);
  const goal = escapeHtml(bundle.contract.goal);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root { color-scheme: light dark; --bg: #0b0b0c; --panel: #121214; --line: #27272a; --text: #f4f4f5; --muted: #a1a1aa; --soft: #18181b; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
    main { max-width: 1120px; margin: 0 auto; padding: 32px 20px 48px; }
    header { display: grid; gap: 16px; padding-bottom: 24px; border-bottom: 1px solid var(--line); }
    h1 { margin: 0; font-size: clamp(28px, 5vw, 48px); letter-spacing: -0.03em; line-height: 1; }
    h2 { margin: 0 0 12px; font-size: 18px; }
    p { color: var(--muted); line-height: 1.6; }
    .badge { display: inline-flex; width: max-content; border: 1px solid var(--line); border-radius: 999px; padding: 6px 10px; color: var(--muted); font-size: 12px; }
    .grid { display: grid; gap: 14px; }
    .hero { grid-template-columns: minmax(0, 1.2fr) minmax(260px, .8fr); align-items: stretch; }
    .panel { border: 1px solid var(--line); border-radius: 14px; background: var(--panel); padding: 18px; }
    .wireframe { min-height: 280px; display: grid; grid-template-columns: 180px 1fr; overflow: hidden; padding: 0; }
    .sidebar { border-right: 1px solid var(--line); padding: 16px; background: var(--soft); }
    .canvas { padding: 18px; }
    .bar { height: 10px; border-radius: 999px; background: #71717a; opacity: .5; }
    .box { min-height: 80px; border: 1px dashed var(--line); border-radius: 10px; background: var(--soft); }
    .flow { grid-template-columns: repeat(4, minmax(0,1fr)); }
    .card { border: 1px solid var(--line); border-radius: 12px; padding: 14px; background: var(--panel); }
    .muted { color: var(--muted); }
    button, .button { border: 1px solid var(--line); background: var(--soft); color: var(--text); border-radius: 8px; padding: 8px 10px; font: inherit; font-size: 13px; }
    ul { padding-left: 18px; color: var(--muted); line-height: 1.7; }
    @media (max-width: 760px) { .hero, .wireframe, .flow { grid-template-columns: 1fr; } .sidebar { border-right: 0; border-bottom: 1px solid var(--line); } }
  </style>
</head>
<body>
  <main>
    <header>
      <span class="badge">HTML plan mode / ${status}</span>
      <h1>${title}</h1>
      <p>${goal}</p>
    </header>

    <section class="grid hero" style="margin-top: 22px;">
      <div class="panel wireframe">
        <aside class="sidebar">
          <span class="badge">review ${bundle.summary.reviewCount}</span>
          <p>Visual first. Text is the fallback layer.</p>
          <button onclick="navigator.clipboard?.writeText('Please revise the visual plan: ')">Copy feedback starter</button>
        </aside>
        <div class="canvas">
          <div class="bar" style="width: 44%;"></div>
          <div class="bar" style="width: 68%; margin-top: 10px;"></div>
          <div class="grid" style="grid-template-columns: repeat(3, 1fr); margin-top: 24px;">
            <div class="box"></div><div class="box"></div><div class="box"></div>
          </div>
          <div class="panel" style="margin-top: 16px;">Proof missing: ${bundle.summary.missingEvidenceCount}</div>
        </div>
      </div>
      <div class="grid">
        <section class="panel"><h2>Assumptions to react to</h2>${renderList(assumptions)}</section>
        <section class="panel"><h2>Proof gates</h2>${renderList(criteria)}</section>
      </div>
    </section>

    <section class="panel" style="margin-top: 18px;">
      <h2>Flow</h2>
      <div class="grid flow">
        <div class="card"><strong>Intent</strong><p>${goal}</p></div>
        <div class="card"><strong>Assumptions</strong><p>${assumptions.length} item(s)</p></div>
        <div class="card"><strong>Approach</strong><p>${approach.length} item(s)</p></div>
        <div class="card"><strong>Proof</strong><p>${criteria.length} gate(s)</p></div>
      </div>
    </section>

    <section class="panel" style="margin-top: 18px;">
      <h2>Diagrams, mockups, artifacts</h2>
      ${artifacts.length ? renderEvidence(artifacts) : "<p>No generated artifacts attached yet. Ask the agent for diagrams, wireframes, or a clickable prototype.</p>"}
    </section>
  </main>
</body>
</html>`;
}

function renderList(
  items: Awaited<ReturnType<typeof loadContractBundle>>["items"],
) {
  if (items.length === 0) return "<p>None captured yet.</p>";
  return `<ul>${items
    .slice(0, 8)
    .map((item) => `<li><strong>${escapeHtml(item.title)}</strong></li>`)
    .join("")}</ul>`;
}

function renderEvidence(
  items: Awaited<ReturnType<typeof loadContractBundle>>["evidence"],
) {
  return `<div class="grid">${items
    .slice(0, 8)
    .map(
      (item) =>
        `<div class="card"><strong>${escapeHtml(item.summary)}</strong><p>${escapeHtml(item.type)} / ${escapeHtml(item.trustLevel)}</p></div>`,
    )
    .join("")}</div>`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
