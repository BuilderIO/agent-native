function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function baseExtension(title: string, body: string): string {
  return `<div class="p-4 space-y-4 text-sm" x-data="{}">
  <div>
    <h1 class="text-lg font-semibold">${escapeHtml(title)}</h1>
  </div>
  ${body}
</div>`;
}

export function onboardingProgressExtension(): string {
  return baseExtension(
    "Onboarding Progress",
    String.raw`<div x-data="{
      loading: true,
      error: '',
      activeTab: 'fusion',
      onboardingOnly: true,
      selectedOrgId: null,
      sort: null,
      allRows: [],
      rows: [],
      byId: {},
      productTabs: [
        { key: 'fusion', label: 'Fusion' },
        { key: 'publish', label: 'Publish' },
        { key: 'publish-academy', label: 'Publish Academy' },
        { key: 'analytics', label: 'Analytics' }
      ],
      readData(item) {
        let value = item ? item.data : null;
        if (typeof value === 'string') {
          try { value = JSON.parse(value); } catch (e) {}
        }
        if (value && value.value !== undefined) return value.value;
        if (value && value.data && value.data.value !== undefined) return value.data.value;
        if (value && value.data !== undefined) return value.data;
        return value;
      },
      async init() {
        try {
          const migrated = await extensionData.list('onboarding', { scope: 'org' });
          const byId = {};
          for (const item of migrated) {
            byId[item.itemId || item.id] = this.readData(item);
          }
          this.byId = byId;
          this.allRows = this.normalizeRows(byId);
          this.selectedOrgId = this.visibleRows()[0]?.orgId || null;
        } catch (e) {
          this.error = e && e.message ? e.message : String(e);
        } finally {
          this.loading = false;
        }
      },
      normalizeRows(byId) {
        const snapshotRows = Array.isArray(byId['latest-snapshot']?.rows) ? byId['latest-snapshot'].rows : [];
        const rowsByOrg = {};
        for (const row of snapshotRows) rowsByOrg[row.orgId] = this.normalizeSnapshotRow(row);
        for (const [key, value] of Object.entries(byId)) {
          if (!key.startsWith('account-bundle:') || !value || !value.orgId) continue;
          if (!rowsByOrg[value.orgId]) continue;
          const enriched = this.normalizeBundleRow(value);
          rowsByOrg[value.orgId] = Object.assign({}, enriched, rowsByOrg[value.orgId], {
            pctDelta: enriched.pctDelta,
            product_usage: enriched.product_usage,
            contract_usage: enriched.contract_usage,
            riskSignals: enriched.riskSignals,
            bucket: enriched.bucket,
            bucketReasons: enriched.bucketReasons,
            academyUrl: enriched.academyUrl,
            bundle: value
          });
        }
        for (const [key, value] of Object.entries(byId)) {
          if (!key.startsWith('account-analysis:') || !value) continue;
          const orgId = key.split(':')[1];
          if (rowsByOrg[orgId]) rowsByOrg[orgId].analysis = value;
        }
        return Object.values(rowsByOrg).sort((a, b) => Number(b.daysSinceKickoff ?? -1) - Number(a.daysSinceKickoff ?? -1));
      },
      normalizeSnapshotRow(row) {
        const product = this.productKey(row.product);
        return Object.assign({}, row, {
          product,
          productLabel: this.productLabel(product),
          customerStage: row.customerStage || row.onboardingStage || '',
          ownerName: row.ownerName || 'Unassigned',
          goals: Array.isArray(row.goals) ? row.goals : [],
          blockers: Array.isArray(row.blockers) ? row.blockers : [],
          identifiedRisks: Array.isArray(row.identifiedRisks) ? row.identifiedRisks : [],
          workshopHistory: Array.isArray(row.workshopHistory) ? row.workshopHistory : [],
          planProgress: Array.isArray(row.planProgress) ? row.planProgress : [],
          pctComplete: Number(row.pctComplete || 0)
        });
      },
      normalizeBundleRow(bundle) {
        const product = this.productKey(bundle.product);
        return {
          orgId: bundle.orgId,
          name: bundle.name,
          ownerName: bundle.ownerName || 'Unassigned',
          product,
          productLabel: this.productLabel(product),
          customerStage: 'onboarding',
          accountStatus: bundle.accountStatus,
          csmSentiment: bundle.sentiment,
          daysSinceKickoff: bundle.daysSinceKickoff,
          pctComplete: Number(bundle.pctCurrent || 0),
          pctDelta: Number(bundle.pctDelta || 0),
          statusNote: bundle.academyStatusNoteHtml || (bundle.academyStatusNoteParagraphs || []).join('\\n'),
          blockers: Array.isArray(bundle.blockers) ? bundle.blockers : [],
          identifiedRisks: Array.isArray(bundle.identifiedRisks) ? bundle.identifiedRisks : [],
          workshopHistory: Array.isArray(bundle.workshops) ? bundle.workshops : [],
          product_usage: bundle.product_usage,
          contract_usage: bundle.contract_usage,
          riskSignals: bundle.riskSignals || [],
          bucket: bundle.bucket,
          bucketReasons: bundle.bucketReasons || [],
          academyUrl: bundle.academyUrl,
          bundle
        };
      },
      productKey(product) {
        const p = String(product || '').toLowerCase();
        if (p.includes('academy')) return 'publish-academy';
        if (p.includes('publish')) return 'publish';
        return 'fusion';
      },
      productLabel(product) {
        return product === 'publish-academy' ? 'Publish Academy' : product === 'publish' ? 'Publish' : 'Fusion';
      },
      stripHtml(value) {
        return String(value || '').replace(/<\/(p|div|li|h[1-6])>/gi, '\\n').replace(/<br\s*\/?>(\s*)/gi, '\\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
      },
      fmtDate(value) {
        if (!value) return '-';
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      },
      pctClass(value) {
        const pct = Number(value || 0);
        if (pct >= 75) return 'bg-emerald-600';
        if (pct >= 40) return 'bg-yellow-600';
        return 'bg-red-600';
      },
      sentimentClass(value) {
        const v = String(value || '').toLowerCase();
        if (v.includes('healthy')) return 'bg-emerald-500/15 text-emerald-700';
        if (v.includes('risk') || v.includes('radar')) return 'bg-yellow-500/15 text-yellow-700';
        if (v.includes('churn')) return 'bg-red-500/15 text-red-700';
        return 'bg-muted text-muted-foreground';
      },
      isActiveOnboarding(row) {
        const stage = String(row.onboardingStage || '').toLowerCase();
        if (!stage) return false;
        if (['live', 'post-implementation', 'post_implementation', 'churned', 'paused', 'other'].includes(stage)) return false;
        return ['onboarding', 'in_onboarding', 'in-onboarding', 'kickoff'].includes(stage);
      },
      activeRows() {
        return this.allRows.filter((r) => this.isActiveOnboarding(r));
      },
      visibleRows() {
        let rows = this.allRows;
        if (this.activeTab !== 'analytics') rows = rows.filter((r) => r.product === this.activeTab);
        if (this.activeTab !== 'analytics' && this.onboardingOnly) rows = rows.filter((r) => this.isActiveOnboarding(r));
        return this.sorted(rows);
      },
      sorted(rows) {
        if (!this.sort) return rows.slice();
        const key = this.sort.key;
        const dir = this.sort.dir === 'asc' ? 1 : -1;
        const value = (row) => {
          if (key === 'customer') return row.name || '';
          if (key === 'owner') return row.ownerName || '';
          if (key === 'kickoff') return row.kickoffDate ? Date.parse(row.kickoffDate) : 9999999999999;
          if (key === 'daysIn') return Number(row.daysSinceKickoff ?? 999999);
          if (key === 'goalPct') return Number(row.pctComplete || 0);
          if (key === 'lastActivity') return row.lastActivityAt ? Date.parse(row.lastActivityAt) : 9999999999999;
          return this.stripHtml(row.statusNote || '');
        };
        return rows.slice().sort((a, b) => {
          const av = value(a);
          const bv = value(b);
          const result = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), undefined, { sensitivity: 'base', numeric: true });
          return result === 0 ? String(a.name).localeCompare(String(b.name)) : result * dir;
        });
      },
      setSort(key) {
        if (!this.sort || this.sort.key !== key) this.sort = { key, dir: 'asc' };
        else if (this.sort.dir === 'asc') this.sort.dir = 'desc';
        else this.sort = null;
      },
      tabCount(tab) {
        if (tab === 'analytics') return this.activeRows().length;
        return this.allRows.filter((r) => r.product === tab && (!this.onboardingOnly || this.isActiveOnboarding(r))).length;
      },
      selected() {
        const rows = this.visibleRows();
        return rows.find((r) => r.orgId === this.selectedOrgId) || rows[0] || null;
      },
      analyticsRows() {
        return this.activeRows();
      },
      avg(values) {
        const nums = values.map(Number).filter((v) => Number.isFinite(v));
        return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
      },
      median(values) {
        const nums = values.map(Number).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
        if (!nums.length) return null;
        const mid = Math.floor(nums.length / 2);
        return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
      },
      fmtMetric(value, suffix) {
        return value == null ? '-' : Math.round(value) + suffix;
      },
      bucket(rows, key, buckets) {
        return buckets.map((b) => {
          const matched = rows.filter((r) => Number(r[key] || 0) >= b.min && Number(r[key] || 0) <= b.max);
          return { label: b.label, count: matched.length, customers: matched.map((r) => r.name) };
        });
      },
      bucketWidth(bucket, buckets) {
        const max = Math.max(1, ...buckets.map((b) => b.count));
        return Math.max(3, Math.round((bucket.count / max) * 100));
      },
      atRiskRows() {
        return this.analyticsRows().filter((r) => Number(r.daysSinceKickoff || 0) > 90 && Number(r.pctComplete || 0) < 50);
      },
      nearCompleteRows() {
        return this.analyticsRows().filter((r) => Number(r.pctComplete || 0) >= 80).sort((a, b) => Number(b.pctComplete || 0) - Number(a.pctComplete || 0));
      },
      noKickoffRows() {
        return this.analyticsRows().filter((r) => !r.kickoffDate);
      },
      diffFor(row) {
        const orgs = Array.isArray(this.byId['latest-diff']?.orgs) ? this.byId['latest-diff'].orgs : [];
        return orgs.find((o) => o.orgId === row.orgId);
      },
      crossrefFor(row) {
        const orgs = this.byId.crossref?.orgs || {};
        const direct = orgs[row.orgId] || orgs[row.name];
        if (direct) return direct;
        const domain = String(row.domain || '').toLowerCase();
        const name = String(row.name || '').toLowerCase();
        return Object.values(orgs).find((o) => (domain && String(o.domain || '').toLowerCase() === domain) || (name && String(o.name || '').toLowerCase() === name)) || null;
      },
      fmtTs(value) {
        if (!value) return '-';
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      },
      isClosedRisk(value) {
        return /\[\s*(done|closed)\s*\]/i.test(String(value || ''));
      },
      visibleRisks(row) {
        return (row.identifiedRisks || []).filter((risk) => !this.isClosedRisk(risk));
      },
      riskTicket(value) {
        const text = String(value || '');
        const url = (text.match(/https?:\/\/\S+/i) || [])[0];
        if (url) return { label: text.replace(url, '').trim() || url, url };
        const key = (text.match(/\b[A-Z][A-Z0-9]+-\d+\b/) || [])[0];
        if (key) return { label: text, url: 'https://builder-io.atlassian.net/browse/' + key };
        return null;
      },
      sortWorkshops(row) {
        return (row.workshopHistory || []).slice().sort((a, b) => String(b.date || b.startedAt || '').localeCompare(String(a.date || a.startedAt || '')));
      }
    }" x-init="init()" class="space-y-4">
      <p class="text-xs text-muted-foreground">Customers in onboarding status from migrated Academy snapshots, account bundles, weekly diffs, and Gong/Slack cross-reference data.</p>
      <p x-show="loading" class="rounded border p-4 text-muted-foreground">Loading migrated onboarding data...</p>
      <p x-show="error" x-text="error" class="rounded border border-red-300 bg-red-50 p-3 text-red-700"></p>

      <template x-if="!loading && !error">
        <div class="space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-1 rounded-lg border bg-card p-1">
              <template x-for="tab in productTabs" :key="tab.key">
                <button type="button" class="rounded-md px-3 py-1.5 text-sm transition-colors" :class="activeTab === tab.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'" x-on:click="activeTab = tab.key; selectedOrgId = visibleRows()[0]?.orgId || null">
                  <span x-text="tab.label"></span>
                  <span class="ml-1 text-xs tabular-nums opacity-70" x-text="tabCount(tab.key)"></span>
                </button>
              </template>
            </div>
            <label x-show="activeTab !== 'analytics'" class="flex items-center gap-2 text-sm">
              <input type="checkbox" class="h-4 w-4 rounded border" x-model="onboardingOnly" x-on:change="selectedOrgId = visibleRows()[0]?.orgId || null" />
              <span class="font-medium">Onboarding Customers Only</span>
              <span class="text-xs text-muted-foreground" x-text="onboardingOnly ? '(stage = onboarding)' : '(showing all stages)'"></span>
            </label>
          </div>

          <template x-if="activeTab === 'analytics'">
            <div class="space-y-4">
              <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div class="rounded-lg border bg-card p-4"><div class="text-xs uppercase text-muted-foreground">Active Onboardings</div><div class="mt-1 text-2xl font-semibold" x-text="analyticsRows().length"></div><div class="text-xs text-muted-foreground" x-text="tabCount('fusion') + ' Fusion / ' + tabCount('publish') + ' Publish / ' + tabCount('publish-academy') + ' Academy'"></div></div>
                <div class="rounded-lg border bg-card p-4"><div class="text-xs uppercase text-muted-foreground">Avg / Median Completion</div><div class="mt-1 text-2xl font-semibold" x-text="fmtMetric(avg(analyticsRows().map((r) => r.pctComplete)), '%')"></div><div class="text-xs text-muted-foreground" x-text="'Median ' + fmtMetric(median(analyticsRows().map((r) => r.pctComplete)), '%')"></div></div>
                <div class="rounded-lg border bg-card p-4"><div class="text-xs uppercase text-muted-foreground">Avg / Median Days In</div><div class="mt-1 text-2xl font-semibold" x-text="fmtMetric(avg(analyticsRows().map((r) => r.daysSinceKickoff)), 'd')"></div><div class="text-xs text-muted-foreground" x-text="'Median ' + fmtMetric(median(analyticsRows().map((r) => r.daysSinceKickoff)), 'd')"></div></div>
                <div class="rounded-lg border bg-card p-4"><div class="text-xs uppercase text-muted-foreground">At Risk</div><div class="mt-1 text-2xl font-semibold" x-text="atRiskRows().length"></div><div class="text-xs text-muted-foreground" x-text="'>90d in and <50% complete / ' + noKickoffRows().length + ' missing kickoff'"></div></div>
              </div>
              <div class="grid gap-4 lg:grid-cols-2">
                <div class="rounded-lg border bg-card p-4" x-data="{ buckets: bucket(analyticsRows(), 'pctComplete', [{ label: '0-20%', min: 0, max: 20 }, { label: '21-40%', min: 21, max: 40 }, { label: '41-60%', min: 41, max: 60 }, { label: '61-80%', min: 61, max: 80 }, { label: '81-100%', min: 81, max: 100 }]) }">
                  <div class="mb-3"><div class="font-medium">Completion % spread</div><div class="text-xs text-muted-foreground">How far along customers are. Customer names mirror the legacy chart tooltip.</div></div>
                  <template x-for="b in bucket(analyticsRows(), 'pctComplete', [{ label: '0-20%', min: 0, max: 20 }, { label: '21-40%', min: 21, max: 40 }, { label: '41-60%', min: 41, max: 60 }, { label: '61-80%', min: 61, max: 80 }, { label: '81-100%', min: 81, max: 100 }])" :key="b.label">
                    <div class="mb-3 text-xs"><div class="grid grid-cols-[70px_1fr_32px] items-center gap-2"><span x-text="b.label"></span><div class="h-2 rounded bg-muted"><div class="h-2 rounded bg-blue-500" :style="'width:' + bucketWidth(b, bucket(analyticsRows(), 'pctComplete', [{ label: '0-20%', min: 0, max: 20 }, { label: '21-40%', min: 21, max: 40 }, { label: '41-60%', min: 41, max: 60 }, { label: '61-80%', min: 61, max: 80 }, { label: '81-100%', min: 81, max: 100 }])) + '%'"></div></div><span class="text-right tabular-nums" x-text="b.count"></span></div><div x-show="b.customers.length" class="mt-1 truncate text-[11px] text-muted-foreground" x-text="b.customers.slice(0, 8).join(', ') + (b.customers.length > 8 ? ' +' + (b.customers.length - 8) + ' more' : '')"></div></div>
                  </template>
                </div>
                <div class="rounded-lg border bg-card p-4">
                  <div class="mb-3"><div class="font-medium">Days since kickoff</div><div class="text-xs text-muted-foreground">Length of onboarding so far. Older buckets are more likely stalled.</div></div>
                  <template x-for="b in bucket(analyticsRows(), 'daysSinceKickoff', [{ label: '0-30d', min: 0, max: 30 }, { label: '31-60d', min: 31, max: 60 }, { label: '61-90d', min: 61, max: 90 }, { label: '91-120d', min: 91, max: 120 }, { label: '120d+', min: 121, max: 9999 }])" :key="b.label">
                    <div class="mb-3 text-xs"><div class="grid grid-cols-[70px_1fr_32px] items-center gap-2"><span x-text="b.label"></span><div class="h-2 rounded bg-muted"><div class="h-2 rounded bg-amber-500" :style="'width:' + bucketWidth(b, bucket(analyticsRows(), 'daysSinceKickoff', [{ label: '0-30d', min: 0, max: 30 }, { label: '31-60d', min: 31, max: 60 }, { label: '61-90d', min: 61, max: 90 }, { label: '91-120d', min: 91, max: 120 }, { label: '120d+', min: 121, max: 9999 }])) + '%'"></div></div><span class="text-right tabular-nums" x-text="b.count"></span></div><div x-show="b.customers.length" class="mt-1 truncate text-[11px] text-muted-foreground" x-text="b.customers.slice(0, 8).join(', ') + (b.customers.length > 8 ? ' +' + (b.customers.length - 8) + ' more' : '')"></div></div>
                  </template>
                </div>
              </div>
              <div x-show="nearCompleteRows().length" class="rounded-lg border bg-card p-4">
                <div class="mb-2 font-medium" x-text="'Near complete (' + nearCompleteRows().length + ')'"></div>
                <div class="mb-2 text-xs text-muted-foreground">Customers at or above 80% completion, good candidates to graduate from onboarding.</div>
                <div class="flex flex-wrap gap-1.5">
                  <template x-for="row in nearCompleteRows()" :key="row.orgId">
                    <button type="button" class="rounded-full border px-2 py-1 text-xs hover:bg-muted" x-on:click="activeTab = row.product; selectedOrgId = row.orgId" x-text="row.name + ' ' + Number(row.pctComplete || 0) + '%'"></button>
                  </template>
                </div>
              </div>
            </div>
          </template>

          <template x-if="activeTab !== 'analytics'">
            <div class="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)]">
              <div class="overflow-hidden rounded-lg border">
                <table class="w-full text-sm">
                  <thead class="bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th class="px-3 py-2 text-left"><button x-on:click="setSort('customer')">Customer</button></th>
                      <th class="px-3 py-2 text-left"><button x-on:click="setSort('owner')">Owner (CE)</button></th>
                      <th class="px-3 py-2 text-left"><button x-on:click="setSort('kickoff')">Kickoff</button></th>
                      <th class="px-3 py-2 text-right"><button x-on:click="setSort('daysIn')">Days in</button></th>
                      <th class="px-3 py-2 text-left"><button x-on:click="setSort('goalPct')">Goal %</button></th>
                      <th class="px-3 py-2 text-left"><button x-on:click="setSort('statusNote')">Last status note</button></th>
                      <th class="px-3 py-2 text-left"><button x-on:click="setSort('lastActivity')">Last activity</button></th>
                    </tr>
                  </thead>
                  <tbody>
                    <template x-for="row in visibleRows()" :key="row.orgId">
                      <tr class="cursor-pointer border-t hover:bg-muted/30" :class="selectedOrgId === row.orgId ? 'bg-primary/5' : ''" x-on:click="selectedOrgId = row.orgId">
                        <td class="px-3 py-2 font-medium" x-text="row.name"></td>
                        <td class="px-3 py-2 text-muted-foreground" x-text="row.ownerName || '-'"></td>
                        <td class="px-3 py-2 text-muted-foreground" x-text="fmtDate(row.kickoffDate)"></td>
                        <td class="px-3 py-2 text-right tabular-nums text-muted-foreground" x-text="row.daysSinceKickoff ?? '-'"></td>
                        <td class="px-3 py-2"><div class="flex items-center gap-2"><div class="h-1.5 w-20 overflow-hidden rounded-full bg-muted"><div class="h-full" :class="pctClass(row.pctComplete)" :style="'width:' + Math.max(0, Math.min(100, Number(row.pctComplete || 0))) + '%'"></div></div><span class="text-xs tabular-nums text-muted-foreground" x-text="Number(row.pctComplete || 0) + '%'"></span></div></td>
                        <td class="max-w-xs truncate px-3 py-2 text-xs text-muted-foreground" x-text="stripHtml(row.statusNote || '') || '-'"></td>
                        <td class="px-3 py-2 text-xs text-muted-foreground" x-text="fmtDate(row.lastActivityAt)"></td>
                      </tr>
                    </template>
                  </tbody>
                </table>
                <p x-show="visibleRows().length === 0" class="p-8 text-center text-sm text-muted-foreground">No customers in this view.</p>
              </div>

              <template x-if="selected()">
                <aside class="space-y-4">
                  <section class="rounded-lg border p-4">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <h2 class="truncate text-lg font-semibold" x-text="selected().name"></h2>
                        <p class="mt-1 text-xs text-muted-foreground" x-text="(selected().domain ? selected().domain + ' / ' : '') + 'Owner: ' + (selected().ownerName || '-') + ' / Kickoff: ' + fmtDate(selected().kickoffDate) + ' / ' + (selected().daysSinceKickoff ?? '?') + ' days in'"></p>
                        <div class="mt-2 flex flex-wrap gap-1.5">
                          <span class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" x-text="selected().accountStatus || 'status unknown'"></span>
                          <span class="rounded px-1.5 py-0.5 text-[10px]" :class="sentimentClass(selected().csmSentiment)" x-text="selected().csmSentiment || 'sentiment unknown'"></span>
                          <span class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" x-show="selected().onboardingStage" x-text="'stage: ' + selected().onboardingStage"></span>
                          <span class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" x-text="(selected().activeUserCount || 0) + ' active users'"></span>
                        </div>
                        <p class="mt-1 font-mono text-[10px] text-muted-foreground" x-text="'orgId: ' + selected().orgId"></p>
                      </div>
                      <a :href="selected().academyUrl || 'https://academy.builder.io'" target="_blank" rel="noreferrer" class="shrink-0 text-xs text-primary hover:underline">Open in Academy</a>
                    </div>
                    <div x-show="selected().statusNote" class="mt-3 rounded-md bg-muted/40 p-3 text-sm">
                      <div class="mb-1 text-xs text-muted-foreground">Status note</div>
                      <p class="whitespace-pre-wrap leading-relaxed" x-text="stripHtml(selected().statusNote || '')"></p>
                    </div>
                  </section>
                  <section class="rounded-lg border p-4">
                    <h3 class="mb-3 text-sm font-semibold">Goals <span class="font-normal text-muted-foreground" x-text="'(' + (selected().goalsCompleted || selected().goals?.filter((g) => g.completed).length || 0) + '/' + (selected().goalsTotal || selected().goals?.length || 0) + ')'"></span></h3>
                    <p x-show="!selected().goals || selected().goals.length === 0" class="text-xs text-muted-foreground">No onboarding goal targets configured for this org.</p>
                    <ul class="space-y-1.5">
                      <template x-for="goal in (selected().goals || [])" :key="goal.id || goal.title">
                        <li class="flex items-center gap-2 text-sm"><span class="h-2.5 w-2.5 rounded-full" :class="goal.completed ? 'bg-emerald-500' : 'bg-muted-foreground/40'"></span><span class="flex-1" x-text="goal.title"></span><span class="text-xs tabular-nums text-muted-foreground" x-text="(goal.current ?? '') + (goal.target != null ? '/' + goal.target : '') + (goal.pct != null ? ' / ' + goal.pct + '%' : '')"></span></li>
                      </template>
                    </ul>
                  </section>
                  <section class="rounded-lg border p-4" x-show="(selected().blockers || []).length || (selected().identifiedRisks || []).length || (selected().riskSignals || []).length">
                    <h3 class="mb-3 text-sm font-semibold">Risks and blockers</h3>
                    <template x-for="label in ['blockers', 'identifiedRisks', 'riskSignals']" :key="label">
                      <div x-show="(selected()[label] || []).length" class="mb-3">
                        <div class="mb-1 text-xs capitalize text-muted-foreground" x-text="label.replace(/([A-Z])/g, ' $1')"></div>
                        <ul class="list-disc space-y-1 pl-5 text-sm"><template x-for="item in selected()[label]" :key="String(item)"><li x-text="String(item)"></li></template></ul>
                      </div>
                    </template>
                  </section>
                  <section class="rounded-lg border p-4" x-show="(selected().workshopHistory || []).length">
                    <h3 class="mb-3 text-sm font-semibold">Workshops</h3>
                    <ul class="space-y-2"><template x-for="workshop in (selected().workshopHistory || [])" :key="workshop.id || workshop.name || workshop.date"><li class="flex justify-between gap-3 text-sm"><span class="font-medium" x-text="workshop.name || workshop.title || 'Workshop'"></span><span class="text-xs text-muted-foreground" x-text="fmtDate(workshop.date || workshop.startedAt)"></span></li></template></ul>
                  </section>
                  <section class="rounded-lg border p-4" x-show="(selected().planProgress || []).length">
                    <h3 class="mb-3 text-sm font-semibold">Plan progress</h3>
                    <template x-for="plan in (selected().planProgress || [])" :key="plan.planKey || plan.planName">
                      <div class="mb-2 text-sm"><div class="flex justify-between gap-2"><span x-text="plan.planName || plan.planKey"></span><span class="text-xs text-muted-foreground" x-text="(plan.progressPercent || 0) + '% / ' + (plan.completedCheckpointCount || 0) + ' checkpoints'"></span></div><div class="mt-1 h-1.5 rounded-full bg-muted"><div class="h-full rounded-full bg-primary" :style="'width:' + Math.min(100, Number(plan.progressPercent || 0)) + '%'"></div></div></div>
                    </template>
                  </section>
                  <section class="rounded-lg border p-4">
                    <div class="mb-3 flex items-baseline justify-between"><h3 class="text-sm font-semibold">What changed</h3><span class="text-xs text-muted-foreground" x-text="(byId['latest-diff']?.from || '') + (byId['latest-diff']?.to ? ' -> ' + byId['latest-diff'].to : '')"></span></div>
                    <template x-if="diffFor(selected())"><pre class="max-h-48 overflow-auto whitespace-pre-wrap text-xs" x-text="JSON.stringify(diffFor(selected()), null, 2)"></pre></template>
                    <p x-show="!diffFor(selected())" class="text-xs text-muted-foreground">No changes for this customer in the latest snapshot.</p>
                  </section>
                  <section class="rounded-lg border p-4">
                    <h3 class="mb-3 text-sm font-semibold">Recent activity (Gong and Slack)</h3>
                    <template x-if="crossrefFor(selected())"><pre class="max-h-48 overflow-auto whitespace-pre-wrap text-xs" x-text="JSON.stringify(crossrefFor(selected()), null, 2)"></pre></template>
                    <p x-show="!crossrefFor(selected())" class="text-xs text-muted-foreground">No migrated cross-reference data found for this account.</p>
                  </section>
                </aside>
              </template>
            </div>
          </template>
        </div>
      </template>
    </div>`,
  );
}

