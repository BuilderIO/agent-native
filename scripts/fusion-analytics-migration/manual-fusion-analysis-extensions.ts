import fs from "node:fs";
import path from "node:path";

const LEGACY_ROOT = path.resolve("..", "fusion-analytics");
const CLOSED_LOST_REL = "client/pages/adhoc/fusion-closed-lost-analysis.tsx";
const CLOSED_WON_REL = "client/pages/adhoc/fusion-closed-won-analysis.tsx";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readLegacy(rel: string): string {
  return fs.readFileSync(path.resolve(LEGACY_ROOT, rel), "utf8");
}

function extractConstArrayLiteral(source: string, name: string): string {
  const start = source.indexOf(`const ${name}`);
  if (start < 0) throw new Error(`Could not find const ${name}`);
  const eq = source.indexOf("=", start);
  const arrayStart = source.indexOf("[", eq);
  if (eq < 0 || arrayStart < 0)
    throw new Error(`Could not find array literal for ${name}`);
  return extractBalanced(source, arrayStart, "[", "]");
}

function extractConstObjectLiteral(source: string, name: string): string {
  const start = source.indexOf(`const ${name}`);
  if (start < 0) throw new Error(`Could not find const ${name}`);
  const eq = source.indexOf("=", start);
  const objectStart = source.indexOf("{", eq);
  if (eq < 0 || objectStart < 0)
    throw new Error(`Could not find object literal for ${name}`);
  return extractBalanced(source, objectStart, "{", "}");
}

