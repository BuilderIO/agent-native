const MCP_APP_IMPORT =
  "https://esm.sh/@modelcontextprotocol/ext-apps@1.7.2/app-with-deps";
const ANALYTICS_ORIGIN = "https://analytics.agent-native.com";

export const analyticsMcpAppResourceMeta = {
  csp: {
    connectDomains: [ANALYTICS_ORIGIN, "https://esm.sh"],
    resourceDomains: [ANALYTICS_ORIGIN, "https://esm.sh"],
  },
  prefersBorder: true,
};

function attr(value: string | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function analyticsAppHtml({
  title,
  kind,
  requestOrigin,
}: {
  title: string;
  kind: "chart" | "analysis" | "dashboard";
  requestOrigin?: string;
}): string {
  const origin = requestOrigin || ANALYTICS_ORIGIN;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: Canvas; color: CanvasText; }
    body { margin: 0; }
    .shell { display: grid; gap: 12px; padding: 14px; }
    .top { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
    h1 { margin: 0; font-size: 15px; line-height: 1.25; font-weight: 750; }
    h2 { margin: 0 0 6px; font-size: 13px; line-height: 1.3; }
    .muted { color: color-mix(in srgb, CanvasText 58%, Canvas); font-size: 12px; line-height: 1.45; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    button { border: 1px solid color-mix(in srgb, CanvasText 14%, Canvas); border-radius: 7px; background: Canvas; color: CanvasText; cursor: pointer; font: inherit; font-size: 12px; font-weight: 700; min-height: 32px; padding: 0 10px; }
    .card { border: 1px solid color-mix(in srgb, CanvasText 12%, Canvas); border-radius: 8px; padding: 12px; background: color-mix(in srgb, Canvas 96%, CanvasText); }
    .grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
    .chart { width: 100%; min-height: 240px; }
    .chart img, .chart svg { display: block; width: 100%; height: auto; border-radius: 7px; }
    .markdown { max-height: 280px; overflow: auto; white-space: pre-wrap; font-size: 13px; line-height: 1.5; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, Canvas); padding: 7px 6px; text-align: left; vertical-align: top; }
    th { color: color-mix(in srgb, CanvasText 62%, Canvas); font-weight: 700; }
    .panel { display: grid; gap: 4px; min-height: 74px; }
    .panel-kind { color: color-mix(in srgb, CanvasText 55%, Canvas); font-size: 11px; text-transform: uppercase; }
    .empty { border: 1px dashed color-mix(in srgb, CanvasText 22%, Canvas); border-radius: 8px; padding: 16px; }
    @media (max-width: 560px) { .top, .actions { align-items: stretch; flex-direction: column; } button { width: 100%; } }
  </style>
</head>
<body data-kind="${attr(kind)}" data-origin="${attr(origin)}">
  <main id="app" class="shell">
    <div class="empty muted">Loading ${attr(title)}</div>
  </main>
  <script type="module">
    import { App } from "${MCP_APP_IMPORT}";

    const root = document.getElementById("app");
    const kind = document.body.dataset.kind;
    const origin = document.body.dataset.origin || "${ANALYTICS_ORIGIN}";
    const app = new App({ name: "Agent Native Analytics", version: "1.0.0" }, {});
    let toolInput = {};
    let toolResult = {};
    let openUrl = "";

    function esc(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function parseJson(value, fallback) {
      if (value && typeof value === "object") return value;
      if (typeof value !== "string" || !value.trim()) return fallback;
      try { return JSON.parse(value); } catch { return fallback; }
    }

    function parseResult(params) {
      if (!params) return {};
      if (params.structuredContent && typeof params.structuredContent === "object") return params.structuredContent;
      const parts = Array.isArray(params.content) ? params.content : [];
      const textPart = parts.find((part) => part && part.type === "text" && typeof part.text === "string");
      return parseJson(textPart ? textPart.text : "", {});
    }

    function absolutize(url) {
      if (!url) return "";
      try { return new URL(url, origin).toString(); } catch { return ""; }
    }

    function openLinkFrom(params, data) {
      const metaUrl = params && params._meta && params._meta["agent-native/openLink"]
        ? params._meta["agent-native/openLink"].webUrl
        : "";
      return absolutize(metaUrl || data.deepLink || data.url || "");
    }

    function datasetsFromInput() {
      const labels = parseJson(toolInput.labels, []);
      const parsed = parseJson(toolInput.data, []);
      if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === "object" && Array.isArray(parsed[0].data)) {
        return { labels, datasets: parsed };
      }
      return { labels, datasets: [{ label: toolInput.title || "Series", data: Array.isArray(parsed) ? parsed : [] }] };
    }

    function chartSvg() {
      const parsed = datasetsFromInput();
      const labels = Array.isArray(parsed.labels) ? parsed.labels : [];
      const series = parsed.datasets[0] || { data: [] };
      const values = Array.isArray(series.data) ? series.data.map((v) => Number(v) || 0) : [];
      if (!labels.length || !values.length) return '<div class="empty muted">Chart data was not available.</div>';
      const max = Math.max(...values, 1);
      const width = 720;
      const height = 260;
      const pad = 38;
      const slot = (width - pad * 2) / values.length;
      const bars = values.map((value, i) => {
        const barHeight = Math.max(2, (height - pad * 2) * (value / max));
        const x = pad + i * slot + slot * 0.18;
        const y = height - pad - barHeight;
        return '<rect x="' + x + '" y="' + y + '" width="' + Math.max(8, slot * 0.64) + '" height="' + barHeight + '" rx="4" fill="#2563eb"></rect>' +
          '<text x="' + (pad + i * slot + slot / 2) + '" y="' + (height - 12) + '" text-anchor="middle" font-size="10" fill="currentColor">' + esc(String(labels[i] ?? "")) + '</text>';
      }).join("");
      return '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Chart preview">' +
        '<rect width="' + width + '" height="' + height + '" rx="8" fill="color-mix(in srgb, Canvas 98%, CanvasText)"></rect>' +
        '<line x1="' + pad + '" x2="' + (width - pad) + '" y1="' + (height - pad) + '" y2="' + (height - pad) + '" stroke="color-mix(in srgb, CanvasText 18%, Canvas)"></line>' +
        bars +
        '</svg>';
    }

    function resultRows() {
      const data = toolResult.resultData || toolResult.data || toolInput.resultData || {};
      const arrays = Object.values(data).filter(Array.isArray);
      const rows = arrays.find((items) => items.some((item) => item && typeof item === "object" && !Array.isArray(item))) || [];
      return rows.slice(0, 8);
    }

    function renderTable(rows) {
      if (!rows.length) return "";
      const columns = Object.keys(rows[0]).slice(0, 6);
      return '<div class="card"><h2>Data</h2><table><thead><tr>' +
        columns.map((c) => '<th>' + esc(c) + '</th>').join("") +
        '</tr></thead><tbody>' +
        rows.map((row) => '<tr>' + columns.map((c) => '<td>' + esc(row[c]) + '</td>').join("") + '</tr>').join("") +
        '</tbody></table></div>';
    }

    function renderShell(title, subtitle, body) {
      const openButton = openUrl ? '<button type="button" data-open>Open in Analytics</button>' : "";
      root.innerHTML = '<section class="top"><div><h1>' + esc(title) + '</h1>' +
        (subtitle ? '<div class="muted">' + esc(subtitle) + '</div>' : "") +
        '</div><div class="actions">' + openButton + '</div></section>' + body;
      root.querySelector("[data-open]")?.addEventListener("click", () => {
        if (openUrl) void app.openLink({ url: openUrl });
      });
    }

    function renderDashboard() {
      const config = toolResult.config || parseJson(toolInput.config, {}) || {};
      const panels = Array.isArray(config.panels) ? config.panels : [];
      const cards = panels.map((panel) =>
        '<section class="card panel"><div class="panel-kind">' + esc(panel.chartType || "panel") + '</div><h2>' + esc(panel.title || panel.id || "Untitled panel") + '</h2><div class="muted">' + esc(panel.source || "layout") + '</div></section>'
      ).join("");
      renderShell(config.name || toolResult.name || toolInput.dashboardId || "Dashboard", panels.length + " panel" + (panels.length === 1 ? "" : "s"),
        '<div class="grid">' + (cards || '<div class="empty muted">Dashboard panels were not available.</div>') + '</div>');
    }

    function renderAnalysis() {
      const rows = resultRows();
      renderShell(toolResult.name || toolInput.name || "Analysis", toolResult.description || toolInput.description || "",
        '<section class="card markdown">' + esc(toolResult.resultMarkdown || toolInput.resultMarkdown || "Analysis content was not available.") + '</section>' + renderTable(rows));
    }

    function renderChart() {
      const image = toolResult.url ? '<img src="' + esc(absolutize(toolResult.url)) + '" alt="Generated chart">' : chartSvg();
      renderShell(toolInput.title || toolResult.filename || "Chart", toolInput.subtitle || "", '<section class="card chart">' + image + '</section>');
    }

    function render() {
      if (kind === "dashboard") return renderDashboard();
      if (kind === "analysis") return renderAnalysis();
      return renderChart();
    }

    app.ontoolinput = (params) => {
      toolInput = params.arguments || {};
      render();
    };
    app.ontoolresult = (params) => {
      toolResult = parseResult(params);
      openUrl = openLinkFrom(params, toolResult);
      render();
    };
    await app.connect();
  </script>
</body>
</html>`;
}

export function analyticsChartMcpAppHtml({
  requestOrigin,
}: {
  requestOrigin?: string;
}): string {
  return analyticsAppHtml({
    title: "chart",
    kind: "chart",
    requestOrigin,
  });
}

export function analyticsAnalysisMcpAppHtml({
  requestOrigin,
}: {
  requestOrigin?: string;
}): string {
  return analyticsAppHtml({
    title: "analysis",
    kind: "analysis",
    requestOrigin,
  });
}

export function analyticsDashboardMcpAppHtml({
  requestOrigin,
}: {
  requestOrigin?: string;
}): string {
  return analyticsAppHtml({
    title: "dashboard",
    kind: "dashboard",
    requestOrigin,
  });
}