export function competitiveLandscapeExtension(): string {
  return baseExtension(
    "Competitive Landscape",
    String.raw`<div x-data="{
      loading: true,
      error: '',
      data: null,
      status: null,
      active: [],
      colors: { Replit: '#f97316', Lovable: '#ec4899', 'Figma Make': '#8b5cf6', Cursor: '#06b6d4', 'Claude Code': '#10b981' },
      readData(item) {
        let value = item ? item.data : null;
        if (typeof value === 'string') {
          try { value = JSON.parse(value); } catch (e) {}
        }
        if (value && value.value !== undefined) return value.value;
        if (value && value.data && value.data.value !== undefined) return value.data.value;
        if (value && value.data !== undefined) return value.data;
        return value;
      },
      async init() {
        try {
          const items = await extensionData.list('competitive', { scope: 'org' });
          const byId = {};
          for (const item of items) byId[item.itemId || item.id] = this.readData(item);
          this.data = byId.mentions || null;
          this.status = byId.status || null;
        } catch (e) {
          this.error = e && e.message ? e.message : String(e);
        } finally {
          this.loading = false;
        }
      },
      competitors() {
        const names = this.data?.competitors || ['Replit', 'Lovable', 'Figma Make', 'Cursor', 'Claude Code'];
        return names.slice().sort((a, b) => Number(this.data?.totals?.[b] || 0) - Number(this.data?.totals?.[a] || 0));
      },
      visibleCompetitors() {
        return this.active.length ? this.active : this.competitors();
      },
      toggle(name) {
        this.active = this.active.includes(name) ? this.active.filter((n) => n !== name) : this.active.concat(name);
      },
      trend(name) {
        const months = this.data?.monthlyData || [];
        if (months.length < 4) return { pct: 0, dir: 'flat' };
        const half = Math.floor(months.length / 2);
        const first = months.slice(0, half).reduce((sum, month) => sum + Number(month.competitors?.[name] || 0), 0);
        const second = months.slice(half).reduce((sum, month) => sum + Number(month.competitors?.[name] || 0), 0);
        if (!first && !second) return { pct: 0, dir: 'flat' };
        if (!first) return { pct: 100, dir: 'up' };
        const pct = Math.round(((second - first) / first) * 100);
        return { pct: Math.abs(pct), dir: pct > 5 ? 'up' : pct < -5 ? 'down' : 'flat' };
      },
      maxMonth() {
        return Math.max(1, ...(this.data?.monthlyData || []).flatMap((month) => this.competitors().map((name) => Number(month.competitors?.[name] || 0))));
      },
      fmtDate(value) {
        if (!value) return '-';
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
      }
    }" x-init="init()" class="space-y-4">
      <p class="text-xs text-muted-foreground">Tracks competitor mentions in customer-facing Gong call transcripts over the migrated lookback window.</p>
      <p x-show="loading" class="rounded border p-4 text-muted-foreground">Loading migrated competitor data...</p>
      <p x-show="error" x-text="error" class="rounded border border-red-300 bg-red-50 p-3 text-red-700"></p>

      <template x-if="!loading && !error">
        <div class="space-y-4">
          <section class="rounded-lg border bg-card p-4">
            <div class="flex flex-wrap items-center justify-between gap-4">
              <div class="space-y-1">
                <p class="text-sm font-medium">Gong Transcript Analysis</p>
                <p class="text-xs text-muted-foreground">Scans customer call transcripts for Replit, Lovable, Figma Make, Cursor, and Claude Code. <span x-show="data?.lastUpdated">Last run: <span x-text="fmtDate(data?.lastUpdated)"></span></span></p>
              </div>
              <span class="rounded-full border px-3 py-1 text-xs font-medium" :class="status?.status === 'done' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : status?.status === 'running' ? 'border-blue-300 bg-blue-50 text-blue-700' : status?.status === 'error' ? 'border-red-300 bg-red-50 text-red-700' : 'bg-muted text-muted-foreground'" x-text="status?.status || 'snapshot'"></span>
            </div>
            <div x-show="status?.progress" class="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
              <div>Phase: <span x-text="status?.progress?.phase || '-'"></span></div>
              <div>Calls fetched: <span x-text="Number(status?.progress?.callsFetched || 0).toLocaleString()"></span></div>
              <div>Customer calls: <span x-text="Number(status?.progress?.customerCalls || 0).toLocaleString()"></span></div>
              <div>Processed: <span x-text="Number(status?.progress?.transcriptsProcessed || 0).toLocaleString()"></span></div>
            </div>
          </section>

          <template x-if="data">
            <div class="space-y-4">
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div class="rounded-lg border bg-card p-4"><div class="text-2xl font-bold" x-text="Number(data.totalCustomerCalls || 0).toLocaleString()"></div><div class="text-xs text-muted-foreground">Customer calls analyzed</div></div>
                <div class="rounded-lg border bg-card p-4"><div class="text-2xl font-bold" x-text="Object.values(data.totals || {}).reduce((sum, value) => sum + Number(value || 0), 0).toLocaleString()"></div><div class="text-xs text-muted-foreground">Total competitor call-mentions</div></div>
              </div>

              <div class="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <template x-for="name in competitors()" :key="name">
                  <button type="button" x-on:click="toggle(name)" class="rounded-lg border bg-card p-4 text-left transition-all" :class="active.includes(name) ? 'border-primary ring-1 ring-primary/30' : (active.length && !active.includes(name) ? 'opacity-45' : 'hover:border-border/80')">
                    <div class="mb-2 flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-full" :style="'background:' + (colors[name] || '#94a3b8')"></span><span class="truncate text-xs font-medium" x-text="name"></span></div>
                    <div class="text-2xl font-bold" :style="'color:' + (colors[name] || 'currentColor')" x-text="Number(data.totals?.[name] || 0).toLocaleString()"></div>
                    <div class="mb-1 text-xs text-muted-foreground">total calls</div>
                    <div class="text-xs font-medium" :class="trend(name).dir === 'up' ? 'text-rose-600' : trend(name).dir === 'down' ? 'text-emerald-600' : 'text-muted-foreground'" x-text="trend(name).dir === 'flat' ? 'Flat' : (trend(name).pct + '% ' + trend(name).dir)"></div>
                  </button>
                </template>
              </div>

              <section class="rounded-lg border bg-card p-4">
                <div class="mb-3 flex items-center justify-between gap-3">
                  <div><h2 class="text-sm font-medium">Monthly Competitor Mentions in Customer Calls</h2><p class="text-xs text-muted-foreground">Distinct customer calls per month where each competitor was mentioned.</p></div>
                  <button x-show="active.length" type="button" class="text-xs text-muted-foreground underline hover:text-foreground" x-on:click="active = []">Show all</button>
                </div>
                <div class="space-y-3">
                  <template x-for="month in (data.monthlyData || [])" :key="month.month">
                    <div class="grid grid-cols-[72px_1fr] gap-3">
                      <div class="text-xs font-medium text-muted-foreground" x-text="month.label || month.month"></div>
                      <div class="flex h-7 items-end gap-1">
                        <template x-for="name in visibleCompetitors()" :key="name">
                          <div class="min-w-5 flex-1 rounded-t" :title="name + ': ' + Number(month.competitors?.[name] || 0)" :style="'height:' + Math.max(3, Number(month.competitors?.[name] || 0) / maxMonth() * 28) + 'px; background:' + (colors[name] || '#94a3b8')"></div>
                        </template>
                      </div>
                    </div>
                  </template>
                </div>
              </section>

              <section class="overflow-hidden rounded-lg border bg-card">
                <div class="border-b p-4"><h2 class="text-sm font-medium">Monthly Breakdown</h2><p class="text-xs text-muted-foreground">Customer calls mentioning each competitor by month</p></div>
                <div class="overflow-x-auto">
                  <table class="w-full text-sm">
                    <thead><tr class="border-b bg-muted/30"><th class="px-3 py-2 text-left text-xs text-muted-foreground">Month</th><th class="px-3 py-2 text-center text-xs text-muted-foreground">Calls</th><template x-for="name in competitors()" :key="name"><th class="px-3 py-2 text-center text-xs text-muted-foreground"><span x-text="name"></span></th></template></tr></thead>
                    <tbody><template x-for="month in (data.monthlyData || []).slice().reverse()" :key="month.month"><tr class="border-b"><td class="px-3 py-2 text-xs font-medium text-muted-foreground" x-text="month.label || month.month"></td><td class="px-3 py-2 text-center text-xs" x-text="month.customerCallCount"></td><template x-for="name in competitors()" :key="name"><td class="px-3 py-2 text-center text-xs font-semibold" :style="'color:' + (colors[name] || 'currentColor')" x-text="month.competitors?.[name] || '-'"></td></template></tr></template></tbody>
                    <tfoot><tr class="border-t"><td class="px-3 py-2 text-xs font-bold">Total</td><td class="px-3 py-2 text-center text-xs font-semibold" x-text="data.totalCustomerCalls"></td><template x-for="name in competitors()" :key="name"><td class="px-3 py-2 text-center text-xs font-bold" :style="'color:' + (colors[name] || 'currentColor')" x-text="data.totals?.[name] || 0"></td></template></tr></tfoot>
                  </table>
                </div>
              </section>

              <section class="rounded-lg border border-border/50 p-3 text-xs text-muted-foreground space-y-1">
                <p><span class="font-medium text-foreground">Methodology</span> - Each competitor is counted once per call, even if mentioned multiple times. Only external customer-facing calls are included.</p>
                <p><span class="font-medium text-foreground">Search terms</span> - Replit: replit / Lovable: lovable / Figma Make: figma make or make by figma / Cursor: cursor / Claude Code: claude code.</p>
                <p><span class="font-medium text-foreground">Trend</span> - Compares first half vs second half of the migrated lookback window. Up means a competitor was mentioned more recently.</p>
                <p class="text-muted-foreground/70" x-text="'Data from ' + Number(data.totalCallsAnalyzed || 0).toLocaleString() + ' total Gong calls (' + Number(data.totalCustomerCalls || 0).toLocaleString() + ' customer-facing) since ' + fmtDate(data.fromDate) + '.'"></p>
              </section>
            </div>
          </template>
        </div>
      </template>
    </div>`,
  );
}