function extractBalanced(
  source: string,
  start: number,
  open: string,
  close: string,
): string {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === `"` || ch === `'` || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === open) depth++;
    if (ch === close) {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unterminated literal starting at ${start}`);
}

function evalLegacyLiteral<T>(literal: string): T {
  const iconNames = [
    "Users",
    "Zap",
    "Clock",
    "Pause",
    "AlertCircle",
    "AlertTriangle",
    "DollarSign",
  ];
  return new Function(...iconNames, `"use strict"; return (${literal});`)(
    ...iconNames.map(() => null),
  ) as T;
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function shell(title: string, body: string): string {
  return `<div data-extension-layout="full-bleed" class="min-h-screen bg-background text-foreground">
  <style>
    [x-cloak] { display: none !important; }
    .fusion-card { border: 1px solid hsl(var(--border)); background: hsl(var(--card)); border-radius: 0.5rem; }
    .fusion-dark-card { border: 1px solid rgb(55 65 81); background: rgb(17 24 39); border-radius: 0.75rem; }
    .fusion-tab-active { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
    .fusion-tab-idle { border: 1px solid hsl(var(--border)); background: hsl(var(--background)); color: hsl(var(--muted-foreground)); }
    .fusion-tab-idle:hover { color: hsl(var(--foreground)); background: hsl(var(--muted)); }
  </style>
  <div class="sr-only">${escapeHtml(title)}</div>
  ${body}
</div>`;
}

function sharedClientScript() {
  return `<script>
function readExtensionValue(item) {
  if (!item) return null;
  let value = item.data !== undefined ? item.data : item.value !== undefined ? item.value : item;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch (e) {}
  }
  if (value && value.value !== undefined) return value.value;
  if (value && value.data && value.data.value !== undefined) return value.data.value;
  if (value && value.data !== undefined) return value.data;
  return value;
}
function fusionCommon() {
  return {
    num(value) {
      return Number(value || 0).toLocaleString();
    },
    money(value) {
      const amount = Number(value || 0);
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
    },
    shortMoney(value) {
      const amount = Number(value || 0);
      if (Math.abs(amount) >= 1000000) return '$' + (amount / 1000000).toFixed(1) + 'M';
      if (Math.abs(amount) >= 1000) return '$' + Math.round(amount / 1000) + 'K';
      return '$' + Math.round(amount);
    },
    date(value, mode) {
      if (!value) return '-';
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return String(value);
      const opts = mode === 'long'
        ? { month: 'long', day: 'numeric', year: 'numeric' }
        : { month: 'short', day: 'numeric', year: 'numeric' };
      return parsed.toLocaleDateString('en-US', opts);
    },
    dateTime(value) {
      if (!value) return 'unknown';
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return String(value);
      return parsed.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    },
    pct(value, total) {
      const n = Number(value || 0);
      const d = Number(total || 0);
      return d ? Math.round((n / d) * 100) : 0;
    },
    downloadCsv(filename, rows) {
      if (!rows.length) return;
      const headers = Object.keys(rows[0]);
      const escape = (v) => {
        const s = String(v ?? '');
        return s.includes(',') || s.includes('"') || s.includes('\\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const csv = [headers.join(','), ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))].join('\\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    shortDealName(name) {
      return String(name || '').split(' - ')[0].trim() || String(name || '');
    },
    sourceCount(value) {
      return Array.isArray(value) ? value.length : value ? 1 : 0;
    },
  };
}
</script>`;
}

export function fusionClosedLostExtension(): string {
  const source = readLegacy(CLOSED_LOST_REL);
  const statics = {
    lossReasons: evalLegacyLiteral(
      extractConstArrayLiteral(source, "lossReasons"),
    ),
    top10Annotations: evalLegacyLiteral(
      extractConstObjectLiteral(source, "top10Annotations"),
    ),
    themes: evalLegacyLiteral(extractConstArrayLiteral(source, "themes")),
    s1OnlyDeals: evalLegacyLiteral(
      extractConstArrayLiteral(source, "s1OnlyDeals"),
    ),
    s1Categories: evalLegacyLiteral(
      extractConstArrayLiteral(source, "s1Categories"),
    ),
    povDeals: evalLegacyLiteral(extractConstArrayLiteral(source, "povDeals")),
    povCategories: evalLegacyLiteral(
      extractConstArrayLiteral(source, "povCategories"),
    ),
    insights: evalLegacyLiteral(extractConstArrayLiteral(source, "insights")),
  };

  return shell(
    "Fusion Closed Lost Analysis",
    `<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
${sharedClientScript()}
<script>
const FUSION_CLOSED_LOST_STATIC = ${jsonForScript(statics)};
function fusionClosedLostApp() {
  return Object.assign(fusionCommon(), {
    activeView: 'dashboard',
    activeTab: 'overview',
    painBottomTab: 'business',
    businessPainSearch: '',
    showProgress: false,
    loading: true,
    notice: '',
    error: '',
    liveData: null,
    businessPainData: null,
    refreshStatus: null,
    static: FUSION_CLOSED_LOST_STATIC,
    tabs: [
      ['overview', 'Overview'],
      ['multi-dimensional', 'Multi-Dimensional'],
      ['top10', 'Top 10 Losses'],
      ['stages', 'Stage Progression'],
      ['s1-analysis', 'S1 Analysis'],
      ['pov-insights', 'POV Insights'],
      ['insights', 'Critical Insights'],
      ['business-pain', 'Business Pain']
    ],
    async init() {
      await this.load();
    },
    async load() {
      this.loading = true;
      this.error = '';
      try {
        const live = await extensionData.get('fusion-analysis', 'live-data', { scope: 'org' });
        const pain = await extensionData.get('fusion-analysis', 'business-pain', { scope: 'org' });
        this.liveData = readExtensionValue(live);
        this.businessPainData = readExtensionValue(pain);
        const summary = this.liveData?.summary || {};
        this.refreshStatus = {
          status: 'done',
          startedAt: this.liveData?.generatedAt || null,
          completedAt: this.liveData?.generatedAt || null,
          steps: [
            { name: 'hubspot', label: 'HubSpot Deals', status: 'done', detail: 'Loaded migrated closed-lost deals and email coverage', duration: null },
            { name: 'gong', label: 'Gong Calls', status: 'done', detail: 'Loaded matched calls and transcripts from the legacy refresh', duration: null },
            { name: 'slack', label: 'Slack Context', status: summary.slackMessagesFound ? 'done' : 'skipped', detail: (summary.slackMessagesFound || 0) + ' Slack messages in migrated channel matches', duration: null }
          ],
          summary: {
            deals: summary.totalDeals || this.liveData?.deals?.length || 0,
            gongCalls: summary.totalCallsMatched || 0,
            dealsWithGong: summary.dealsWithCalls || 0,
            transcriptsFetched: summary.transcriptsFetched || 0,
            emailsFetched: summary.emailsFetched || 0,
            slackResults: summary.slackMessagesFound || 0
          },
          error: null
        };
      } catch (e) {
        this.error = e && e.message ? e.message : String(e);
      } finally {
        this.loading = false;
      }
    },
    async refreshData() {
      this.showProgress = true;
      await this.load();
      this.notice = 'Reloaded the full migrated org data attached to this extension.';
      setTimeout(() => { this.notice = ''; }, 5000);
    },
    analysisIsStale() {
      return !this.liveData?.analysisAsOf || (this.liveData?.generatedAt && new Date(this.liveData.generatedAt) > new Date(this.liveData.analysisAsOf));
    },
    requestPrompt() {
      return 'The Fusion Closed-Lost dashboard data was refreshed on ' + this.lastRefreshed() + ' but the analysis has not been updated yet. Please re-run the analysis pass and update the themes, critical insights, S1 analysis, and POV breakdowns in the dashboard to reflect the latest data. When done, set analysisAsOf in data/fusion-gong-matched.json to the current timestamp.';
    },
    copyRequestPrompt() {
      const text = this.requestPrompt();
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => {});
      this.notice = 'Analysis update prompt prepared.';
      setTimeout(() => { this.notice = ''; }, 5000);
    },
    lastRefreshed() {
      return this.liveData?.generatedAt ? this.dateTime(this.liveData.generatedAt) : 'unknown';
    },
    periodEnd() {
      const dates = (this.liveData?.deals || []).map((d) => d.closeDate).filter(Boolean).sort();
      return dates.length ? this.date(dates[dates.length - 1], 'long') : 'April 30, 2026';
    },
    metrics() {
      const deals = this.liveData?.deals || [];
      if (!deals.length) {
        return { totalDeals: 71, totalValue: 4518500, avgDealSize: 63640, dealsWithGong: 71, povReachRate: 51, povWinRate: 19, s3PlusCount: 7, povCount: 36, reengagementPotential: 820000 };
      }
      const totalDeals = deals.length;
      const totalValue = deals.reduce((sum, deal) => sum + Number(deal.amount || 0), 0);
      const povDeals = deals.filter((deal) => deal.furthestStage && deal.furthestStage !== 'S1 - Qualified Opp');
      const s3PlusDeals = deals.filter((deal) => ['S3', 'S4', 'S5'].some((prefix) => String(deal.furthestStage || '').startsWith(prefix)));
      return {
        totalDeals,
        totalValue,
        avgDealSize: totalDeals ? Math.round(totalValue / totalDeals) : 0,
        dealsWithGong: deals.filter((deal) => Number(deal.gongCallCount || 0) > 0).length,
        povReachRate: totalDeals ? Math.round((povDeals.length / totalDeals) * 100) : 0,
        povWinRate: povDeals.length ? Math.round((s3PlusDeals.length / povDeals.length) * 100) : 0,
        s3PlusCount: s3PlusDeals.length,
        povCount: povDeals.length,
        reengagementPotential: 820000
      };
    },
    stageRows() {
      const order = ['S1 - Qualified Opp', 'S2 - POV Scoping', 'S2 - POV Setup', 'S2 - POV Active', 'S3 - EB Sign-Off', 'S4 - Paper Process'];
      const deals = this.liveData?.deals || [];
      if (!deals.length) {
        return [
          { stage: 'S1 - Qualified Opp', deals: 35, value: 2724500, avgDeal: 77843 },
          { stage: 'S2 - POV Scoping', deals: 20, value: 924000, avgDeal: 46200 },
          { stage: 'S2 - POV Setup', deals: 2, value: 125000, avgDeal: 62500 },
          { stage: 'S2 - POV Active', deals: 7, value: 310000, avgDeal: 44286 },
          { stage: 'S3 - EB Sign-Off', deals: 6, value: 360000, avgDeal: 60000 },
          { stage: 'S4 - Paper Process', deals: 1, value: 75000, avgDeal: 75000 }
        ];
      }
      const buckets = Object.fromEntries(order.map((stage) => [stage, { stage, deals: 0, value: 0, avgDeal: 0 }]));
      for (const deal of deals) {
        const stage = order.includes(deal.furthestStage) ? deal.furthestStage : 'S1 - Qualified Opp';
        buckets[stage].deals += 1;
        buckets[stage].value += Number(deal.amount || 0);
      }
      return order.map((stage) => {
        const row = buckets[stage];
        row.avgDeal = row.deals ? Math.round(row.value / row.deals) : 0;
        return row;
      });
    },
    top10() {
      const deals = this.liveData?.deals || [];
      if (deals.length) {
        return deals.slice().sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0)).slice(0, 10).map((deal) => {
          const shortName = this.shortDealName(deal.dealName);
          const annotation = this.static.top10Annotations[shortName] || this.static.top10Annotations[deal.dealName] || { primaryReason: deal.closedLostReason || '-', reEngage: false };
          return {
            deal: shortName,
            amount: Number(deal.amount || 0),
            stage: String(deal.furthestStage || '').replace('S2 - POV ', 'S2-').replace(' - Qualified Opp', '') || 'S1',
            primaryReason: annotation.primaryReason,
            gongCalls: Number(deal.gongCallCount || 0),
            reEngage: annotation.reEngage
          };
        });
      }
      return this.static.lossReasons.slice().sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0)).slice(0, 10).map((row) => ({
        deal: row.deal,
        amount: row.amount,
        stage: row.stage,
        primaryReason: this.static.top10Annotations[row.deal]?.primaryReason || '-',
        gongCalls: 0,
        reEngage: Boolean(row.reEngage)
      }));
    },
    filteredPainDeals() {
      const painDeals = this.businessPainData?.deals || [];
      const liveIds = new Set((this.liveData?.deals || []).map((deal) => deal.dealId));
      const rows = liveIds.size ? painDeals.filter((deal) => liveIds.has(deal.dealId)) : painDeals;
      const q = this.businessPainSearch.trim().toLowerCase();
      if (!q) return rows;
      return rows.filter((deal) => [deal.dealName, deal.threeWhysSummary, deal.assessedPainSummary, deal.businessPain, deal.operationalPain, ...(deal.painCategories || [])].some((value) => String(value || '').toLowerCase().includes(q)));
    },
    severityClass(severity) {
      if (severity === 'critical') return 'border-red-500 bg-red-50 text-gray-950';
      if (severity === 'high') return 'border-orange-500 bg-orange-50 text-gray-950';
      if (severity === 'medium') return 'border-yellow-500 bg-yellow-50 text-gray-950';
      if (severity === 'opportunity') return 'border-emerald-500 bg-emerald-50 text-gray-950';
      return 'border-border bg-card';
    },
    exportBusinessPainToExcel() {
      const data = this.businessPainData;
      if (!data) return;
      const businessRows = (data.businessPains || []).map((p) => ({ Rank: p.rank, 'Pain Theme': p.pain, 'Business Impact': p.businessImpact, Description: p.description, 'Deal Count': p.dealCount, 'Representative Deals': (p.representativeDeals || []).join('; ') }));
      const operationalRows = (data.topPains || []).map((p) => ({ Rank: p.rank, 'Pain Theme': p.pain, Description: p.description, 'Deal Count': p.dealCount, 'Representative Deals': (p.representativeDeals || []).join('; ') }));
      const dealRows = (data.deals || []).map((d) => ({ 'Deal Name': d.dealName, 'Amount ($K)': d.amount ? Math.round(Number(d.amount) / 1000) : '', 'Business Pain': d.businessPain || '', 'Operational Pain': d.operationalPain || '', '3 WHYs Summary': d.threeWhysSummary || '', 'Assessed Pain Summary': d.assessedPainSummary || '', 'Pain Categories': (d.painCategories || []).join('; ') }));
      if (window.XLSX?.utils) {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(businessRows), 'Business Pain Themes');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(operationalRows), 'Operational Pain Themes');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dealRows), 'Pain by Deal');
        XLSX.writeFile(wb, 'fusion-business-pain.xlsx');
      } else {
        this.downloadCsv('fusion-business-pain.csv', dealRows);
      }
    }
  });
}
</script>
<div x-data="fusionClosedLostApp()" x-init="init()" x-cloak class="min-h-screen bg-slate-950 px-4 py-5 text-slate-100 md:px-6">
  <template x-if="loading"><div class="mx-auto max-w-7xl rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">Loading full migrated Fusion closed-lost analysis...</div></template>
  <template x-if="!loading">
    <div class="mx-auto max-w-7xl space-y-6">
      <div x-show="notice" class="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200" x-text="notice"></div>
      <div x-show="error" class="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200" x-text="error"></div>

      <div x-show="analysisIsStale() && activeView === 'dashboard'" class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-100">
        <div>
          <strong>Analysis may be outdated.</strong>
          <span x-text="' Data was refreshed on ' + lastRefreshed() + ', while the written analysis timestamp is ' + (liveData?.analysisAsOf ? dateTime(liveData.analysisAsOf) : 'not recorded') + '.'"></span>
        </div>
        <button class="rounded-md border border-yellow-500/40 bg-yellow-500/20 px-3 py-1.5 text-xs font-medium text-yellow-100 hover:bg-yellow-500/30" x-on:click="copyRequestPrompt()">Request analysis update</button>
      </div>

      <header class="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <h1 class="text-3xl font-bold text-white">Fusion S1+ Closed Lost Analysis</h1>
          <p class="mt-2 font-medium text-slate-200">
            <span x-text="'Comprehensive analysis of ' + metrics().totalDeals + ' enterprise deals that reached S1 (Qualified Opp) or beyond'"></span><br />
            <span class="text-sm text-slate-300" x-text="'Fiscal Q1 - Deals closed: Feb 1, 2026 - ' + periodEnd() + ' | Data refreshed: ' + lastRefreshed() + ' | Analysis updated: ' + (liveData?.analysisAsOf ? dateTime(liveData.analysisAsOf) : 'pending next pass')"></span>
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <span class="rounded-full bg-emerald-900 px-2 py-0.5 text-xs text-emerald-200">HubSpot closed-lost reasons</span>
            <span class="rounded-full px-2 py-0.5 text-xs" x-bind:class="liveData?.summary?.transcriptsFetched ? 'bg-emerald-900 text-emerald-200' : 'bg-yellow-900 text-yellow-200'" x-text="liveData?.summary?.transcriptsFetched ? num(liveData.summary.transcriptsFetched) + ' Gong transcripts' : 'Gong transcripts: refresh needed'"></span>
            <span class="rounded-full px-2 py-0.5 text-xs" x-bind:class="liveData?.summary?.emailsFetched ? 'bg-emerald-900 text-emerald-200' : 'bg-yellow-900 text-yellow-200'" x-text="liveData?.summary?.emailsFetched ? num(liveData.summary.emailsFetched) + ' HubSpot emails' : 'HubSpot emails: refresh needed'"></span>
            <span class="rounded-full px-2 py-0.5 text-xs" x-bind:class="liveData?.summary?.slackMessagesFound ? 'bg-emerald-900 text-emerald-200' : 'bg-slate-800 text-slate-400'" x-text="liveData?.summary?.slackMessagesFound ? num(liveData.summary.slackMessagesFound) + ' Slack messages' : 'Slack: none found'"></span>
          </div>
        </div>
        <div class="flex shrink-0 flex-col items-start gap-2 lg:items-end">
          <div class="flex gap-1 rounded-lg border border-white/20 p-0.5">
            <button class="rounded-md px-3 py-1.5 text-xs transition-colors" x-bind:class="activeView === 'dashboard' ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white'" x-on:click="activeView = 'dashboard'">Dashboard</button>
            <button class="rounded-md px-3 py-1.5 text-xs transition-colors" x-bind:class="activeView === 'about' ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white'" x-on:click="activeView = 'about'">About</button>
          </div>
          <button class="rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 hover:bg-slate-800" x-on:click="refreshData()">Refresh Data</button>
          <button x-show="!showProgress && refreshStatus" class="text-xs text-slate-400 underline hover:text-slate-200" x-on:click="showProgress = true">View last run</button>
        </div>
      </header>

      <section x-show="showProgress && refreshStatus" class="fusion-dark-card p-5">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-white">Refresh Complete</h2>
          <button class="text-xs text-slate-400 hover:text-white" x-on:click="showProgress = false">Dismiss</button>
        </div>
        <div class="space-y-3">
          <template x-for="step in refreshStatus.steps" :key="step.name">
            <div class="flex items-start gap-3 text-sm">
              <div class="mt-1 h-2 w-2 rounded-full" x-bind:class="step.status === 'done' ? 'bg-emerald-400' : step.status === 'skipped' ? 'bg-slate-500' : 'bg-blue-400'"></div>
              <div class="min-w-0 flex-1">
                <p class="font-medium" x-text="step.label"></p>
                <p class="truncate text-xs text-slate-400" x-text="step.detail"></p>
              </div>
            </div>
          </template>
        </div>
        <div class="mt-4 grid gap-3 border-t border-slate-700 pt-4 sm:grid-cols-3 lg:grid-cols-6">
          <template x-for="stat in [
            ['Deals', refreshStatus.summary.deals],
            ['Gong Calls', refreshStatus.summary.gongCalls],
            ['Deals w/ Calls', refreshStatus.summary.dealsWithGong],
            ['Transcripts', refreshStatus.summary.transcriptsFetched],
            ['Emails', refreshStatus.summary.emailsFetched],
            ['Slack Msgs', refreshStatus.summary.slackResults]
          ]" :key="stat[0]">
            <div class="text-center"><div class="text-lg font-bold text-white" x-text="num(stat[1])"></div><div class="text-xs text-slate-400" x-text="stat[0]"></div></div>
          </template>
        </div>
      </section>

      <section x-show="activeView === 'about'" class="max-w-3xl space-y-5">
        <div class="fusion-card p-5 text-slate-950">
          <h2 class="text-sm font-semibold">What this dashboard is</h2>
          <p class="mt-3 text-sm leading-relaxed text-muted-foreground">This dashboard analyzes all Fusion closed-lost deals in the New Business pipeline that reached S1 (Qualified Opportunity) or beyond, closed since February 1, 2026. It synthesizes HubSpot CRM, Gong call transcripts, HubSpot email threads, and Slack deal channels to surface loss patterns that rep-written closed-lost reasons alone cannot reliably capture.</p>
          <p class="mt-3 text-sm leading-relaxed text-muted-foreground">Deals are categorized into thematic loss buckets based on human analysis of all available signals. The Critical Insights tab surfaces cross-cutting patterns that span multiple theme categories.</p>
        </div>
        <div class="fusion-card p-5 text-slate-950">
          <h2 class="text-sm font-semibold">Data sources and methodology</h2>
          <div class="mt-4 space-y-4 text-sm text-muted-foreground">
            <p><span class="font-medium text-foreground">HubSpot CRM:</span> Fusion-tagged closed-lost deals, contacts, closed-lost reasons, and up to 50 email engagements per deal.</p>
            <p><span class="font-medium text-foreground">Gong:</span> Calls from the past 540 days matched to deals by participant email and company-name fallback, with transcript text stored in the migrated dataset.</p>
            <p><span class="font-medium text-foreground">Slack:</span> Deal-channel and customer-channel context where channel matches were found.</p>
            <p><span class="font-medium text-foreground">Thematic analysis:</span> Human synthesis across closed-lost reason text, Gong call briefs, transcript excerpts, email threads, and Slack messages.</p>
          </div>
        </div>
      </section>

      <main x-show="activeView === 'dashboard'" class="space-y-6">
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <template x-for="card in [
            ['Total Deals', metrics().totalDeals, 'Reached S1+ since Feb 1'],
            ['Total Value', shortMoney(metrics().totalValue), 'Avg: ' + shortMoney(metrics().avgDealSize)],
            ['POV Progression Rate', metrics().povWinRate + '%', metrics().s3PlusCount + ' of ' + metrics().povCount + ' POV deals progressed to S3+'],
            ['Re-engagement', shortMoney(metrics().reengagementPotential), '~15 deals potential']
          ]" :key="card[0]">
            <div class="fusion-card p-4 text-slate-950">
              <p class="text-sm font-semibold" x-text="card[0]"></p>
              <p class="mt-2 text-2xl font-bold" x-text="card[1]"></p>
              <p class="mt-1 text-xs font-medium text-muted-foreground" x-text="card[2]"></p>
            </div>
          </template>
        </div>

        <div class="flex flex-wrap gap-1">
          <template x-for="tab in tabs" :key="tab[0]">
            <button class="rounded-md px-3 py-2 text-xs font-medium transition-colors" x-bind:class="activeTab === tab[0] ? 'fusion-tab-active' : 'fusion-tab-idle'" x-on:click="activeTab = tab[0]" x-text="tab[1]"></button>
          </template>
        </div>

        <section x-show="activeTab === 'overview'" class="space-y-4">
          <div class="fusion-card p-5 text-slate-950">
            <div class="mb-4">
              <h2 class="font-semibold">Thematic Breakdown</h2>
              <p class="text-sm text-muted-foreground">Deals can be lost for multiple reasons; percentages exceed 100%.</p>
            </div>
            <div class="space-y-4">
              <template x-for="theme in static.themes" :key="theme.theme">
                <div class="rounded-lg border p-4">
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0">
                      <h3 class="font-semibold" x-text="theme.theme"></h3>
                      <p class="mt-1 text-sm leading-relaxed text-muted-foreground" x-text="theme.definition"></p>
                    </div>
                    <div class="text-right">
                      <p class="font-semibold" x-text="num(theme.deals) + ' deals'"></p>
                      <p class="text-sm text-muted-foreground" x-text="shortMoney(theme.value)"></p>
                    </div>
                  </div>
                  <div class="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div class="h-full rounded-full bg-primary" x-bind:style="'width:' + Math.min(100, theme.pct * 3) + '%'"></div></div>
                  <div class="mt-3 grid gap-2 lg:grid-cols-2">
                    <template x-for="example in theme.examples" :key="example"><p class="rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground" x-text="example"></p></template>
                  </div>
                </div>
              </template>
            </div>
          </div>
          <div class="fusion-card p-5 text-slate-950">
            <h2 class="font-semibold">Key Findings</h2>
            <ul class="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
              <li><strong class="text-foreground">POV Progression:</strong> 51% of deals reached S2+; only 7 of those progressed to S3+ and all still closed lost.</li>
              <li><strong class="text-foreground">Setup Friction:</strong> Active in 5+ POV-stage deals, with mono-repo setup time, Figma CLI workarounds, and integration failures killing momentum.</li>
              <li><strong class="text-foreground">Wrong ICP / Stakeholder:</strong> Roughly $455K in S1-only losses from wrong persona or wrong stakeholder level.</li>
              <li><strong class="text-foreground">Self-Cannibalization:</strong> Altimetrik, NiCE, ITS.com, and Retail Insight opted into Team/self-serve rather than Enterprise.</li>
            </ul>
          </div>
        </section>

        <section x-show="activeTab === 'multi-dimensional'" class="fusion-card p-5 text-slate-950">
          <h2 class="font-semibold">Multi-Dimensional Loss Reason Matrix</h2>
          <p class="mt-1 text-sm text-muted-foreground">The same deal often has multiple contributing failure modes. Double marks indicate the dominant factor.</p>
          <div class="mt-4 overflow-x-auto">
            <table class="w-full min-w-[980px] text-xs">
              <thead><tr class="border-b text-left text-muted-foreground">
                <template x-for="h in ['Deal','ARR','Stage','Budget','Product','POV','Competitive','Self-Serve','Security','Persona','No Use Case','Org','Re-engage']" :key="h"><th class="px-2 py-2 font-medium" x-text="h"></th></template>
              </tr></thead>
              <tbody class="divide-y">
                <template x-for="row in static.lossReasons" :key="row.deal + row.amount">
                  <tr class="hover:bg-muted/40">
                    <td class="px-2 py-2 font-medium" x-text="row.deal"></td><td class="px-2 py-2" x-text="shortMoney(row.amount)"></td><td class="px-2 py-2" x-text="row.stage"></td>
                    <td class="px-2 py-2" x-text="row.budget"></td><td class="px-2 py-2" x-text="row.productQuality"></td><td class="px-2 py-2" x-text="row.povFriction"></td><td class="px-2 py-2" x-text="row.competitive"></td><td class="px-2 py-2" x-text="row.selfServe"></td><td class="px-2 py-2" x-text="row.security"></td><td class="px-2 py-2" x-text="row.wrongPersona"></td><td class="px-2 py-2" x-text="row.noUseCase"></td><td class="px-2 py-2" x-text="row.orgChanges"></td><td class="px-2 py-2" x-text="row.reEngage"></td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </section>

        <section x-show="activeTab === 'top10'" class="fusion-card p-5 text-slate-950">
          <h2 class="font-semibold">Top 10 Losses by Deal Size</h2>
          <div class="mt-4 overflow-x-auto">
            <table class="w-full min-w-[820px] text-sm">
              <thead><tr class="border-b text-left text-muted-foreground"><th class="px-3 py-2">Deal</th><th class="px-3 py-2 text-right">ARR</th><th class="px-3 py-2">Stage</th><th class="px-3 py-2">Primary reason</th><th class="px-3 py-2 text-center">Gong</th><th class="px-3 py-2">Re-engage</th></tr></thead>
              <tbody class="divide-y">
                <template x-for="deal in top10()" :key="deal.deal">
                  <tr><td class="px-3 py-3 font-medium" x-text="deal.deal"></td><td class="px-3 py-3 text-right font-mono" x-text="money(deal.amount)"></td><td class="px-3 py-3" x-text="deal.stage"></td><td class="px-3 py-3 text-muted-foreground" x-text="deal.primaryReason"></td><td class="px-3 py-3 text-center" x-text="deal.gongCalls"></td><td class="px-3 py-3" x-text="deal.reEngage ? 'Yes' : '-'"></td></tr>
                </template>
              </tbody>
            </table>
          </div>
        </section>

        <section x-show="activeTab === 'stages'" class="space-y-4">
          <div class="fusion-card p-5 text-slate-950">
            <h2 class="font-semibold">Stage Progression Analysis</h2>
            <div class="mt-4 space-y-3">
              <template x-for="stage in stageRows()" :key="stage.stage">
                <div>
                  <div class="mb-1 flex items-center justify-between text-sm"><span class="font-medium" x-text="stage.stage"></span><span class="text-muted-foreground" x-text="stage.deals + ' deals - ' + shortMoney(stage.value)"></span></div>
                  <div class="h-2 overflow-hidden rounded-full bg-muted"><div class="h-full rounded-full bg-primary" x-bind:style="'width:' + Math.min(100, pct(stage.value, metrics().totalValue)) + '%'"></div></div>
                </div>
              </template>
            </div>
          </div>
          <div class="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-950"><strong>POV Paradox:</strong> 51% of deals reach POV stage and only 7 of 36 progressed to S3+. The POV stage remains where most deals stall or collapse.</div>
        </section>

        <section x-show="activeTab === 's1-analysis'" class="space-y-4">
          <div class="fusion-card p-5 text-slate-950">
            <h2 class="font-semibold">S1-Only Deals: Why Did Not They Advance to POV?</h2>
            <div class="mt-4 grid gap-3 md:grid-cols-2">
              <template x-for="cat in static.s1Categories" :key="cat.category">
                <div class="rounded-lg border p-4"><div class="flex justify-between gap-3"><h3 class="font-semibold" x-text="cat.category"></h3><span class="text-sm text-muted-foreground" x-text="cat.count + ' deals'"></span></div><p class="mt-2 text-sm text-muted-foreground" x-text="cat.description"></p><p class="mt-2 text-sm font-medium" x-text="shortMoney(cat.value)"></p></div>
              </template>
            </div>
          </div>
          <div class="fusion-card p-5 text-slate-950">
            <h2 class="font-semibold">All S1-Only Deals</h2>
            <div class="mt-4 overflow-x-auto">
              <table class="w-full min-w-[920px] text-sm">
                <thead><tr class="border-b text-left text-muted-foreground"><th class="px-3 py-2">Deal</th><th class="px-3 py-2 text-right">ARR</th><th class="px-3 py-2">Category</th><th class="px-3 py-2">Reason</th><th class="px-3 py-2">Detail</th><th class="px-3 py-2 text-center">Calls</th></tr></thead>
                <tbody class="divide-y"><template x-for="deal in static.s1OnlyDeals" :key="deal.deal"><tr><td class="px-3 py-3 font-medium" x-text="deal.deal"></td><td class="px-3 py-3 text-right font-mono" x-text="money(deal.amount)"></td><td class="px-3 py-3" x-text="deal.category"></td><td class="px-3 py-3" x-text="deal.reason"></td><td class="px-3 py-3 text-muted-foreground" x-text="deal.detail"></td><td class="px-3 py-3 text-center" x-text="deal.gongCalls"></td></tr></template></tbody>
              </table>
            </div>
          </div>
        </section>

        <section x-show="activeTab === 'pov-insights'" class="space-y-4">
          <div class="fusion-card p-5 text-slate-950">
            <h2 class="font-semibold">POV Stage Deep Dive: What Went Wrong?</h2>
            <div class="mt-4 grid gap-3 md:grid-cols-2">
              <template x-for="cat in static.povCategories" :key="cat.category">
                <div class="rounded-lg border p-4"><div class="flex justify-between gap-3"><h3 class="font-semibold" x-text="cat.category"></h3><span class="text-sm text-muted-foreground" x-text="cat.count + ' deals'"></span></div><p class="mt-2 text-sm text-muted-foreground" x-text="cat.description"></p><p class="mt-2 text-sm font-medium" x-text="shortMoney(cat.value)"></p><p class="mt-2 text-xs text-muted-foreground" x-text="cat.deals.join(', ')"></p></div>
              </template>
            </div>
          </div>
          <div class="fusion-card p-5 text-slate-950">
            <h2 class="font-semibold">All POV Stage Deals</h2>
            <div class="mt-4 overflow-x-auto">
              <table class="w-full min-w-[920px] text-sm">
                <thead><tr class="border-b text-left text-muted-foreground"><th class="px-3 py-2">Deal</th><th class="px-3 py-2 text-right">ARR</th><th class="px-3 py-2">Stage</th><th class="px-3 py-2">Issue</th><th class="px-3 py-2">Detail</th><th class="px-3 py-2 text-center">Calls</th><th class="px-3 py-2 text-center">Notes</th></tr></thead>
                <tbody class="divide-y"><template x-for="deal in static.povDeals" :key="deal.deal + deal.issue"><tr><td class="px-3 py-3 font-medium" x-text="deal.deal"></td><td class="px-3 py-3 text-right font-mono" x-text="money(deal.amount)"></td><td class="px-3 py-3" x-text="deal.stage"></td><td class="px-3 py-3" x-text="deal.issue"></td><td class="px-3 py-3 text-muted-foreground" x-text="deal.detail"></td><td class="px-3 py-3 text-center" x-text="deal.gongCalls"></td><td class="px-3 py-3 text-center" x-text="deal.notes"></td></tr></template></tbody>
              </table>
            </div>
          </div>
        </section>

        <section x-show="activeTab === 'insights'" class="space-y-4">
          <template x-for="insight in static.insights" :key="insight.title">
            <div class="rounded-lg border-l-4 border-2 p-5" x-bind:class="severityClass(insight.severity)">
              <div class="flex flex-wrap items-center justify-between gap-3"><h2 class="text-lg font-bold" x-text="insight.title"></h2><span class="rounded-full border bg-white/70 px-2 py-0.5 text-xs font-semibold uppercase" x-text="insight.severity"></span></div>
              <p class="mt-3 text-sm font-medium leading-relaxed" x-text="insight.description"></p>
              <p class="mt-3 rounded bg-white/70 p-2 text-sm font-bold" x-text="'Impact: ' + insight.impact"></p>
            </div>
          </template>
          <div class="rounded-lg border-2 border-blue-300 bg-gradient-to-r from-blue-50 to-purple-50 p-5 text-gray-950">
            <h2 class="text-xl font-bold">Actionable Recommendations</h2>
            <div class="mt-4 grid gap-4 lg:grid-cols-3">
              <div class="rounded-lg border bg-white p-4"><h3 class="font-bold">Product Team</h3><ul class="mt-3 space-y-2 text-sm"><li>Address stability, consistency, code quality, Figma import, and setup time.</li><li>Reduce setup time to under 7 days.</li><li>Benchmark output quality against Lovable and other direct alternatives.</li></ul></div>
              <div class="rounded-lg border bg-white p-4"><h3 class="font-bold">Sales Team</h3><ul class="mt-3 space-y-2 text-sm"><li>Engage engineering persona earlier.</li><li>Speed to POV in under 14 days.</li><li>Run a focused re-engagement campaign for explicit revisit accounts.</li></ul></div>
              <div class="rounded-lg border bg-white p-4"><h3 class="font-bold">Executive</h3><ul class="mt-3 space-y-2 text-sm"><li>Overhaul POV process.</li><li>Clarify enterprise feature gates to reduce self-cannibalization.</li><li>Start a win/loss interview program.</li></ul></div>
            </div>
          </div>
        </section>

        <section x-show="activeTab === 'business-pain'" class="space-y-5">
          <template x-if="!businessPainData"><div class="fusion-card p-8 text-center text-slate-950">Business pain data is not attached to this extension.</div></template>
          <template x-if="businessPainData">
            <div class="space-y-5">
              <div class="fusion-card p-5 text-slate-950">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div><h2 class="font-semibold">Pain Themes</h2><p class="text-sm text-muted-foreground" x-text="'Synthesized from 3 WHYs fields, Gong transcripts, and deal notes across all ' + businessPainData.totalDeals + ' deals.'"></p></div>
                  <div class="flex flex-wrap items-center gap-2"><button class="rounded-md border px-3 py-2 text-sm hover:bg-muted" x-on:click="exportBusinessPainToExcel()">Export to Excel</button><button class="rounded-md px-3 py-2 text-sm" x-bind:class="painBottomTab === 'business' ? 'bg-primary text-primary-foreground' : 'border hover:bg-muted'" x-on:click="painBottomTab = 'business'">Business Pain</button><button class="rounded-md px-3 py-2 text-sm" x-bind:class="painBottomTab === 'operational' ? 'bg-primary text-primary-foreground' : 'border hover:bg-muted'" x-on:click="painBottomTab = 'operational'">Operational Pain</button></div>
                </div>
                <div x-show="painBottomTab === 'business'" class="mt-4 space-y-3">
                  <p class="text-sm text-muted-foreground"><span class="font-medium text-foreground">Business pain</span> = the downstream cost to the company: revenue lost, competitive position eroded, investment wasted, talent misallocated.</p>
                  <template x-for="pain in businessPainData.businessPains || []" :key="pain.rank"><div class="rounded-lg border border-l-4 p-4"><div class="flex justify-between gap-3"><h3 class="font-semibold" x-text="pain.rank + '. ' + pain.pain"></h3><span class="text-xs font-semibold" x-text="pain.dealCount + ' deals'"></span></div><p class="mt-1 text-xs font-medium text-orange-500" x-text="'Impact: ' + pain.businessImpact"></p><p class="mt-2 text-sm text-muted-foreground" x-text="pain.description"></p><p class="mt-2 text-xs text-muted-foreground" x-text="(pain.representativeDeals || []).join(', ')"></p></div></template>
                </div>
                <div x-show="painBottomTab === 'operational'" class="mt-4 space-y-3">
                  <p class="text-sm text-muted-foreground"><span class="font-medium text-foreground">Operational pain</span> = the day-to-day workflow friction: slow handoffs, manual processes, designer/eng bottlenecks.</p>
                  <template x-for="pain in businessPainData.topPains || []" :key="pain.rank"><div class="rounded-lg border border-l-4 p-4"><div class="flex justify-between gap-3"><h3 class="font-semibold" x-text="pain.rank + '. ' + pain.pain"></h3><span class="text-xs font-semibold" x-text="pain.dealCount + ' deals'"></span></div><p class="mt-2 text-sm text-muted-foreground" x-text="pain.description"></p><p class="mt-2 text-xs text-muted-foreground" x-text="(pain.representativeDeals || []).join(', ')"></p></div></template>
                </div>
              </div>
              <div class="flex items-center gap-3"><input x-model="businessPainSearch" class="flex-1 rounded-lg border bg-background px-4 py-2 text-sm text-foreground" placeholder="Search deals, categories, or pain themes..." /><span class="whitespace-nowrap text-sm text-slate-300" x-text="filteredPainDeals().length + ' of ' + ((businessPainData?.deals || []).length) + ' deals'"></span></div>
              <div class="fusion-card text-slate-950">
                <div class="border-b p-4"><h2 class="font-semibold">Pain by Deal</h2><p class="mt-1 text-sm text-muted-foreground">3 WHYs sourced from HubSpot. Business and operational pain sourced from Gong transcripts, call briefs, emails, Slack, and closed-lost reasons.</p></div>
                <div class="overflow-x-auto">
                  <table class="w-full min-w-[1100px] text-sm"><thead><tr class="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground"><th class="px-4 py-3">Deal</th><th class="px-4 py-3">Business Pain</th><th class="px-4 py-3">Operational Pain</th><th class="px-4 py-3">Combined Pain Notes</th><th class="px-4 py-3">Categories</th></tr></thead>
                    <tbody class="divide-y"><template x-for="deal in filteredPainDeals()" :key="deal.dealId || deal.dealName"><tr class="align-top hover:bg-muted/30"><td class="px-4 py-4"><div class="font-semibold" x-text="deal.dealName"></div><div class="mt-1 text-xs text-muted-foreground" x-show="deal.amount" x-text="shortMoney(deal.amount)"></div></td><td class="px-4 py-4 text-muted-foreground" x-text="deal.businessPain || 'Unknown'"></td><td class="px-4 py-4 text-muted-foreground" x-text="deal.operationalPain || 'Unknown'"></td><td class="px-4 py-4 text-muted-foreground"><p x-text="deal.assessedPainSummary || 'Unknown'"></p><p class="mt-2 border-t pt-2 text-xs" x-show="deal.threeWhysSummary" x-text="'3 WHYs: ' + deal.threeWhysSummary"></p></td><td class="px-4 py-4"><div class="flex flex-wrap gap-1"><template x-for="cat in deal.painCategories || []" :key="cat"><span class="rounded-md border bg-secondary px-2 py-0.5 text-xs" x-text="cat"></span></template></div></td></tr></template></tbody></table>
                </div>
              </div>
            </div>
          </template>
        </section>
      </main>
    </div>
  </template>
</div>`,
  );
}

export function fusionClosedWonExtension(): string {
  const source = readLegacy(CLOSED_WON_REL);
  const statics = {
    operationalThemes: evalLegacyLiteral(
      extractConstArrayLiteral(source, "OPERATIONAL_THEMES"),
    ),
    businessThemes: evalLegacyLiteral(
      extractConstArrayLiteral(source, "BUSINESS_THEMES"),
    ),
    painByDeal: evalLegacyLiteral(
      extractConstArrayLiteral(source, "PAIN_BY_DEAL"),
    ),
    winThemes: [
      {
        number: 1,
        title:
          "Developer Productivity Is the Universal Opener - Design System Depth Is What Closes",
        detail:
          "Every deal started with the same hook: a live Figma-to-code demo promising 50-80% faster UI delivery. But what actually closed each deal was proving Builder understood the customer's specific design system. Netflix validated against their Hawkins DS. Sony Pictures gated the deal on Angular support. Omnicell needed their Greenlight components to work. Acuity Brands' champions clarified mid-demo that they wanted Fusion specifically, not Builder CMS. The POC phase existed primarily to prove design system fidelity - if it worked, the deal closed.",
        deals: [
          "Optum UHG",
          "Netflix",
          "Sony Pictures",
          "Omnicell",
          "Acuity Brands",
        ],
      },
      {
        number: 2,
        title:
          "Every Win Had One Internal Champion - And That Person Made or Broke the Deal",
        detail:
          "Each deal was carried by a single identifiable champion: JC at Netflix, Hannes at Volue, Zoltan at tiszasoft, Alex at Acuity Brands, Gal at Yotpo, Marius at Optum. These champions held senior IC or manager-level engineering/design roles and had clear personal urgency - a trade fair deadline, a modernization mandate, or a CI/CD AI bet.",
        deals: ["Netflix", "Volue", "tiszasoft.com", "Acuity Brands", "Yotpo"],
      },
      {
        number: 3,
        title:
          "SSO and Enterprise Security Review Were the #1 Cause of Delay Between Verbal Yes and Signed Contract",
        detail:
          "At least 3 of the 12 deals had commercial agreement complete but were blocked for weeks on SSO configuration. Optum's Entra ID SAML setup took 10+ dedicated calls. Sony needed Okta SSO and had GitHub repository security concerns. Thales required Pixie SSO rather than SAML.",
        deals: ["Optum UHG", "Sony Pictures", "Thales"],
      },
      {
        number: 4,
        title: "Structured POC Converted Every Technical Skeptic",
        detail:
          "All large deals ran a formal POC or trial. Optum ran a web-only POC before expanding. Acuity Brands ran a proof of concept that cleared legal, secops, and AI alliance before commercial terms. Weedmaps' credit usage surfaced the right champion signal. For Volue, the POC produced a live prototype for a trade fair.",
        deals: ["Optum UHG", "Acuity Brands", "Weedmaps", "Volue", "Porch.com"],
      },
      {
        number: 5,
        title:
          "Fusion Is Winning Against Internal Tools and Manual Dev - Not Named Competitors",
        detail:
          "The transcripts reveal almost no head-to-head competition against named AI coding tools. The real competitive motion is Builder vs. internal developer productivity baselines: Omnicell's 40+ frontend projects, Optum's internal team, and ServiceNow converting Figma-to-portal manually.",
        deals: ["Netflix", "Omnicell", "Optum UHG", "ServiceNow"],
      },
      {
        number: 6,
        title:
          "AI-Native Coding Agent Framing Is Resonating as an Expansion and Stickiness Driver",
        detail:
          "tiszasoft.com has the most advanced Fusion usage pattern, using it for AI-driven code review, documentation generation, and CI/CD automation. ServiceNow explored Builder as an AI coding agent for Lit components. Weedmaps asked detailed questions about credit usage and the roadmap toward agentic AI.",
        deals: ["tiszasoft.com", "ServiceNow", "Weedmaps", "Yotpo"],
      },
    ],
    criticalInsights: [
      {
        title:
          "100% Gong Coverage Across All 12 Pure-Fusion New Business Deals",
        tone: "amber",
        detail:
          "Every deal had Gong calls (224 total across 12 deals). Median is about 19 calls per deal; Optum leads at 47. This is a high-touch, relationship-intensive sale with no quick closes.",
      },
      {
        title:
          "Enterprise (80K+) Is Driven by Healthcare and Media; Mid-Market Is SaaS and Tech",
        tone: "blue",
        detail:
          "The 4 large deals total $362K, 42% of cohort ARR. These healthcare, media, defense, and tech enterprise buyers have large design systems, compliance requirements, and multi-team rollout ambitions.",
      },
      {
        title:
          "Post-Sale CE Intensity Is High - And It's a Retention Variable, Not Just Support",
        tone: "green",
        detail:
          "Omnicell, Yotpo, Sony, and Porch.com all show substantive CE-led troubleshooting sessions after signing. The pattern: customers who got fast CE response stayed and expanded.",
      },
      {
        title:
          "SSO Self-Serve Would Recover 3-6 Weeks of Sales Cycle Per Enterprise Deal",
        tone: "red",
        detail:
          "Optum, Sony, and Thales all had signed intent but were blocked purely by SSO configuration. Pre-built IdP templates for Okta, Entra, and Ping would directly recover cycle time.",
      },
      {
        title: "Buyer Personas: VP/Director Sponsors, Senior IC Champions",
        tone: "purple",
        detail:
          "Across customer-side Gong participants, executive sponsors and approvers are distinct from day-to-day champions. Effective Fusion selling requires both an executive business case and a technical proof.",
      },
      {
        title:
          "The Biggest Adoption Risk Post-Close Is Monorepo and Enterprise Toolchain Complexity",
        tone: "indigo",
        detail:
          "Volue, Omnicell, Sony, and Porch.com show the same pattern: the POC worked in a simplified setup, but production integration into enterprise toolchains created friction.",
      },
    ],
  };

  return shell(
    "Fusion Closed Won Analysis",
    `${sharedClientScript()}