export function strategicAccountsExtension(): string {
  return baseExtension(
    "Strategic Accounts",
    String.raw`<div x-data="{
      loading: true,
      error: '',
      accounts: [],
      blockers: [],
      selectedName: '',
      lastUpdated: '',
      rawSources: [],
      readData(item) {
        let value = item ? item.data : null;
        if (typeof value === 'string') {
          try { value = JSON.parse(value); } catch (e) {}
        }
        if (value && value.value !== undefined) return value.value;
        if (value && value.data && value.data.value !== undefined) return value.data.value;
        if (value && value.data !== undefined) return value.data;
        return value;
      },
      async init() {
        try {
          const items = await extensionData.list('strategic', { scope: 'org' });
          const byId = {};
          this.rawSources = items.map((item) => {
            const value = this.readData(item);
            return { id: item.itemId || item.id, sourcePath: value?.sourcePath || '', value };
          });
          for (const item of this.rawSources) byId[item.id] = item.value;
          this.lastUpdated = this.parseStringConst(byId['accounts-data'] || '', 'DATA_LAST_UPDATED');
          this.accounts = this.parseArrayConst(byId['accounts-data'] || '', 'STRATEGIC_ACCOUNTS');
          this.blockers = this.parseArrayConst(byId['impl-blockers-data'] || '', 'accountData');
          this.selectedName = this.accounts[0]?.name || '';
        } catch (e) {
          this.error = e && e.message ? e.message : String(e);
        } finally {
          this.loading = false;
        }
      },
      parseStringConst(source, name) {
        const line = String(source || '').split('\\n').find((entry) => entry.includes('export const ' + name));
        if (!line) return '';
        const value = line.slice(line.indexOf('=') + 1).trim();
        const quoteCode = value.charCodeAt(0);
        if (quoteCode !== 34 && quoteCode !== 39) return '';
        const quote = String.fromCharCode(quoteCode);
        const end = value.indexOf(quote, 1);
        return end > 0 ? value.slice(1, end) : '';
      },
      parseArrayConst(source, name) {
        const text = String(source || '');
        const marker = 'export const ' + name;
        const startMarker = text.indexOf(marker);
        if (startMarker < 0) return [];
        const equals = text.indexOf('=', startMarker);
        const start = text.indexOf('[', equals);
        if (start < 0) return [];
        let depth = 0;
        let quote = '';
        let escaped = false;
        for (let i = start; i < text.length; i++) {
          const ch = text[i];
          if (quote) {
            if (escaped) escaped = false;
            else if (ch === '\\\\') escaped = true;
            else if (ch === quote) quote = '';
            continue;
          }
          if (
            ch.charCodeAt(0) === 39 ||
            ch.charCodeAt(0) === 34 ||
            ch.charCodeAt(0) === 96
          ) {
            quote = ch;
            continue;
          }
          if (ch === '[') depth++;
          if (ch === ']') {
            depth--;
            if (depth === 0) {
              const arrayText = text.slice(start, i + 1);
              try {
                return Function('return (' + arrayText + ');')();
              } catch (e) {
                return [];
              }
            }
          }
        }
        return [];
      },
      coverage(account) {
        const score = (contacts) => contacts?.some((c) => c.confidence === 'high') ? 2 : contacts?.some((c) => c.confidence === 'medium') ? 1 : contacts?.length ? 0.5 : 0;
        const total = [score(account.champions), score(account.enablers), score(account.execSponsors)];
        const highOrMedium = total.filter((v) => v >= 1).length;
        const any = total.filter((v) => v > 0).length;
        return highOrMedium >= 2 ? 'clear' : any >= 1 ? 'partial' : 'gap';
      },
      selected() {
        return this.accounts.find((account) => account.name === this.selectedName) || this.accounts[0] || null;
      },
      blockersFor(name) {
        return this.blockers.find((account) => account.company.toLowerCase() === String(name || '').toLowerCase());
      },
      confidenceClass(confidence) {
        if (confidence === 'high') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
        if (confidence === 'medium') return 'border-amber-200 bg-amber-50 text-amber-800';
        return 'border-muted bg-muted text-muted-foreground';
      },
      coverageClass(level) {
        if (level === 'clear') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
        if (level === 'partial') return 'border-amber-200 bg-amber-50 text-amber-700';
        return 'border-red-200 bg-red-50 text-red-700';
      },
      sourceLabel(sources) {
        return Number(sources?.gongCalls || 0) + ' calls / ' + Number(sources?.hubspotContacts || 0) + ' contacts / ' + (sources?.hasSlack ? 'Slack' : 'No Slack');
      },
      contactLine(contact) {
        return [contact.name, contact.title, contact.email].filter(Boolean).join(' / ');
      }
    }" x-init="init()" class="space-y-4">
      <p class="text-xs text-muted-foreground">Relationship coverage and implementation blockers parsed from migrated Fusion source data.</p>
      <p x-show="loading" class="rounded border p-4 text-muted-foreground">Loading migrated strategic account source data...</p>
      <p x-show="error" x-text="error" class="rounded border border-red-300 bg-red-50 p-3 text-red-700"></p>

      <template x-if="!loading && !error">
        <div class="space-y-4">
          <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 class="text-2xl font-bold tracking-tight">Strategic Accounts</h2>
              <p class="mt-1 text-sm text-muted-foreground" x-text="'Overview of ' + accounts.length + ' focus accounts tracked per the Focus Account Rhythm framework'"></p>
            </div>
            <div class="text-xs text-muted-foreground" x-show="lastUpdated">Last refreshed: <span x-text="new Date(lastUpdated).toLocaleDateString()"></span></div>
          </div>

          <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div class="rounded-lg border bg-card p-4"><div class="text-xs text-muted-foreground">Total Accounts</div><div class="mt-1 text-3xl font-semibold" x-text="accounts.length"></div></div>
            <div class="rounded-lg border bg-card p-4"><div class="text-xs text-muted-foreground">Clear Coverage</div><div class="mt-1 text-3xl font-semibold" x-text="accounts.filter((a) => coverage(a) === 'clear').length"></div></div>
            <div class="rounded-lg border bg-card p-4"><div class="text-xs text-muted-foreground">Partial Coverage</div><div class="mt-1 text-3xl font-semibold" x-text="accounts.filter((a) => coverage(a) === 'partial').length"></div></div>
            <div class="rounded-lg border bg-card p-4"><div class="text-xs text-muted-foreground">Active Blockers</div><div class="mt-1 text-3xl font-semibold" x-text="blockers.reduce((sum, account) => sum + (account.blockers || []).filter((b) => b.status === 'active').length, 0)"></div></div>
          </div>

          <div class="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.8fr)]">
            <section class="overflow-hidden rounded-lg border">
              <table class="w-full text-sm">
                <thead class="bg-muted/50"><tr><th class="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Account</th><th class="border-l px-4 py-3 text-left text-xs uppercase text-muted-foreground">Champion</th><th class="border-l px-4 py-3 text-left text-xs uppercase text-muted-foreground">Enabler</th><th class="border-l px-4 py-3 text-left text-xs uppercase text-muted-foreground">Exec Sponsor</th><th class="border-l px-4 py-3 text-left text-xs uppercase text-muted-foreground">Sources</th></tr></thead>
                <tbody>
                  <template x-for="account in accounts" :key="account.name">
                    <tr class="cursor-pointer border-t hover:bg-muted/30" :class="selectedName === account.name ? 'bg-primary/5' : ''" x-on:click="selectedName = account.name">
                      <td class="px-4 py-3 align-top"><div class="font-semibold" x-text="account.name"></div><span class="mt-2 inline-flex rounded border px-2 py-0.5 text-xs font-medium capitalize" :class="coverageClass(coverage(account))" x-text="coverage(account)"></span></td>
                      <template x-for="role in ['champions', 'enablers', 'execSponsors']" :key="role">
                        <td class="border-l px-4 py-3 align-top">
                          <template x-for="contact in (account[role] || []).slice(0, 2)" :key="contact.email || contact.name">
                            <div class="mb-2 rounded border p-2">
                              <div class="text-xs font-medium" x-text="contact.name"></div>
                              <div class="text-[11px] text-muted-foreground" x-text="contact.title"></div>
                              <span class="mt-1 inline-flex rounded border px-1.5 py-0.5 text-[10px]" :class="confidenceClass(contact.confidence)" x-text="contact.confidence"></span>
                            </div>
                          </template>
                          <p x-show="!(account[role] || []).length" class="text-xs text-muted-foreground">No contact</p>
                        </td>
                      </template>
                      <td class="border-l px-4 py-3 align-top text-xs text-muted-foreground" x-text="sourceLabel(account.sources)"></td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </section>

            <template x-if="selected()">
              <aside class="space-y-4">
                <section class="rounded-lg border p-4">
                  <div class="flex items-start justify-between gap-3">
                    <div><h2 class="text-lg font-semibold" x-text="selected().name"></h2><p class="mt-1 text-xs text-muted-foreground" x-text="sourceLabel(selected().sources)"></p></div>
                    <span class="rounded border px-2 py-0.5 text-xs capitalize" :class="coverageClass(coverage(selected()))" x-text="coverage(selected()) + ' coverage'"></span>
                  </div>
                  <p class="mt-3 text-sm leading-relaxed text-muted-foreground" x-text="selected().notes || 'No account notes parsed.'"></p>
                </section>

                <section class="rounded-lg border p-4">
                  <h3 class="mb-3 text-sm font-semibold">Relationship coverage</h3>
                  <template x-for="role in [{ key: 'champions', label: 'Champion' }, { key: 'enablers', label: 'Enabler' }, { key: 'execSponsors', label: 'Exec Sponsor' }]" :key="role.key">
                    <div class="mb-4">
                      <div class="mb-2 text-xs font-medium uppercase text-muted-foreground" x-text="role.label"></div>
                      <template x-for="contact in (selected()[role.key] || [])" :key="contact.email || contact.name">
                        <div class="mb-2 rounded-lg border p-3">
                          <div class="flex items-start justify-between gap-2"><div><div class="font-medium" x-text="contact.name"></div><div class="text-xs text-muted-foreground" x-text="contact.title"></div><div class="text-xs text-muted-foreground" x-text="contact.email"></div></div><span class="rounded border px-1.5 py-0.5 text-[10px]" :class="confidenceClass(contact.confidence)" x-text="contact.confidence"></span></div>
                          <p class="mt-2 text-xs leading-relaxed text-muted-foreground" x-text="contact.rationale"></p>
                        </div>
                      </template>
                      <p x-show="!(selected()[role.key] || []).length" class="text-xs text-muted-foreground">No contact identified.</p>
                    </div>
                  </template>
                </section>

                <section class="rounded-lg border p-4">
                  <h3 class="mb-3 text-sm font-semibold">Implementation blockers</h3>
                  <template x-if="blockersFor(selected().name)">
                    <div class="space-y-3">
                      <div class="text-xs text-muted-foreground" x-text="blockersFor(selected().name).hubspotStatus"></div>
                      <template x-for="blocker in blockersFor(selected().name).blockers" :key="blocker.summary">
                        <div class="rounded-lg border p-3">
                          <div class="flex flex-wrap items-start justify-between gap-2"><div class="font-medium" x-text="blocker.summary"></div><span class="rounded-full border px-2 py-0.5 text-xs" :class="blocker.status === 'active' ? 'border-red-200 bg-red-50 text-red-700' : blocker.status === 'resolved' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'" x-text="blocker.status"></span></div>
                          <div class="mt-1 text-xs text-muted-foreground" x-text="blocker.type + ' / ' + blocker.severity + ' / ' + (blocker.source || []).join(', ')"></div>
                          <p class="mt-2 text-xs leading-relaxed text-muted-foreground" x-text="blocker.detail || ''"></p>
                        </div>
                      </template>
                      <div x-show="blockersFor(selected().name).notes" class="rounded bg-muted/50 p-3 text-xs text-muted-foreground"><span class="font-medium text-foreground">Notes: </span><span x-text="blockersFor(selected().name).notes"></span></div>
                    </div>
                  </template>
                  <p x-show="!blockersFor(selected().name)" class="text-xs text-muted-foreground">No blocker source data found for this account.</p>
                </section>

                <section class="rounded-lg border p-4">
                  <h3 class="mb-3 text-sm font-semibold">Objectives and sections</h3>
                  <div class="grid gap-2 text-xs text-muted-foreground">
                    <div class="rounded border p-2"><span class="font-medium text-foreground">Expansion Strategy</span> - Use HubSpot thesis and account notes as the source of truth.</div>
                    <div class="rounded border p-2"><span class="font-medium text-foreground">Quarterly Objectives</span> - Validate champion, enabler, and exec sponsor coverage gaps.</div>
                    <div class="rounded border p-2"><span class="font-medium text-foreground">Account Team and Slack</span> - Dedicated account channel follows customer slug convention.</div>
                  </div>
                </section>
              </aside>
            </template>
          </div>

          <details class="rounded-lg border">
            <summary class="cursor-pointer px-3 py-2 text-sm text-muted-foreground">Source data fallback</summary>
            <div class="space-y-3 border-t p-3">
              <template x-for="source in rawSources" :key="source.id">
                <div><div class="mb-1 text-xs font-medium" x-text="source.id + ' - ' + source.sourcePath"></div><pre class="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-3 text-xs" x-text="String(source.value).slice(0, 8000)"></pre></div>
              </template>
            </div>
          </details>
        </div>
      </template>
    </div>`,
  );
}

export function agentNativeMetricsExtension(): string {
  return baseExtension(
    "Product Double Click Metrics",
    String.raw`<div x-data="{
      loading: true,
      error: '',
      npmRows: [],
      npmMeta: null,
      stars: null,
      contributors: null,
      readData(item) {
        let value = item ? item.data : null;
        if (typeof value === 'string') {
          try { value = JSON.parse(value); } catch (e) {}
        }
        if (value && value.value !== undefined) return value.value;
        if (value && value.data && value.data.value !== undefined) return value.data.value;
        if (value && value.data !== undefined) return value.data;
        return value;
      },
      async init() {
        try {
          const items = await extensionData.list('agent-native-metrics', { scope: 'org' });
          const byId = {};
          for (const item of items) byId[item.itemId || item.id] = this.readData(item);
          this.npmRows = Array.isArray(byId['npm-downloads']) ? byId['npm-downloads'] : [];
          this.npmMeta = byId['npm-meta'] || null;
          this.stars = byId['github-stars'] || null;
          this.contributors = byId['github-contributors'] || null;
        } catch (e) {
          this.error = e && e.message ? e.message : String(e);
        } finally {
          this.loading = false;
        }
      },
      launchRows() {
        return this.npmRows.filter((row) => row.date >= '2026-03-12');
      },
      sum(rows, key) {
        return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
      },
      fmt(value) {
        return Number(value || 0).toLocaleString();
      },
      chartPoints(rows, key, width, height) {
        if (!rows.length) return '';
        const max = Math.max(1, ...rows.map((row) => Number(row[key] || 0)));
        return rows.map((row, index) => {
          const x = rows.length === 1 ? 0 : (index / (rows.length - 1)) * width;
          const y = height - (Number(row[key] || 0) / max) * (height - 8) - 4;
          return x.toFixed(1) + ',' + y.toFixed(1);
        }).join(' ');
      },
      barHeight(value, rows, key) {
        const max = Math.max(1, ...rows.map((row) => Number(row[key] || 0)));
        return Math.max(3, Number(value || 0) / max * 120);
      },
      recentWeek(timeline) {
        return timeline && timeline.length ? timeline[timeline.length - 1] : null;
      },
      prevWeek(timeline) {
        return timeline && timeline.length > 1 ? timeline[timeline.length - 2] : null;
      },
      bestWeek(timeline, key) {
        return (timeline || []).reduce((best, row) => !best || Number(row[key] || 0) > Number(best[key] || 0) ? row : best, null);
      }
    }" x-init="init()" class="space-y-4">
      <p class="text-xs text-muted-foreground">npm downloads, GitHub stars, and contributor snapshots migrated from legacy Fusion data files.</p>
      <p x-show="loading" class="rounded border p-4 text-muted-foreground">Loading migrated product metrics...</p>
      <p x-show="error" x-text="error" class="rounded border border-red-300 bg-red-50 p-3 text-red-700"></p>

      <template x-if="!loading && !error">
        <div class="space-y-5">
          <section class="rounded-lg border bg-card p-5 space-y-4">
            <div><h2 class="text-base font-semibold">npm package downloads per week</h2><p class="mt-0.5 text-xs text-muted-foreground">@agent-native/core / daily grain / 7-day moving average</p></div>
            <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div class="rounded-lg border p-4"><div class="text-xs text-muted-foreground">Current 7-day avg / day</div><div class="mt-1 text-2xl font-bold" x-text="fmt(Math.round(launchRows().at(-1)?.ma7 || 0))"></div></div>
              <div class="rounded-lg border p-4"><div class="text-xs text-muted-foreground">Last 7 days</div><div class="mt-1 text-2xl font-bold" x-text="fmt(sum(launchRows().slice(-7), 'downloads'))"></div></div>
              <div class="rounded-lg border p-4"><div class="text-xs text-muted-foreground">Last 30 days</div><div class="mt-1 text-2xl font-bold" x-text="fmt(sum(launchRows().slice(-30), 'downloads'))"></div></div>
              <div class="rounded-lg border p-4"><div class="text-xs text-muted-foreground">All time</div><div class="mt-1 text-2xl font-bold" x-text="fmt(sum(npmRows, 'downloads'))"></div></div>
            </div>
            <svg viewBox="0 0 720 220" class="h-72 w-full rounded border bg-muted/20 p-2" preserveAspectRatio="none">
              <polyline :points="chartPoints(launchRows(), 'ma7', 700, 190)" fill="none" stroke="#4e9fea" stroke-width="3"></polyline>
            </svg>
            <div class="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground"><span>Source: npmjs.org downloads API / @agent-native/core</span><span x-show="npmMeta?.fetchedAt" x-text="'Last fetched: ' + new Date(npmMeta.fetchedAt).toLocaleString()"></span></div>
          </section>

          <section class="rounded-lg border bg-card p-5 space-y-4">
            <div><h2 class="text-base font-semibold">OSS contributors over time</h2><p class="mt-0.5 text-xs text-muted-foreground">BuilderIO/agent-native / weekly grain / cumulative total and new contributors</p></div>
            <template x-if="contributors">
              <div class="space-y-4">
                <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div class="rounded-lg border p-4"><div class="text-xs text-muted-foreground">Total contributors</div><div class="mt-1 text-2xl font-bold" x-text="fmt(contributors.totalContributors)"></div></div>
                  <div class="rounded-lg border p-4"><div class="text-xs text-muted-foreground">Total commits</div><div class="mt-1 text-2xl font-bold" x-text="fmt(contributors.totalCommits)"></div></div>
                  <div class="rounded-lg border p-4"><div class="text-xs text-muted-foreground">GitHub stars</div><div class="mt-1 text-2xl font-bold" x-text="fmt(contributors.stars)"></div></div>
                  <div class="rounded-lg border p-4"><div class="text-xs text-muted-foreground">Forks</div><div class="mt-1 text-2xl font-bold" x-text="fmt(contributors.forks)"></div></div>
                </div>
                <div class="flex h-36 items-end gap-1 rounded border bg-muted/20 p-3">
                  <template x-for="week in (contributors.timeline || [])" :key="week.week"><div class="flex-1 rounded-t bg-indigo-500" :title="week.week + ': ' + week.newContributors + ' new / ' + week.totalContributors + ' total'" :style="'height:' + barHeight(week.totalContributors, contributors.timeline || [], 'totalContributors') + 'px'"></div></template>
                </div>
                <div class="text-[11px] text-muted-foreground" x-text="'Source: GitHub REST API / ' + (contributors.repo || 'BuilderIO/agent-native')"></div>
              </div>
            </template>
          </section>

          <section class="rounded-lg border bg-card p-5 space-y-4">
            <div><h2 class="text-base font-semibold">GitHub stars over time</h2><p class="mt-0.5 text-xs text-muted-foreground">BuilderIO/agent-native / weekly grain / new stars and cumulative total</p></div>
            <template x-if="stars">
              <div class="space-y-4">
                <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div class="rounded-lg border p-4"><div class="text-xs text-muted-foreground">Total stars</div><div class="mt-1 text-2xl font-bold" x-text="fmt(stars.totalStars)"></div></div>
                  <div class="rounded-lg border p-4"><div class="text-xs text-muted-foreground">This week</div><div class="mt-1 text-2xl font-bold" x-text="fmt(recentWeek(stars.timeline)?.newStars || 0)"></div></div>
                  <div class="rounded-lg border p-4"><div class="text-xs text-muted-foreground">Last week</div><div class="mt-1 text-2xl font-bold" x-text="fmt(prevWeek(stars.timeline)?.newStars || 0)"></div></div>
                  <div class="rounded-lg border p-4"><div class="text-xs text-muted-foreground">Best week</div><div class="mt-1 text-2xl font-bold" x-text="bestWeek(stars.timeline, 'newStars') ? bestWeek(stars.timeline, 'newStars').newStars : 0"></div></div>
                </div>
                <div class="flex h-36 items-end gap-1 rounded border bg-muted/20 p-3">
                  <template x-for="week in (stars.timeline || [])" :key="week.week"><div class="flex-1 rounded-t bg-amber-400" :title="week.week + ': ' + week.newStars + ' new / ' + week.totalStars + ' total'" :style="'height:' + barHeight(week.newStars, stars.timeline || [], 'newStars') + 'px'"></div></template>
                </div>
                <svg viewBox="0 0 720 120" class="h-28 w-full rounded border bg-muted/20 p-2" preserveAspectRatio="none">
                  <polyline :points="chartPoints(stars.timeline || [], 'totalStars', 700, 95)" fill="none" stroke="#4e9fea" stroke-width="3"></polyline>
                </svg>
                <div class="text-[11px] text-muted-foreground" x-text="'Source: GitHub REST API / ' + (stars.repo || 'BuilderIO/agent-native')"></div>
              </div>
            </template>
          </section>
        </div>
      </template>
    </div>`,
  );
}