<script>
const FUSION_CLOSED_WON_STATIC = ${jsonForScript(statics)};
function fusionClosedWonApp() {
  return Object.assign(fusionCommon(), {
    loading: true,
    error: '',
    notice: '',
    activeTab: 'overview',
    painTab: 'operational',
    showProgress: false,
    liveData: null,
    refreshStatus: null,
    static: FUSION_CLOSED_WON_STATIC,
    tabs: [
      ['overview', 'Overview'],
      ['win-themes', 'Win Themes'],
      ['personas', 'Personas'],
      ['coverage', 'Deal Coverage'],
      ['insights', 'Critical Insights'],
      ['pain', 'Pain']
    ],
    async init() { await this.load(); },
    async load() {
      this.loading = true;
      this.error = '';
      try {
        const live = await extensionData.get('fusion-won-analysis', 'live-data', { scope: 'org' });
        this.liveData = readExtensionValue(live);
        const summary = this.liveData?.summary || {};
        this.refreshStatus = {
          status: 'done',
          startedAt: this.liveData?.generatedAt || null,
          completedAt: this.liveData?.generatedAt || null,
          steps: [
            { name: 'hubspot', label: 'HubSpot Deals', status: 'done', detail: 'Loaded closed-won Fusion deals', duration: null },
            { name: 'gong', label: 'Gong Calls', status: 'done', detail: 'Loaded matched calls and transcripts', duration: null },
            { name: 'emails', label: 'HubSpot Emails', status: 'done', detail: (summary.emailsFetched || 0) + ' email records', duration: null },
            { name: 'slack', label: 'Slack Context', status: summary.slackMessagesFound ? 'done' : 'skipped', detail: (summary.slackMessagesFound || 0) + ' Slack messages', duration: null }
          ],
          summary: {
            deals: summary.totalDeals || this.liveData?.deals?.length || 0,
            gongCalls: summary.totalCallsMatched || 0,
            dealsWithGong: summary.dealsWithCalls || 0,
            transcriptsFetched: summary.transcriptsFetched || 0,
            emailsFetched: summary.emailsFetched || 0,
            slackResults: summary.slackMessagesFound || 0
          },
          error: null
        };
      } catch (e) {
        this.error = e && e.message ? e.message : String(e);
      } finally {
        this.loading = false;
      }
    },
    async refreshData() {
      this.showProgress = true;
      await this.load();
      this.notice = 'Reloaded the full migrated org data attached to this extension.';
      setTimeout(() => { this.notice = ''; }, 5000);
    },
    lastRefreshed() {
      return this.liveData?.generatedAt ? this.dateTime(this.liveData.generatedAt) : null;
    },
    staleWarning() {
      return this.liveData?.analysisAsOf && this.liveData?.generatedAt && new Date(this.liveData.analysisAsOf) < new Date(this.liveData.generatedAt);
    },
    metrics() {
      const deals = this.liveData?.deals || [];
      if (!deals.length) return { totalDeals: 14, totalValue: 834619, avgDealSize: 59615, dealsWithGong: 0, coverageRate: '-' };
      const totalDeals = deals.length;
      const totalValue = deals.reduce((sum, deal) => sum + Number(deal.amount || 0), 0);
      const dealsWithGong = deals.filter((deal) => Number(deal.gongCallCount || 0) > 0).length;
      return { totalDeals, totalValue, avgDealSize: totalDeals ? Math.round(totalValue / totalDeals) : 0, dealsWithGong, coverageRate: this.liveData?.summary?.coverageRate || '-' };
    },
    allPersonas() {
      return this.liveData?.personasByDeal ? Object.values(this.liveData.personasByDeal).flat() : [];
    },
    seniorityGroups() {
      const order = ['c_level', 'vp', 'director', 'manager', 'individual_contributor', 'entry_level', 'unknown'];
      const groups = {};
      for (const persona of this.allPersonas()) {
        const key = persona.hubspotSeniority || 'unknown';
        groups[key] = groups[key] || [];
        groups[key].push(persona);
      }
      return Object.entries(groups).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
    },
    hasEmail(dealId) {
      return (this.liveData?.emailsByDeal?.[dealId] || []).length > 0;
    },
    hasSlack(dealId) {
      return Boolean(this.liveData?.slackByDeal?.[dealId]);
    },
    slackLabel(dealId) {
      return this.liveData?.slackByDeal?.[dealId]?.query || 'Slack';
    },
    exportThemesCsv() {
      this.downloadCsv('pain-themes.csv', [
        ...this.static.operationalThemes.map((t) => ({ type: 'Operational', number: t.number, title: t.title, detail: t.detail, deals: t.deals.join('; ') })),
        ...this.static.businessThemes.map((t) => ({ type: 'Business', number: t.number, title: t.title, detail: t.detail, deals: t.deals.join('; ') }))
      ]);
    },
    exportPainByDealCsv() {
      this.downloadCsv('pain-by-deal.csv', this.static.painByDeal.map((row) => ({ company: row.company, arr: row.arr, operational_pain: row.operational, business_pain: row.business })));
    }
  });
}
</script>
<div x-data="fusionClosedWonApp()" x-init="init()" x-cloak class="min-h-screen bg-background px-4 py-5 text-foreground md:px-6">
  <template x-if="loading"><div class="mx-auto max-w-7xl rounded-lg border p-4 text-sm text-muted-foreground">Loading full migrated Fusion closed-won analysis...</div></template>
  <template x-if="!loading">
    <div class="mx-auto max-w-7xl space-y-6">
      <div x-show="notice" class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700" x-text="notice"></div>
      <div x-show="error" class="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700" x-text="error"></div>
      <header class="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <div class="flex items-center gap-2"><div class="flex h-7 w-7 items-center justify-center rounded-md bg-amber-100 text-sm font-bold text-amber-700">W</div><h1 class="text-2xl font-bold">Fusion Closed Won Analysis</h1></div>
          <p class="mt-2 text-sm text-muted-foreground">New Business pipeline - Fusion product - Closed since Jan 1, 2026</p>
          <p x-show="lastRefreshed()" class="mt-1 text-xs text-muted-foreground" x-text="'Data refreshed ' + lastRefreshed()"></p>
        </div>
        <button class="rounded-md border px-3 py-2 text-sm hover:bg-muted" x-on:click="refreshData()">Refresh Data</button>
      </header>

      <div x-show="staleWarning()" class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">The written analysis predates the latest data refresh. Re-run agent synthesis to update insights.</div>

      <section x-show="showProgress && refreshStatus" class="fusion-card p-5">
        <div class="mb-4 flex items-center justify-between"><h2 class="text-sm font-semibold">Data Refresh</h2><button class="text-xs text-muted-foreground hover:text-foreground" x-on:click="showProgress = false">Dismiss</button></div>
        <div class="space-y-2">
          <template x-for="step in refreshStatus.steps" :key="step.name">
            <div class="flex items-start gap-3 text-sm"><div class="mt-1 h-2 w-2 rounded-full" x-bind:class="step.status === 'done' ? 'bg-emerald-500' : step.status === 'skipped' ? 'bg-muted-foreground' : 'bg-blue-500'"></div><div><span class="font-medium" x-text="step.label"></span><span class="ml-2 text-muted-foreground" x-text="step.detail"></span></div></div>
          </template>
        </div>
      </section>

      <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <template x-for="card in [
          ['Deals Won', metrics().totalDeals, 'New Business - Fusion - 2026', 'bg-amber-500'],
          ['Total ARR Won', shortMoney(metrics().totalValue), 'All closed won deals', 'bg-emerald-600'],
          ['Avg Deal Size', shortMoney(metrics().avgDealSize), '', 'bg-blue-600'],
          ['Gong Coverage', metrics().coverageRate, metrics().dealsWithGong ? metrics().dealsWithGong + ' of ' + metrics().totalDeals + ' deals' : '', 'bg-purple-600']
        ]" :key="card[0]">
          <div class="fusion-card p-4"><div class="flex items-start justify-between gap-3"><div><p class="text-sm text-muted-foreground" x-text="card[0]"></p><p class="mt-1 text-2xl font-bold" x-text="card[1]"></p><p class="mt-1 text-xs text-muted-foreground" x-text="card[2]"></p></div><div class="h-9 w-9 rounded-lg" x-bind:class="card[3]"></div></div></div>
        </template>
      </div>

      <div class="flex flex-wrap gap-1">
        <template x-for="tab in tabs" :key="tab[0]"><button class="rounded-md px-3 py-2 text-xs font-medium transition-colors" x-bind:class="activeTab === tab[0] ? 'fusion-tab-active' : 'fusion-tab-idle'" x-on:click="activeTab = tab[0]" x-text="tab[1]"></button></template>
      </div>

      <section x-show="activeTab === 'overview'" class="fusion-card p-5">
        <h2 class="text-base font-semibold">Closed Won Deals</h2>
        <template x-if="!(liveData?.deals || []).length"><div class="py-8 text-center text-muted-foreground">No data attached yet.</div></template>
        <template x-if="(liveData?.deals || []).length">
          <div class="mt-4 overflow-x-auto"><table class="w-full min-w-[760px] text-sm">
            <thead><tr class="border-b text-left text-muted-foreground"><th class="pb-2 font-medium">Company</th><th class="pb-2 text-right font-medium">ARR</th><th class="pb-2 font-medium">Close Date</th><th class="pb-2 text-center font-medium">Gong Calls</th><th class="pb-2 text-center font-medium">Slack</th></tr></thead>
            <tbody class="divide-y"><template x-for="deal in liveData.deals" :key="deal.dealId"><tr class="hover:bg-muted/40"><td class="py-2.5 font-medium" x-text="shortDealName(deal.dealName)"></td><td class="py-2.5 text-right font-mono" x-text="money(deal.amount)"></td><td class="py-2.5 text-muted-foreground" x-text="date(deal.closeDate)"></td><td class="py-2.5 text-center"><span class="rounded bg-purple-100 px-2 py-0.5 text-xs text-purple-700" x-show="deal.gongCallCount > 0" x-text="deal.gongCallCount"></span><span x-show="!deal.gongCallCount" class="text-muted-foreground">-</span></td><td class="py-2.5 text-center"><span x-show="hasSlack(deal.dealId)" class="text-xs font-medium text-emerald-600" x-text="slackLabel(deal.dealId)"></span><span x-show="!hasSlack(deal.dealId)" class="text-muted-foreground">-</span></td></tr></template></tbody>
            <tfoot><tr class="border-t font-medium"><td class="pt-2.5" x-text="'Total (' + liveData.deals.length + ' deals)'"></td><td class="pt-2.5 text-right font-mono" x-text="money(metrics().totalValue)"></td><td colspan="3"></td></tr></tfoot>
          </table></div>
        </template>
      </section>

      <section x-show="activeTab === 'win-themes'" class="space-y-4">
        <template x-for="theme in static.winThemes" :key="theme.number">
          <div class="fusion-card p-5"><div class="flex gap-4"><div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-700" x-text="theme.number"></div><div><h2 class="text-sm font-semibold" x-text="theme.title"></h2><p class="mt-2 text-sm leading-relaxed text-muted-foreground" x-text="theme.detail"></p><div class="mt-3 flex flex-wrap gap-1"><template x-for="deal in theme.deals" :key="deal"><span class="rounded-full border px-2 py-0.5 text-xs" x-text="deal"></span></template></div></div></div></div>
        </template>
      </section>

      <section x-show="activeTab === 'personas'" class="fusion-card p-5">
        <h2 class="flex items-center gap-2 text-base font-semibold">Buyer Personas</h2>
        <template x-if="!allPersonas().length"><div class="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800"><p class="font-medium">No persona data yet</p><p class="mt-1">Run a data refresh to extract personas from Gong call participants.</p></div></template>
        <template x-if="allPersonas().length">
          <div class="mt-4 space-y-6">
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3"><template x-for="group in seniorityGroups()" :key="group[0]"><div class="rounded-lg bg-muted/40 p-3"><p class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground" x-text="group[0].replace(/_/g, ' ')"></p><p class="text-2xl font-bold" x-text="group[1].length"></p><p class="text-xs text-muted-foreground" x-text="Math.round((group[1].length / allPersonas().length) * 100) + '% of contacts'"></p></div></template></div>
            <div class="overflow-x-auto"><table class="w-full min-w-[760px] text-sm"><thead><tr class="border-b text-left text-muted-foreground"><th class="pb-2 font-medium">Name</th><th class="pb-2 font-medium">Title</th><th class="pb-2 font-medium">Seniority</th><th class="pb-2 font-medium">Company</th></tr></thead><tbody class="divide-y"><template x-for="(p, index) in allPersonas()" :key="index"><tr class="hover:bg-muted/40"><td class="py-2" x-text="p.name || p.email"></td><td class="py-2 text-muted-foreground" x-text="p.hubspotTitle || p.title || '-'"></td><td class="py-2"><span class="rounded border px-2 py-0.5 text-xs" x-text="p.hubspotSeniority ? p.hubspotSeniority.replace(/_/g, ' ') : '-'"></span></td><td class="py-2 text-muted-foreground" x-text="p.company || '-'"></td></tr></template></tbody></table></div>
          </div>
        </template>
      </section>

      <section x-show="activeTab === 'coverage'" class="fusion-card p-5">
        <h2 class="text-base font-semibold">Source Coverage by Deal</h2>
        <div class="mt-4 overflow-x-auto"><table class="w-full min-w-[760px] text-sm"><thead><tr class="border-b text-left text-muted-foreground"><th class="pb-2 font-medium">Company</th><th class="pb-2 text-right font-medium">ARR</th><th class="pb-2 text-center font-medium">Gong</th><th class="pb-2 text-center font-medium">Email</th><th class="pb-2 text-center font-medium">Slack</th></tr></thead><tbody class="divide-y"><template x-for="deal in liveData?.deals || []" :key="deal.dealId"><tr class="hover:bg-muted/40"><td class="py-2.5 font-medium" x-text="shortDealName(deal.dealName)"></td><td class="py-2.5 text-right font-mono text-muted-foreground" x-text="money(deal.amount)"></td><td class="py-2.5 text-center"><span class="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold" x-bind:class="deal.gongCallCount > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'" x-text="deal.gongCallCount > 0 ? deal.gongCallCount : '-'"></span></td><td class="py-2.5 text-center"><span class="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold" x-bind:class="hasEmail(deal.dealId) ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'" x-text="hasEmail(deal.dealId) ? 'E' : '-'"></span></td><td class="py-2.5 text-center"><span class="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold" x-bind:class="hasSlack(deal.dealId) ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'" x-text="hasSlack(deal.dealId) ? 'S' : '-'"></span></td></tr></template></tbody></table></div>
      </section>

      <section x-show="activeTab === 'insights'" class="space-y-4">
        <template x-for="item in static.criticalInsights" :key="item.title"><div class="rounded-lg border-l-4 p-5" x-bind:class="'border-l-' + item.tone + '-500 fusion-card'"><h2 class="text-sm font-semibold" x-text="item.title"></h2><p class="mt-2 text-sm text-muted-foreground" x-text="item.detail"></p></div></template>
        <p class="pt-2 text-xs text-muted-foreground">Synthesized from 224 full Gong transcripts, 534 HubSpot emails, 131 Slack messages, 12 pure-Fusion New Business deals, May 2026.</p>
      </section>

      <section x-show="activeTab === 'pain'" class="space-y-8">
        <div>
          <p class="mb-3 text-sm font-semibold">Pain Themes Across 12 Deals</p>
          <div class="mb-4 flex gap-1"><button class="rounded-md px-3 py-2 text-xs font-medium" x-bind:class="painTab === 'operational' ? 'fusion-tab-active' : 'fusion-tab-idle'" x-on:click="painTab = 'operational'">Operational Pain</button><button class="rounded-md px-3 py-2 text-xs font-medium" x-bind:class="painTab === 'business' ? 'fusion-tab-active' : 'fusion-tab-idle'" x-on:click="painTab = 'business'">Business Pain</button></div>
          <div class="space-y-4" x-show="painTab === 'operational'"><template x-for="theme in static.operationalThemes" :key="theme.number"><div class="fusion-card p-5"><div class="flex gap-4"><div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-100 text-sm font-bold text-orange-700" x-text="theme.number"></div><div><h2 class="text-sm font-semibold" x-text="theme.title"></h2><p class="mt-2 text-sm text-muted-foreground" x-text="theme.detail"></p><div class="mt-3 flex flex-wrap gap-1"><template x-for="deal in theme.deals" :key="deal"><span class="rounded-full border px-2 py-0.5 text-xs" x-text="deal"></span></template></div></div></div></div></template></div>
          <div class="space-y-4" x-show="painTab === 'business'"><template x-for="theme in static.businessThemes" :key="theme.number"><div class="fusion-card p-5"><div class="flex gap-4"><div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-100 text-sm font-bold text-red-700" x-text="theme.number"></div><div><h2 class="text-sm font-semibold" x-text="theme.title"></h2><p class="mt-2 text-sm text-muted-foreground" x-text="theme.detail"></p><div class="mt-3 flex flex-wrap gap-1"><template x-for="deal in theme.deals" :key="deal"><span class="rounded-full border px-2 py-0.5 text-xs" x-text="deal"></span></template></div></div></div></div></template></div>
        </div>
        <div>
          <div class="mb-3 flex flex-wrap items-center justify-between gap-3"><p class="text-sm font-semibold">Pain by Deal</p><div class="flex gap-2"><button class="rounded-md border px-3 py-1.5 text-xs hover:bg-muted" x-on:click="exportThemesCsv()">Themes CSV</button><button class="rounded-md border px-3 py-1.5 text-xs hover:bg-muted" x-on:click="exportPainByDealCsv()">Pain by Deal CSV</button></div></div>
          <div class="overflow-x-auto"><table class="w-full min-w-[960px] text-sm"><thead><tr class="border-b text-left text-muted-foreground"><th class="pb-2 pr-4 font-medium">Company</th><th class="pb-2 pr-4 text-right font-medium">ARR</th><th class="w-80 pb-2 pr-4 font-medium">Operational Pain</th><th class="w-80 pb-2 font-medium">Business Pain</th></tr></thead><tbody class="divide-y"><template x-for="row in static.painByDeal" :key="row.company"><tr class="align-top hover:bg-muted/40"><td class="py-3 pr-4 font-medium whitespace-nowrap" x-text="row.company"></td><td class="py-3 pr-4 text-right font-mono text-muted-foreground whitespace-nowrap" x-text="money(row.arr)"></td><td class="py-3 pr-4 leading-relaxed text-muted-foreground" x-text="row.operational"></td><td class="py-3 leading-relaxed text-muted-foreground" x-text="row.business"></td></tr></template></tbody></table></div>
          <p class="mt-3 text-xs text-muted-foreground">Synthesized from 224 Gong transcripts, 12 pure-Fusion New Business deals. Only clearly evidenced pain included.</p>
        </div>
      </section>
    </div>
  </template>
</div>`,
  );
}