export function explorerExtension(): string {
  return baseExtension(
    "Explorer",
    String.raw`<div x-data="{
      loading: false,
      error: '',
      result: null,
      currentId: '',
      saveName: '',
      saved: [],
      config: { name: 'Untitled Explorer', events: [{ event: '', label: '', filters: [], groupBy: [] }], chartType: 'line', dateRange: '30d', customDateStart: '', customDateEnd: '' },
      knownEvents: ['signup', 'login', 'pageView', 'content saved', 'content published', 'fusion chat message submitted', 'fusion chat accepted', 'fusion chat rejected', 'fusion chat started', 'generate', 'import figma', 'import code', 'drag and drop', 'open visual editor', 'preview', 'integration installed', 'subscription created', 'checkout started', 'plan selected', 'invite sent', 'invite accepted', 'comment added'],
      properties: ['userId', 'organizationId', 'sessionId', 'email', 'userEmail', 'event', 'name', 'type', 'kind', 'message', 'action', 'category', 'label', 'browser', 'url', 'device', 'os', 'platform', 'modelName', 'modelId', 'contentId', 'contentName', 'utmSource', 'utmMedium', 'utmCampaign', 'option', 'plan', 'tier', 'source', 'target', 'framework', 'sdk', 'model', 'provider', 'accepted', 'rejected', 'subscription_plan', 'subscription_status', 'org_subscription', 'org_name', 'org_kind', 'org_company_size', 'org_is_trial', 'user_email_domain', 'user_intent', 'user_use_case', 'user_auth_provider', 'user_has_enterprise'],
      operators: ['=', '!=', 'contains', 'not_contains', 'is_set', 'is_not_set'],
      readData(item) {
        let value = item ? item.data : null;
        if (typeof value === 'string') {
          try { value = JSON.parse(value); } catch (e) {}
        }
        if (value && value.value !== undefined) return value.value;
        if (value && value.data && value.data.value !== undefined) return value.data.value;
        if (value && value.data !== undefined) return value.data;
        return value;
      },
      async init() {
        await this.loadSaved();
      },
      async loadSaved() {
        try {
          const rows = await extensionData.list('explorer-history', { scope: 'org' });
          this.saved = rows.map((row) => ({ id: row.itemId || row.id, data: this.readData(row) })).filter((row) => row.id !== '_autosave');
        } catch (e) {
          this.saved = [];
        }
      },
      addEvent() {
        this.config.events.push({ event: '', label: '', filters: [], groupBy: [] });
      },
      removeEvent(index) {
        this.config.events.splice(index, 1);
        if (!this.config.events.length) this.addEvent();
      },
      addFilter(event) {
        event.filters.push({ property: 'organizationId', operator: '=', value: '' });
      },
      removeFilter(event, index) {
        event.filters.splice(index, 1);
      },
      addGroup(event) {
        event.groupBy.push('organizationId');
      },
      removeGroup(event, index) {
        event.groupBy.splice(index, 1);
      },
      dateClause() {
        const q = this.quote();
        if (this.config.dateRange === 'custom' && this.config.customDateStart && this.config.customDateEnd) return 'createdDate >= TIMESTAMP(' + q + this.config.customDateStart + q + ') AND createdDate <= TIMESTAMP(' + q + this.config.customDateEnd + q + ')';
        const days = this.config.dateRange === '7d' ? 7 : this.config.dateRange === '14d' ? 14 : this.config.dateRange === '90d' ? 90 : 30;
        return 'createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ' + days + ' DAY) AND createdDate <= CURRENT_TIMESTAMP()';
      },
      quote() {
        return String.fromCharCode(39);
      },
      columnRef(property, alias) {
        const enriched = {
          subscription_plan: 'sub.plan',
          subscription_status: 'sub.status',
          org_subscription: 'org.subscription',
          org_name: 'org.organization_name',
          org_kind: 'org.kind',
          org_company_size: 'org.company_size',
          org_is_trial: 'CAST(org.is_trial AS STRING)',
          user_email_domain: 'usr.email_domain',
          user_intent: 'usr.intent',
          user_use_case: 'usr.use_case',
          user_auth_provider: 'usr.auth_provider',
          user_has_enterprise: 'CAST(usr.has_enterprise_subscription AS STRING)'
        };
        if (enriched[property]) return enriched[property];
        const top = ['event', 'name', 'url', 'type', 'kind', 'userId', 'organizationId', 'sessionId', 'browser', 'modelName', 'modelId', 'message'];
        const prefix = alias ? alias + '.' : '';
        const q = this.quote();
        return top.includes(property) ? prefix + property : 'JSON_VALUE(' + prefix + 'data, ' + q + '$.' + property + q + ')';
      },
      escapeSql(value) {
        return String(value || '').split(this.quote()).join('\\\\' + this.quote());
      },
      filterSql(filter, alias) {
        const col = this.columnRef(filter.property, alias);
        const q = this.quote();
        if (filter.operator === '=') return col + ' = ' + q + this.escapeSql(filter.value) + q;
        if (filter.operator === '!=') return col + ' != ' + q + this.escapeSql(filter.value) + q;
        if (filter.operator === 'contains') return col + ' LIKE ' + q + '%' + this.escapeSql(filter.value) + '%' + q;
        if (filter.operator === 'not_contains') return col + ' NOT LIKE ' + q + '%' + this.escapeSql(filter.value) + '%' + q;
        if (filter.operator === 'is_set') return col + ' IS NOT NULL AND ' + col + ' != ' + q + q;
        return '(' + col + ' IS NULL OR ' + col + ' = ' + q + q + ')';
      },
      needsJoin(event) {
        const props = event.filters.map((f) => f.property).concat(event.groupBy || []);
        return props.some((p) => ['subscription_plan', 'subscription_status', 'org_subscription', 'org_name', 'org_kind', 'org_company_size', 'org_is_trial', 'user_email_domain', 'user_intent', 'user_use_case', 'user_auth_provider', 'user_has_enterprise'].includes(p));
      },
      joinSql(event) {
        const props = event.filters.map((f) => f.property).concat(event.groupBy || []);
        const joins = [];
        if (props.some((p) => p.startsWith('subscription_'))) joins.push('LEFT JOIN builder-3b0a2.dbt_mart.dim_subscriptions sub ON e.organizationId = sub.space_id');
        if (props.some((p) => p.startsWith('org_'))) joins.push('LEFT JOIN builder-3b0a2.dbt_mart.dim_organizations org ON e.organizationId = org.org_id');
        if (props.some((p) => p.startsWith('user_'))) joins.push('LEFT JOIN builder-3b0a2.dbt_mart.dim_users usr ON e.userId = usr.user_id');
        return joins;
      },
      buildSingle(event, labelPrefix) {
        if (!event.event) return '';
        const hasJoin = this.needsJoin(event);
        const alias = hasJoin ? 'e' : '';
        const dateCol = alias ? alias + '.createdDate' : 'createdDate';
        const dateClause = this.dateClause().replaceAll('createdDate', dateCol);
        const isTime = this.config.chartType === 'line' || this.config.chartType === 'bar';
        const isMetric = this.config.chartType === 'metric';
        const select = [];
        const group = [];
        const q = this.quote();
        if (labelPrefix) {
          select.push(q + this.escapeSql(event.label || event.event) + q + ' AS event_label');
          group.push('event_label');
        }
        if (isTime) {
          select.push('DATE(' + dateCol + ') AS date');
          group.push('date');
        }
        for (const g of event.groupBy || []) {
          const aliasName = g.replace(/[^a-zA-Z0-9_]/g, '_');
          select.push(this.columnRef(g, alias) + ' AS ' + aliasName);
          group.push(aliasName);
        }
        select.push('COUNT(*) AS count');
        const where = [dateClause, (alias ? alias + '.' : '') + 'event = ' + q + this.escapeSql(event.event) + q].concat((event.filters || []).map((f) => this.filterSql(f, alias))).join(' AND ');
        const sql = ['SELECT ' + select.join(', '), 'FROM builder-3b0a2.analytics.events_partitioned' + (alias ? ' ' + alias : '')].concat(this.joinSql(event)).concat(['WHERE ' + where]);
        if (group.length) sql.push('GROUP BY ' + group.join(', '));
        if (isTime) sql.push('ORDER BY date');
        else if (!isMetric) sql.push('ORDER BY count DESC\\nLIMIT 100');
        return sql.join('\\n');
      },
      sql() {
        const events = this.config.events.filter((event) => event.event);
        if (!events.length) return '';
        if (events.length === 1) return this.buildSingle(events[0], false);
        return events.map((event) => this.buildSingle(event, true)).join('\\nUNION ALL\\n') + (this.config.chartType === 'line' || this.config.chartType === 'bar' ? '\\nORDER BY date' : '\\nORDER BY count DESC\\nLIMIT 100');
      },
      async run() {
        const sql = this.sql();
        if (!sql) return;
        this.loading = true;
        this.error = '';
        try {
          this.result = await appAction('bigquery', { sql });
          await extensionData.set('explorer-history', '_autosave', { name: this.config.name, config: this.config, sql, result: this.result, updatedAt: new Date().toISOString() }, { scope: 'org' });
        } catch (e) {
          this.error = e && e.message ? e.message : String(e);
        } finally {
          this.loading = false;
        }
      },
      async save() {
        const name = (this.saveName || this.config.name || 'Untitled Explorer').trim();
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';
        this.config.name = name;
        await extensionData.set('explorer-history', id, { name, config: this.config, sql: this.sql(), updatedAt: new Date().toISOString() }, { scope: 'org' });
        this.currentId = id;
        this.saveName = '';
        await this.loadSaved();
      },
      loadConfig(entry) {
        this.config = JSON.parse(JSON.stringify(entry.data.config));
        this.currentId = entry.id;
      },
      rows() {
        return this.result?.rows || this.result?.data?.rows || (Array.isArray(this.result) ? this.result : []);
      },
      columns() {
        const row = this.rows()[0] || {};
        return Object.keys(row);
      },
      maxCount() {
        return Math.max(1, ...this.rows().map((row) => Number(row.count || 0)));
      }
    }" x-init="init()" class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div><h2 class="text-lg font-semibold">Explorer</h2><p class="text-xs text-muted-foreground">Event, date, group, filter, SQL preview, BigQuery action, and saved history UI.</p></div>
        <div class="flex flex-wrap items-center gap-2">
          <input class="h-8 rounded border px-2 text-xs" placeholder="Dashboard name" x-model="saveName" />
          <button class="h-8 rounded border px-3 text-xs" type="button" x-on:click="save()">Save</button>
          <select class="h-8 rounded border px-2 text-xs" x-on:change="const found = saved.find((s) => s.id === $event.target.value); if (found) loadConfig(found)"><option value="">Load...</option><template x-for="entry in saved" :key="entry.id"><option :value="entry.id" x-text="entry.data.name || entry.id"></option></template></select>
        </div>
      </div>

      <section class="rounded-lg border bg-card p-4 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <span class="text-sm text-muted-foreground">Chart Type</span>
            <div class="flex rounded-md border p-0.5">
              <template x-for="type in ['line', 'bar', 'table', 'metric']" :key="type"><button type="button" class="h-7 px-2 text-xs capitalize" :class="config.chartType === type ? 'rounded bg-accent text-accent-foreground' : 'text-muted-foreground'" x-on:click="config.chartType = type" x-text="type"></button></template>
            </div>
          </div>
          <div class="flex items-center gap-1 rounded-md border p-0.5">
            <template x-for="range in ['7d', '14d', '30d', '90d', 'custom']" :key="range"><button type="button" class="h-7 px-2 text-xs uppercase" :class="config.dateRange === range ? 'rounded bg-accent text-accent-foreground' : 'text-muted-foreground'" x-on:click="config.dateRange = range" x-text="range"></button></template>
          </div>
        </div>
        <div x-show="config.dateRange === 'custom'" class="flex flex-wrap gap-2">
          <input type="date" class="rounded border px-2 py-1 text-xs" x-model="config.customDateStart" />
          <input type="date" class="rounded border px-2 py-1 text-xs" x-model="config.customDateEnd" />
        </div>

        <div class="space-y-3">
          <div class="text-sm font-medium text-muted-foreground">Events</div>
          <template x-for="(event, eventIndex) in config.events" :key="eventIndex">
            <div class="rounded-lg border bg-background p-3 space-y-2">
              <div class="flex items-center gap-2">
                <select class="min-w-0 flex-1 rounded border px-2 py-1.5 text-sm" x-model="event.event"><option value="">Select event...</option><template x-for="known in knownEvents" :key="known"><option :value="known" x-text="known"></option></template></select>
                <input class="w-40 rounded border px-2 py-1.5 text-sm" placeholder="Label" x-model="event.label" />
                <button type="button" class="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted" x-on:click="removeEvent(eventIndex)">Remove</button>
              </div>

              <div class="space-y-1 pl-3">
                <template x-for="(filter, filterIndex) in event.filters" :key="filterIndex">
                  <div class="flex flex-wrap items-center gap-1.5 text-sm">
                    <span class="text-xs text-muted-foreground">&gt;</span>
                    <select class="rounded border px-2 py-1 text-xs" x-model="filter.property"><template x-for="property in properties" :key="property"><option :value="property" x-text="property"></option></template></select>
                    <select class="rounded border px-2 py-1 text-xs" x-model="filter.operator"><template x-for="op in operators" :key="op"><option :value="op" x-text="op"></option></template></select>
                    <input x-show="!['is_set', 'is_not_set'].includes(filter.operator)" class="rounded border px-2 py-1 text-xs" placeholder="value" x-model="filter.value" />
                    <button type="button" class="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted" x-on:click="removeFilter(event, filterIndex)">Remove</button>
                  </div>
                </template>
                <button type="button" class="text-xs text-muted-foreground hover:text-foreground" x-on:click="addFilter(event)">Filter by</button>
              </div>

              <div class="space-y-1 pl-3">
                <template x-for="(group, groupIndex) in event.groupBy" :key="groupIndex">
                  <div class="flex flex-wrap items-center gap-1.5 text-sm">
                    <span class="text-xs text-muted-foreground">group</span>
                    <select class="rounded border px-2 py-1 text-xs" x-model="event.groupBy[groupIndex]"><template x-for="property in properties" :key="property"><option :value="property" x-text="property"></option></template></select>
                    <button type="button" class="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted" x-on:click="removeGroup(event, groupIndex)">Remove</button>
                  </div>
                </template>
                <button type="button" class="text-xs text-muted-foreground hover:text-foreground" x-on:click="addGroup(event)">Group by</button>
              </div>
            </div>
          </template>
          <button class="w-full rounded border px-3 py-2 text-sm text-muted-foreground hover:bg-muted" type="button" x-on:click="addEvent()">Add Event</button>
        </div>
      </section>

      <div class="flex items-center gap-2">
        <button class="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" type="button" x-on:click="run()" :disabled="loading || !sql()">Run BigQuery</button>
        <span x-show="loading" class="text-xs text-muted-foreground">Running...</span>
        <span x-show="error" class="text-xs text-red-600" x-text="error"></span>
      </div>

      <section class="rounded-lg border">
        <button type="button" class="w-full px-3 py-2 text-left text-sm text-muted-foreground hover:text-foreground" x-on:click="$refs.sql.classList.toggle('hidden')">SQL Query</button>
        <pre x-ref="sql" class="hidden max-h-80 overflow-auto border-t bg-muted/50 p-3 text-xs" x-text="sql()"></pre>
      </section>

      <section class="rounded-lg border bg-card p-4">
        <template x-if="!rows().length"><div class="flex h-48 items-center justify-center text-sm text-muted-foreground">Run a query to see results</div></template>
        <template x-if="rows().length && config.chartType === 'metric'">
          <div class="grid grid-cols-2 gap-4 md:grid-cols-4"><template x-for="row in rows()" :key="JSON.stringify(row)"><div class="rounded-lg border p-4"><div class="text-sm text-muted-foreground" x-text="row.event_label || config.events[0]?.event || 'Count'"></div><div class="mt-1 text-2xl font-bold" x-text="Number(row.count || 0).toLocaleString()"></div></div></template></div>
        </template>
        <template x-if="rows().length && (config.chartType === 'line' || config.chartType === 'bar')">
          <div class="space-y-2"><template x-for="row in rows().slice(0, 40)" :key="JSON.stringify(row)"><div class="grid grid-cols-[140px_1fr_60px] items-center gap-2 text-xs"><span class="truncate" x-text="row.date?.value || row.date || row.event_label || row[columns()[0]]"></span><div class="h-2 rounded bg-muted"><div class="h-2 rounded bg-blue-500" :style="'width:' + (Number(row.count || 0) / maxCount() * 100) + '%'"></div></div><span class="text-right tabular-nums" x-text="Number(row.count || 0).toLocaleString()"></span></div></template></div>
        </template>
        <template x-if="rows().length && config.chartType === 'table'">
          <div class="max-h-[500px] overflow-auto"><table class="w-full text-sm"><thead class="sticky top-0 bg-muted"><tr><template x-for="column in columns()" :key="column"><th class="px-3 py-2 text-left text-xs text-muted-foreground" x-text="column"></th></template></tr></thead><tbody><template x-for="(row, i) in rows().slice(0, 100)" :key="i"><tr class="border-t"><template x-for="column in columns()" :key="column"><td class="px-3 py-1.5" x-text="typeof row[column] === 'object' && row[column] !== null && 'value' in row[column] ? row[column].value : row[column]"></td></template></tr></template></tbody></table></div>
        </template>
      </section>
    </div>`,
  );
}
