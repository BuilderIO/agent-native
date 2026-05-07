function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function baseExtension(title: string, body: string): string {
  return `<div class="min-h-screen bg-background text-foreground">
  <div class="mx-auto max-w-7xl space-y-4 p-4 text-sm">
    <div class="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
      <div>
        <h1 class="text-lg font-semibold tracking-tight">${escapeHtml(title)}</h1>
      </div>
    </div>
    ${body}
  </div>
</div>`;
}

export function customerHealthExtension(): string {
  return baseExtension(
    "Customer Health",
    `<script>
function customerHealthApp() {
  return {
    company: 'Intuit',
    companyInput: 'Intuit',
    dateStart: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10),
    dateEnd: new Date().toISOString().slice(0, 10),
    loading: false,
    searching: false,
    error: '',
    searchResults: [],
    summary: {},
    activity: [],
    topUsers: [],
    subscriptions: [],
    tickets: [],
    calls: [],
    sqlEscape(value) {
      return String(value || '').replace(/'/g, "\\\\'");
    },
    money(value) {
      const n = Number(value || 0);
      if (!n) return '$0';
      if (Math.abs(n) >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'm';
      if (Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(1) + 'k';
      return '$' + Math.round(n).toLocaleString();
    },
    num(value) {
      return Number(value || 0).toLocaleString();
    },
    date(value) {
      if (!value) return '-';
      return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    },
    planLabel(value) {
      const plans = String(value || '').split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
      if (!plans.length) return '-';
      if (plans.includes('enterprise')) return 'Enterprise';
      return Array.from(new Set(plans)).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(', ');
    },
    companyOrgsCte(company) {
      const escaped = this.sqlEscape(company).toLowerCase();
      return [
        'SELECT DISTINCT s.root_organization_id',
        'FROM \`builder-3b0a2.dbt_staging_bigquery.signups\` s',
        'JOIN \`builder-3b0a2.dbt_mart.dim_hs_contacts\` c ON c.builder_user_id = s.user_id',
        "WHERE LOWER(c.company) LIKE '%" + escaped + "%'",
        "  AND s.root_organization_id IS NOT NULL AND s.root_organization_id != ''"
      ].join('\\n');
    },
    searchSql() {
      const q = this.sqlEscape(this.companyInput).toLowerCase();
      return [
        'SELECT DISTINCT c.company, COUNT(DISTINCT c.builder_user_id) AS user_count',
        'FROM \`builder-3b0a2.dbt_mart.dim_hs_contacts\` c',
        "WHERE LOWER(c.company) LIKE '%" + q + "%'",
        "  AND c.company IS NOT NULL AND c.company != ''",
        '  AND c.builder_user_id IS NOT NULL',
        'GROUP BY c.company',
        'ORDER BY user_count DESC',
        'LIMIT 20'
      ].join('\\n');
    },
    summarySql() {
      const company = this.sqlEscape(this.company).toLowerCase();
      const orgs = this.companyOrgsCte(this.company);
      return [
        'WITH company_orgs AS (' + orgs + ')',
        'SELECT',
        '  (SELECT COUNT(DISTINCT c.builder_user_id) FROM \`builder-3b0a2.dbt_mart.dim_hs_contacts\` c WHERE LOWER(c.company) LIKE \\'%' + company + '%\\' AND c.builder_user_id IS NOT NULL) AS total_users,',
        "  (SELECT COUNT(DISTINCT space_id) FROM \`builder-3b0a2.dbt_mart.dim_subscriptions\` WHERE root_id IN (SELECT root_organization_id FROM company_orgs) AND status = 'active') AS active_spaces,",
        "  (SELECT COALESCE(SUM(subscription_arr), 0) FROM \`builder-3b0a2.dbt_mart.dim_subscriptions\` WHERE root_id IN (SELECT root_organization_id FROM company_orgs) AND status = 'active') AS total_arr,",
        "  (SELECT STRING_AGG(DISTINCT plan, ', ') FROM \`builder-3b0a2.dbt_mart.dim_subscriptions\` WHERE root_id IN (SELECT root_organization_id FROM company_orgs) AND status = 'active') AS plans,",
        '  (SELECT upcoming_renewal_date FROM \`builder-3b0a2.dbt_staging.hubspot_companies\` hc WHERE LOWER(hc.company_name) LIKE \\'%' + company + '%\\' AND hc.upcoming_renewal_date IS NOT NULL ORDER BY hc.upcoming_renewal_date ASC LIMIT 1) AS upcoming_renewal_date,',
        '  (SELECT hs_csm_sentiment FROM \`builder-3b0a2.dbt_staging.hubspot_companies\` hc WHERE LOWER(hc.company_name) LIKE \\'%' + company + '%\\' LIMIT 1) AS health_status,',
        '  (SELECT company_owner_name FROM \`builder-3b0a2.dbt_staging.hubspot_companies\` hc WHERE LOWER(hc.company_name) LIKE \\'%' + company + '%\\' LIMIT 1) AS company_owner_name'
      ].join('\\n');
    },
    fusion30dSql() {
      return [
        'WITH company_orgs AS (' + this.companyOrgsCte(this.company) + ')',
        'SELECT COUNT(*) AS total_messages, COUNT(DISTINCT user_id) AS unique_users',
        'FROM \`builder-3b0a2.amplitude.EVENTS_182198\`',
        "WHERE event_type = 'fusion chat message submitted'",
        '  AND DATE(event_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)',
        '  AND JSON_VALUE(event_properties, \\'$.rootOrganizationId\\') IN (SELECT root_organization_id FROM company_orgs)',
        "  AND COALESCE(JSON_VALUE(user_properties, '$.email'), '') NOT LIKE '%@builder.io'"
      ].join('\\n');
    },
    activitySql() {
      return [
        'WITH company_orgs AS (' + this.companyOrgsCte(this.company) + ')',
        'SELECT DATE(event_time) AS period, COUNT(*) AS messages, COUNT(DISTINCT user_id) AS unique_users',
        'FROM \`builder-3b0a2.amplitude.EVENTS_182198\`',
        "WHERE event_type = 'fusion chat message submitted'",
        "  AND DATE(event_time) BETWEEN '" + this.dateStart + "' AND '" + this.dateEnd + "'",
        '  AND JSON_VALUE(event_properties, \\'$.rootOrganizationId\\') IN (SELECT root_organization_id FROM company_orgs)',
        "  AND COALESCE(JSON_VALUE(user_properties, '$.email'), '') NOT LIKE '%@builder.io'",
        'GROUP BY period',
        'ORDER BY period'
      ].join('\\n');
    },
    topUsersSql() {
      return [
        'WITH company_orgs AS (' + this.companyOrgsCte(this.company) + ')',
        "SELECT COALESCE(JSON_VALUE(user_properties, '$.email'), user_id) AS email,",
        '  COUNT(*) AS messages, COUNT(DISTINCT DATE(event_time)) AS active_days,',
        '  MIN(DATE(event_time)) AS first_message, MAX(DATE(event_time)) AS last_message',
        'FROM \`builder-3b0a2.amplitude.EVENTS_182198\`',
        "WHERE event_type = 'fusion chat message submitted'",
        "  AND DATE(event_time) BETWEEN '" + this.dateStart + "' AND '" + this.dateEnd + "'",
        '  AND JSON_VALUE(event_properties, \\'$.rootOrganizationId\\') IN (SELECT root_organization_id FROM company_orgs)',
        "  AND COALESCE(JSON_VALUE(user_properties, '$.email'), '') NOT LIKE '%@builder.io'",
        'GROUP BY email',
        'ORDER BY messages DESC',
        'LIMIT 50'
      ].join('\\n');
    },
    subscriptionsSql() {
      return [
        'WITH company_orgs AS (' + this.companyOrgsCte(this.company) + ')',
        'SELECT root_id, space_id, plan, status, subscription_arr, start_date',
        'FROM \`builder-3b0a2.dbt_mart.dim_subscriptions\`',
        'WHERE root_id IN (SELECT root_organization_id FROM company_orgs)',
        'ORDER BY status ASC, start_date DESC'
      ].join('\\n');
    },
    async runBigQuery(sql) {
      const result = await appAction('bigquery', { sql });
      return result.rows || result.data?.rows || [];
    },
    async searchCompanies() {
      if (this.companyInput.trim().length < 2) return;
      this.searching = true;
      this.error = '';
      try {
        this.searchResults = await this.runBigQuery(this.searchSql());
      } catch (e) {
        this.error = e.message || String(e);
      } finally {
        this.searching = false;
      }
    },
    async selectCompany(name) {
      this.company = name;
      this.companyInput = name;
      this.searchResults = [];
      await this.load();
    },
    async load() {
      if (!this.company) return;
      this.loading = true;
      this.error = '';
      try {
        const results = await Promise.allSettled([
          this.runBigQuery(this.summarySql()),
          this.runBigQuery(this.fusion30dSql()),
          this.runBigQuery(this.activitySql()),
          this.runBigQuery(this.topUsersSql()),
          this.runBigQuery(this.subscriptionsSql()),
          appAction('pylon-issues', { account: this.company }),
          appAction('gong-calls', { company: this.company, days: 90 })
        ]);
        const value = (i, fallback) => results[i].status === 'fulfilled' ? results[i].value : fallback;
        this.summary = Object.assign({}, value(0, [])[0] || {}, value(1, [])[0] || {});
        this.activity = value(2, []);
        this.topUsers = value(3, []);
        this.subscriptions = value(4, []);
        const pylon = value(5, {});
        const gong = value(6, {});
        this.tickets = pylon.issues || [];
        this.calls = (gong.calls || []).slice().sort((a, b) => new Date(b.started || b.startTime || 0) - new Date(a.started || a.startTime || 0));
        for (const r of results) if (r.status === 'rejected' && !this.error) this.error = r.reason?.message || String(r.reason);
      } finally {
        this.loading = false;
      }
    },
    maxActivity(key) {
      return Math.max(1, ...this.activity.map((r) => Number(r[key] || 0)));
    }
  };
}
</script>
<div x-data="customerHealthApp()" x-init="load()" class="space-y-4">
  <div class="rounded-lg border border-border bg-card p-4">
    <div class="grid gap-3 md:grid-cols-[minmax(260px,1fr)_160px_160px_auto] md:items-end">
      <label class="space-y-1">
        <span class="text-xs font-medium text-muted-foreground">Company</span>
        <input x-model="companyInput" x-on:keydown.enter="searchCompanies()" class="w-full rounded-md border border-input bg-background px-3 py-2" placeholder="Search by company name" />
      </label>
      <label class="space-y-1">
        <span class="text-xs font-medium text-muted-foreground">From</span>
        <input type="date" x-model="dateStart" class="w-full rounded-md border border-input bg-background px-3 py-2" />
      </label>
      <label class="space-y-1">
        <span class="text-xs font-medium text-muted-foreground">To</span>
        <input type="date" x-model="dateEnd" class="w-full rounded-md border border-input bg-background px-3 py-2" />
      </label>
      <div class="flex gap-2">
        <button class="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted" x-on:click="searchCompanies()" x-text="searching ? 'Searching' : 'Search'"></button>
        <button class="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground" x-on:click="company = companyInput; load()" x-text="loading ? 'Loading' : 'Load'"></button>
      </div>
    </div>
    <div x-show="searchResults.length" class="mt-3 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
      <template x-for="row in searchResults" :key="row.company">
        <button class="rounded-md border border-border px-3 py-2 text-left hover:bg-muted" x-on:click="selectCompany(row.company)">
          <span class="block truncate font-medium" x-text="row.company"></span>
          <span class="text-xs text-muted-foreground" x-text="num(row.user_count) + ' users'"></span>
        </button>
      </template>
    </div>
    <p x-show="error" class="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700" x-text="error"></p>
  </div>

  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
    <template x-for="card in [
      { label: 'Total Users', value: num(summary.total_users) },
      { label: 'Active Spaces', value: num(summary.active_spaces) },
      { label: 'ARR', value: money(summary.total_arr) },
      { label: 'Plan', value: planLabel(summary.plans) },
      { label: 'Next Renewal', value: date(summary.upcoming_renewal_date) },
      { label: 'Fusion Messages 30d', value: num(summary.total_messages) },
      { label: 'Fusion Active Users 30d', value: num(summary.unique_users) }
    ]" :key="card.label">
      <div class="rounded-lg border border-border bg-card p-3">
        <p class="text-[11px] font-medium uppercase text-muted-foreground" x-text="card.label"></p>
        <p class="mt-2 truncate text-xl font-semibold tabular-nums" x-text="loading ? '...' : card.value"></p>
      </div>
    </template>
  </div>

  <section class="rounded-lg border border-border bg-card p-4">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="font-medium">Fusion Activity</h2>
      <span class="text-xs text-muted-foreground" x-text="activity.length + ' days'"></span>
    </div>
    <div class="grid gap-3 lg:grid-cols-2">
      <div>
        <p class="mb-2 text-xs text-muted-foreground">Daily chat messages submitted</p>
        <div class="flex h-44 items-end gap-1 border-b border-l border-border p-2">
          <template x-for="row in activity" :key="'m-' + row.period">
            <div class="min-w-[6px] flex-1 rounded-t bg-sky-500" :style="'height:' + Math.max(2, Number(row.messages || 0) / maxActivity('messages') * 100) + '%'" :title="row.period + ': ' + row.messages"></div>
          </template>
        </div>
      </div>
      <div>
        <p class="mb-2 text-xs text-muted-foreground">Daily unique users sending messages</p>
        <div class="flex h-44 items-end gap-1 border-b border-l border-border p-2">
          <template x-for="row in activity" :key="'u-' + row.period">
            <div class="min-w-[6px] flex-1 rounded-t bg-violet-500" :style="'height:' + Math.max(2, Number(row.unique_users || 0) / maxActivity('unique_users') * 100) + '%'" :title="row.period + ': ' + row.unique_users"></div>
          </template>
        </div>
      </div>
    </div>
  </section>

  <div class="grid gap-4 lg:grid-cols-2">
    <section class="rounded-lg border border-border bg-card p-4">
      <h2 class="mb-1 font-medium">Top Fusion Users</h2>
      <p class="mb-3 text-xs text-muted-foreground">Ranked by message count, excluding @builder.io.</p>
      <div class="max-h-80 overflow-auto">
        <table class="w-full text-xs">
          <thead class="sticky top-0 bg-card"><tr class="border-b border-border"><th class="py-2 text-left">Email</th><th class="py-2 text-right">Messages</th><th class="py-2 text-right">Active Days</th><th class="py-2 text-left">Last Active</th></tr></thead>
          <tbody>
            <template x-for="row in topUsers" :key="row.email">
              <tr class="border-b border-border/50"><td class="max-w-[220px] truncate py-1.5" x-text="row.email"></td><td class="py-1.5 text-right tabular-nums" x-text="num(row.messages)"></td><td class="py-1.5 text-right tabular-nums" x-text="num(row.active_days)"></td><td class="py-1.5" x-text="date(row.last_message)"></td></tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>
    <section class="rounded-lg border border-border bg-card p-4">
      <h2 class="mb-1 font-medium">Subscriptions and Spaces</h2>
      <p class="mb-3 text-xs text-muted-foreground">All spaces and subscription details.</p>
      <div class="max-h-80 overflow-auto">
        <table class="w-full text-xs">
          <thead class="sticky top-0 bg-card"><tr class="border-b border-border"><th class="py-2 text-left">Plan</th><th class="py-2 text-left">Status</th><th class="py-2 text-right">ARR</th><th class="py-2 text-left">Start</th><th class="py-2 text-left">Space</th></tr></thead>
          <tbody>
            <template x-for="row in subscriptions" :key="row.space_id">
              <tr class="border-b border-border/50"><td class="py-1.5" x-text="row.plan || '-'"></td><td class="py-1.5"><span class="rounded-full bg-muted px-2 py-0.5" x-text="row.status || '-'"></span></td><td class="py-1.5 text-right tabular-nums" x-text="money(row.subscription_arr)"></td><td class="py-1.5" x-text="date(row.start_date)"></td><td class="max-w-[150px] truncate py-1.5 font-mono text-[10px]" x-text="row.space_id || '-'"></td></tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>
    <section class="rounded-lg border border-border bg-card p-4">
      <h2 class="mb-1 font-medium">Support Tickets (Pylon)</h2>
      <p class="mb-3 text-xs text-muted-foreground" x-text="tickets.filter((i) => String(i.state || '').toLowerCase() !== 'closed').length + ' open / ' + tickets.length + ' total'"></p>
      <div class="max-h-80 overflow-auto">
        <table class="w-full text-xs">
          <thead class="sticky top-0 bg-card"><tr class="border-b border-border"><th class="py-2 text-left">Title</th><th class="py-2 text-left">State</th><th class="py-2 text-left">Priority</th><th class="py-2 text-left">Updated</th></tr></thead>
          <tbody>
            <template x-for="issue in tickets.slice(0, 50)" :key="issue.id">
              <tr class="border-b border-border/50"><td class="max-w-[260px] truncate py-1.5" x-text="issue.title || issue.name || '-'"></td><td class="py-1.5" x-text="issue.state || '-'"></td><td class="py-1.5" x-text="issue.priority || '-'"></td><td class="py-1.5" x-text="date(issue.updated_at || issue.updatedAt)"></td></tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>
    <section class="rounded-lg border border-border bg-card p-4">
      <h2 class="mb-1 font-medium">Recent Calls (Gong)</h2>
      <p class="mb-3 text-xs text-muted-foreground" x-text="calls.length + ' calls in last 90d'"></p>
      <div class="max-h-80 overflow-auto">
        <table class="w-full text-xs">
          <thead class="sticky top-0 bg-card"><tr class="border-b border-border"><th class="py-2 text-left">Title</th><th class="py-2 text-left">Date</th><th class="py-2 text-right">Duration</th></tr></thead>
          <tbody>
            <template x-for="call in calls.slice(0, 50)" :key="call.id">
              <tr class="border-b border-border/50"><td class="max-w-[320px] truncate py-1.5" x-text="call.title || 'Untitled'"></td><td class="py-1.5" x-text="date(call.started || call.startTime)"></td><td class="py-1.5 text-right tabular-nums" x-text="call.duration ? Math.round(call.duration / 60) + 'm' : '-'"></td></tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</div>`,
  );
}

export function riskMeetingExtension(): string {
  return baseExtension(
    "Risk Meeting",
    `<script>
function riskMeetingApp() {
  return {
    view: 'hubspot',
    loading: false,
    error: '',
    statusFilter: 'All',
    csmFilter: 'All',
    pylonCsmFilter: 'All',
    sortDir: 'desc',
    selectedHubspotId: null,
    selectedPylonId: null,
    deals: [],
    pylonOnlyDeals: [],
    statuses: ['All', 'Confirmed Churn', 'Churn Risk', 'On the Radar', 'No Save Attempted'],
    async init() {
      await this.load();
    },
    money(value) {
      const n = Number(value || 0);
      if (!n) return '-';
      if (Math.abs(n) >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'm';
      if (Math.abs(n) >= 1000) return '$' + Math.round(n / 1000).toLocaleString() + 'k';
      return '$' + Math.round(n).toLocaleString();
    },
    date(value) {
      if (!value) return '-';
      return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    },
    statusClass(status) {
      if (status === 'Confirmed Churn') return 'border-red-500 text-red-700 bg-red-500/10';
      if (status === 'Churn Risk') return 'border-orange-500 text-orange-700 bg-orange-500/10';
      if (status === 'On the Radar') return 'border-yellow-500 text-yellow-700 bg-yellow-500/10';
      return 'border-muted text-muted-foreground bg-muted';
    },
    sentimentClass(sentiment) {
      if (sentiment === 'positive') return 'bg-emerald-500/10 text-emerald-700';
      if (sentiment === 'frustrated') return 'bg-orange-500/10 text-orange-700';
      if (sentiment === 'high_risk_detractor') return 'bg-red-500/10 text-red-700';
      return 'bg-blue-500/10 text-blue-700';
    },
    sentimentLabel(sentiment) {
      return String(sentiment || '').split('_').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ') || '-';
    },
    async load() {
      this.loading = true;
      this.error = '';
      try {
        const [dealsResult, pylonResult] = await Promise.allSettled([
          appAction('hubspot-deals', {}),
          appAction('pylon-issues', { accounts: true, query: '' })
        ]);
        const allDeals = dealsResult.status === 'fulfilled' ? dealsResult.value.deals || [] : [];
        const stageLabels = dealsResult.status === 'fulfilled' ? dealsResult.value.stageLabels || {} : {};
        this.deals = allDeals.map((deal) => this.toRiskDeal(deal, stageLabels)).filter(Boolean).sort((a, b) => b.daysInCurrentRiskStatus - a.daysInCurrentRiskStatus);
        const accounts = pylonResult.status === 'fulfilled' ? pylonResult.value.accounts || [] : [];
        this.pylonOnlyDeals = accounts
          .filter((a) => ['frustrated', 'high_risk_detractor'].includes(a.sentiment || a.pylonSentiment))
          .map((a) => ({
            pylonAccountId: a.id,
            accountName: a.name,
            pylonSentiment: a.sentiment || a.pylonSentiment || 'frustrated',
            csmName: a.owner?.name || a.csmName || null,
            totalArr: a.arr || a.totalArr || null,
            earliestClosedate: a.renewalDate || a.earliestClosedate || null,
            dealCount: a.dealCount || 0
          }));
        this.selectedHubspotId = this.filteredHubspot()[0]?.id || null;
        this.selectedPylonId = this.filteredPylon()[0]?.pylonAccountId || null;
        if (dealsResult.status === 'rejected') this.error = dealsResult.reason?.message || String(dealsResult.reason);
      } finally {
        this.loading = false;
      }
    },
    toRiskDeal(deal, stageLabels) {
      const p = deal.properties || {};
      const riskStatus = p.hs_csm_sentiment || p.risk_status || p.customer_risk_status || p.churn_risk_status || '';
      const normalized = this.normalizeRisk(riskStatus);
      if (!normalized) return null;
      const updated = p.hs_csm_sentiment_last_updated || p.risk_status_last_updated || p.lastmodifieddate || p.updatedAt || null;
      const days = updated ? Math.max(0, Math.floor((Date.now() - new Date(updated).getTime()) / 86400000)) : 0;
      return {
        id: deal.id,
        dealname: p.dealname || p.name || 'Untitled deal',
        riskStatus: normalized,
        riskSummary: p.risk_summary || p.churn_risk_summary || p.cx_risk_summary || '',
        riskCategory: p.risk_category || p.churn_risk_category || '',
        nextStep: p.next_step || p.hs_next_step || p.next_steps || '',
        churnNotes: p.churn_notes || p.closed_lost_reason || '',
        daysInCurrentRiskStatus: days,
        riskStatusLastUpdated: updated,
        csmName: p.customer_success_owner || p.csm_name || null,
        dealStageLabel: stageLabels[p.dealstage] || p.dealstage || null,
        arr: Number(p.amount || p.arr || 0),
        closedate: p.closedate || null,
        pipeline: p.pipeline || null,
        pylonSentiment: p.pylon_sentiment || null,
        pylonAccountId: p.pylon_account_id || null
      };
    },
    normalizeRisk(value) {
      const s = String(value || '').toLowerCase();
      if (s.includes('confirmed churn') || s.includes('churned')) return 'Confirmed Churn';
      if (s.includes('churn risk') || s.includes('at risk')) return 'Churn Risk';
      if (s.includes('radar') || s.includes('yellow')) return 'On the Radar';
      if (s.includes('no save')) return 'No Save Attempted';
      return null;
    },
    hubspotCsms() {
      return Array.from(new Set(this.deals.map((d) => d.csmName).filter(Boolean))).sort();
    },
    pylonCsms() {
      return Array.from(new Set(this.pylonOnlyDeals.map((d) => d.csmName).filter(Boolean))).sort();
    },
    filteredHubspot() {
      return this.deals.filter((d) => {
        if (this.statusFilter !== 'All' && d.riskStatus !== this.statusFilter) return false;
        if (this.csmFilter !== 'All' && d.csmName !== this.csmFilter) return false;
        return true;
      }).sort((a, b) => this.sortDir === 'desc' ? b.daysInCurrentRiskStatus - a.daysInCurrentRiskStatus : a.daysInCurrentRiskStatus - b.daysInCurrentRiskStatus);
    },
    filteredPylon() {
      return this.pylonOnlyDeals.filter((a) => this.pylonCsmFilter === 'All' || a.csmName === this.pylonCsmFilter);
    },
    selectedDeal() {
      return this.filteredHubspot().find((d) => d.id === this.selectedHubspotId) || this.filteredHubspot()[0] || null;
    },
    selectedPylon() {
      return this.filteredPylon().find((d) => d.pylonAccountId === this.selectedPylonId) || this.filteredPylon()[0] || null;
    },
    move(delta) {
      if (this.view === 'hubspot') {
        const rows = this.filteredHubspot();
        const idx = Math.max(0, rows.findIndex((d) => d.id === this.selectedHubspotId));
        this.selectedHubspotId = rows[Math.min(Math.max(idx + delta, 0), rows.length - 1)]?.id || null;
      } else {
        const rows = this.filteredPylon();
        const idx = Math.max(0, rows.findIndex((d) => d.pylonAccountId === this.selectedPylonId));
        this.selectedPylonId = rows[Math.min(Math.max(idx + delta, 0), rows.length - 1)]?.pylonAccountId || null;
      }
    },
    handleKey(event) {
      if (event.key === 'ArrowDown') { event.preventDefault(); this.move(1); }
      if (event.key === 'ArrowUp') { event.preventDefault(); this.move(-1); }
    }
  };
}
</script>
<div x-data="riskMeetingApp()" x-init="init()" x-on:keydown.window="handleKey($event)" class="space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="flex rounded-lg border border-border bg-muted/30 p-0.5 text-xs">
      <button class="rounded-md px-3 py-1.5" :class="view === 'hubspot' ? 'bg-background shadow-sm' : 'text-muted-foreground'" x-on:click="view = 'hubspot'" x-text="'HubSpot Flagged (' + deals.length + ')'"></button>
      <button class="rounded-md px-3 py-1.5" :class="view === 'pylon' ? 'bg-background shadow-sm' : 'text-muted-foreground'" x-on:click="view = 'pylon'" x-text="'Pylon Early Warning (' + pylonOnlyDeals.length + ')'"></button>
    </div>
    <button class="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted" x-on:click="load()" x-text="loading ? 'Refreshing' : 'Refresh'"></button>
  </div>
  <p x-show="error" class="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700" x-text="error"></p>

  <div x-show="view === 'hubspot'" class="space-y-3">
    <div class="flex flex-wrap items-center gap-2 border-b border-border pb-3 text-xs">
      <span class="font-medium text-muted-foreground">Status</span>
      <template x-for="status in statuses" :key="status">
        <button class="rounded-full border px-2.5 py-1" :class="statusFilter === status ? (status === 'All' ? 'border-foreground bg-foreground text-background' : statusClass(status)) : 'border-border text-muted-foreground hover:bg-muted'" x-on:click="statusFilter = status; selectedHubspotId = filteredHubspot()[0]?.id || null" x-text="status"></button>
      </template>
      <select class="rounded-md border border-border bg-background px-2 py-1" x-model="csmFilter" x-on:change="selectedHubspotId = filteredHubspot()[0]?.id || null">
        <option value="All">All CSMs</option>
        <template x-for="csm in hubspotCsms()" :key="csm"><option :value="csm" x-text="csm"></option></template>
      </select>
      <button class="ml-auto rounded-md border border-border px-2 py-1" x-on:click="sortDir = sortDir === 'desc' ? 'asc' : 'desc'" x-text="sortDir === 'desc' ? 'Oldest first' : 'Newest first'"></button>
    </div>
    <div class="grid min-h-[560px] gap-4 lg:grid-cols-[420px_minmax(0,1fr)]">
      <div class="space-y-2 overflow-auto rounded-lg border border-border bg-card p-2">
        <template x-for="deal in filteredHubspot()" :key="deal.id">
          <button class="w-full rounded-md border-l-4 px-3 py-2 text-left hover:bg-muted" :class="selectedHubspotId === deal.id ? 'border border-border bg-muted border-l-4' : statusClass(deal.riskStatus)" x-on:click="selectedHubspotId = deal.id">
            <div class="flex items-start justify-between gap-2">
              <span class="truncate font-medium" x-text="deal.dealname"></span>
              <span class="shrink-0 text-xs font-semibold tabular-nums" x-text="deal.daysInCurrentRiskStatus + 'd'"></span>
            </div>
            <div class="mt-1 flex flex-wrap gap-1">
              <span class="rounded-full px-2 py-0.5 text-[10px]" :class="statusClass(deal.riskStatus)" x-text="deal.riskStatus"></span>
              <span class="text-xs text-muted-foreground" x-text="deal.csmName || ''"></span>
            </div>
          </button>
        </template>
      </div>
      <div class="rounded-lg border border-border bg-card p-4">
        <template x-if="selectedDeal()">
          <div class="space-y-4">
            <div>
              <h2 class="text-xl font-semibold" x-text="selectedDeal().dealname"></h2>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <span class="rounded-full border px-2.5 py-1 text-xs" :class="statusClass(selectedDeal().riskStatus)" x-text="selectedDeal().riskStatus"></span>
                <span class="text-xs font-medium text-muted-foreground" x-text="selectedDeal().daysInCurrentRiskStatus + ' days in current status'"></span>
              </div>
            </div>
            <template x-for="section in [
              { label: 'Risk Summary', value: selectedDeal().riskSummary },
              { label: 'Next Step', value: selectedDeal().nextStep },
              { label: 'Churn Notes', value: selectedDeal().churnNotes }
            ]" :key="section.label">
              <section>
                <p class="mb-2 text-[11px] font-semibold uppercase text-muted-foreground" x-text="section.label"></p>
                <div class="min-h-16 rounded-lg border border-border bg-background p-3">
                  <p class="whitespace-pre-wrap" x-text="section.value || 'Not set'"></p>
                </div>
              </section>
            </template>
            <div class="grid gap-2 border-t border-border pt-4 text-sm sm:grid-cols-2">
              <p><span class="text-muted-foreground">CSM: </span><span x-text="selectedDeal().csmName || '-'"></span></p>
              <p><span class="text-muted-foreground">ARR: </span><span x-text="money(selectedDeal().arr)"></span></p>
              <p><span class="text-muted-foreground">Stage: </span><span x-text="selectedDeal().dealStageLabel || '-'"></span></p>
              <p><span class="text-muted-foreground">Close Date: </span><span x-text="date(selectedDeal().closedate)"></span></p>
            </div>
            <a x-show="selectedDeal().pylonAccountId" :href="'https://app.usepylon.com/accounts/' + selectedDeal().pylonAccountId" target="_blank" class="inline-flex rounded-md border border-border px-3 py-2 text-xs hover:bg-muted">Open in Pylon</a>
          </div>
        </template>
      </div>
    </div>
  </div>

  <div x-show="view === 'pylon'" class="space-y-3">
    <div class="flex items-center gap-2 border-b border-border pb-3 text-xs">
      <span class="font-medium text-muted-foreground">CSM</span>
      <select class="rounded-md border border-border bg-background px-2 py-1" x-model="pylonCsmFilter" x-on:change="selectedPylonId = filteredPylon()[0]?.pylonAccountId || null">
        <option value="All">All CSMs</option>
        <template x-for="csm in pylonCsms()" :key="csm"><option :value="csm" x-text="csm"></option></template>
      </select>
    </div>
    <div class="grid min-h-[560px] gap-4 lg:grid-cols-[420px_minmax(0,1fr)]">
      <div class="space-y-2 overflow-auto rounded-lg border border-border bg-card p-2">
        <template x-for="account in filteredPylon()" :key="account.pylonAccountId">
          <button class="w-full rounded-md border-l-4 px-3 py-2 text-left hover:bg-muted" :class="selectedPylonId === account.pylonAccountId ? 'border border-border bg-muted border-l-4 border-l-orange-500' : 'border-l-orange-500'" x-on:click="selectedPylonId = account.pylonAccountId">
            <div class="flex items-start justify-between gap-2"><span class="truncate font-medium" x-text="account.accountName"></span><span class="shrink-0 text-xs tabular-nums text-muted-foreground" x-text="money(account.totalArr)"></span></div>
            <div class="mt-1 flex flex-wrap gap-1"><span class="rounded-full px-2 py-0.5 text-[10px]" :class="sentimentClass(account.pylonSentiment)" x-text="sentimentLabel(account.pylonSentiment)"></span><span class="text-xs text-muted-foreground" x-text="account.csmName || ''"></span></div>
          </button>
        </template>
      </div>
      <div class="rounded-lg border border-border bg-card p-4">
        <template x-if="selectedPylon()">
          <div class="space-y-4">
            <div>
              <h2 class="text-xl font-semibold" x-text="selectedPylon().accountName"></h2>
              <div class="mt-2 flex flex-wrap items-center gap-2"><span class="text-xs text-muted-foreground">Pylon sentiment</span><span class="rounded-full px-2.5 py-1 text-xs" :class="sentimentClass(selectedPylon().pylonSentiment)" x-text="sentimentLabel(selectedPylon().pylonSentiment)"></span></div>
            </div>
            <div class="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <p class="font-medium text-amber-800">Not yet flagged in HubSpot</p>
              <p class="mt-1 text-xs text-amber-700">Pylon has negative sentiment for this account. Review before weekly risk meeting.</p>
            </div>
            <div class="grid gap-2 border-t border-border pt-4 text-sm sm:grid-cols-2">
              <p><span class="text-muted-foreground">CSM: </span><span x-text="selectedPylon().csmName || '-'"></span></p>
              <p><span class="text-muted-foreground">ARR: </span><span x-text="money(selectedPylon().totalArr)"></span></p>
              <p><span class="text-muted-foreground">Earliest Close: </span><span x-text="date(selectedPylon().earliestClosedate)"></span></p>
              <p><span class="text-muted-foreground">Deals: </span><span x-text="selectedPylon().dealCount || 0"></span></p>
            </div>
            <a :href="'https://app.usepylon.com/accounts/' + selectedPylon().pylonAccountId" target="_blank" class="inline-flex rounded-md border border-border px-3 py-2 text-xs hover:bg-muted">Open in Pylon</a>
          </div>
        </template>
      </div>
    </div>
  </div>
</div>`,
  );
}

export function hubspotExtension(): string {
  return baseExtension(
    "HubSpot Sales",
    `<script>
function hubspotSalesApp() {
  return {
    loading: false,
    error: '',
    deals: [],
    pipelines: [],
    stageLabels: {},
    metrics: {},
    selectedDeal: null,
    activePipelineId: '',
    managerFilter: 'All',
    search: '',
    sortCol: 'amount',
    sortDir: 'desc',
    managers: ['All', 'Brian', 'Erin', 'Luke', 'Commercial'],
    managerMap: {
      'Michael Castillo': 'Brian', 'Erica Schaubroeck': 'Brian', 'Jessica Farnham': 'Brian', 'George Schultz': 'Brian', 'Thomas Godfrey': 'Brian',
      'Andrew Bishop': 'Erin', 'Julia Shkrabova': 'Erin', 'Nina Abbasi-Beard': 'Erin', 'Oliver Fison': 'Erin',
      'Logan Tucker': 'Luke', 'Adam Elias': 'Luke', 'James Russo': 'Luke'
    },
    async init() {
      await this.load();
    },
    async load() {
      this.loading = true;
      this.error = '';
      try {
        const [deals, pipelines, metrics] = await Promise.all([
          appAction('hubspot-deals', {}),
          appAction('hubspot-pipelines', {}),
          appAction('hubspot-metrics', {})
        ]);
        this.deals = deals.deals || [];
        this.stageLabels = deals.stageLabels || {};
        this.pipelines = pipelines.pipelines || [];
        this.metrics = metrics || {};
        const enterprise = this.pipelines.find((p) => String(p.label || '').includes('Enterprise') && String(p.label || '').includes('New'));
        this.activePipelineId = (enterprise || this.pipelines[0] || {}).id || '';
      } catch (e) {
        this.error = e.message || String(e);
      } finally {
        this.loading = false;
      }
    },
    money(value) {
      const n = Number(value || 0);
      if (!n) return '-';
      if (Math.abs(n) >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'm';
      if (Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(1) + 'k';
      return '$' + Math.round(n).toLocaleString();
    },
    pct(value) {
      return (Number(value || 0) * 100).toFixed(1) + '%';
    },
    date(value) {
      if (!value) return '-';
      return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    },
    prop(deal, key) {
      return (deal.properties || {})[key];
    },
    amount(deal) {
      return Number(this.prop(deal, 'amount') || 0);
    },
    stageLabel(stageId) {
      return this.stageLabels[stageId] || stageId || '-';
    },
    stageClass(label) {
      const s = String(label || '').toLowerCase();
      if (s.includes('won')) return 'bg-emerald-500/10 text-emerald-700';
      if (s.includes('lost')) return 'bg-red-500/10 text-red-700';
      if (s.includes('pov') || s.includes('poc') || s.includes('proof')) return 'bg-violet-500/10 text-violet-700';
      if (s.includes('contract') || s.includes('negotiat')) return 'bg-yellow-500/10 text-yellow-700';
      return 'bg-muted text-muted-foreground';
    },
    dealOwner(deal) {
      return this.prop(deal, 'owner_name') || this.prop(deal, 'hubspot_owner_name') || this.prop(deal, 'hubspot_owner_id') || '';
    },
    dealManager(deal) {
      return this.managerMap[this.dealOwner(deal)] || 'Commercial';
    },
    activePipeline() {
      return this.pipelines.find((p) => p.id === this.activePipelineId) || this.pipelines[0] || null;
    },
    visiblePipelines() {
      return this.pipelines.filter((p) => (p.stages || []).length > 1);
    },
    columns() {
      const pipeline = this.activePipeline();
      if (!pipeline) return [];
      return (pipeline.stages || []).slice().sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0)).map((stage) => {
        const deals = this.deals.filter((deal) => {
          if (this.prop(deal, 'pipeline') !== pipeline.id) return false;
          if (this.prop(deal, 'dealstage') !== stage.id) return false;
          if (this.managerFilter !== 'All' && this.dealManager(deal) !== this.managerFilter) return false;
          return true;
        }).sort((a, b) => Number(this.prop(b, '_days_in_stage') || 0) - Number(this.prop(a, '_days_in_stage') || 0));
        return { stage, deals, totalValue: deals.reduce((sum, d) => sum + this.amount(d), 0) };
      });
    },
    povDeals() {
      return this.deals.filter((deal) => {
        const label = this.stageLabel(this.prop(deal, 'dealstage')).toLowerCase();
        return label.includes('pov') || label.includes('poc') || label.includes('proof');
      }).sort((a, b) => this.amount(b) - this.amount(a));
    },
    filteredDeals() {
      const q = this.search.toLowerCase().trim();
      let rows = this.deals;
      if (q) {
        rows = rows.filter((deal) => String(this.prop(deal, 'dealname') || '').toLowerCase().includes(q) || this.stageLabel(this.prop(deal, 'dealstage')).toLowerCase().includes(q));
      }
      return rows.slice().sort((a, b) => {
        let av; let bv;
        if (this.sortCol === 'amount') { av = this.amount(a); bv = this.amount(b); }
        else if (this.sortCol === 'stage') { av = this.stageLabel(this.prop(a, 'dealstage')); bv = this.stageLabel(this.prop(b, 'dealstage')); }
        else { av = this.prop(a, this.sortCol) || ''; bv = this.prop(b, this.sortCol) || ''; }
        if (typeof av === 'number') return this.sortDir === 'asc' ? av - bv : bv - av;
        return this.sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      }).slice(0, 200);
    },
    sortBy(col) {
      if (this.sortCol === col) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
      else { this.sortCol = col; this.sortDir = 'desc'; }
    },
    openDealUrl(deal) {
      return 'https://app.hubspot.com/contacts/deals/' + deal.id;
    }
  };
}
</script>
<div x-data="hubspotSalesApp()" x-init="init()" class="space-y-4">
  <p x-show="error" class="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800" x-text="error"></p>
  <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
    <template x-for="card in [
      { label: 'Open Deals', value: Number(metrics.openDeals || 0).toLocaleString() },
      { label: 'Open Pipeline', value: money(metrics.openPipelineValue) },
      { label: 'Won Revenue', value: money(metrics.wonValue) },
      { label: 'Win Rate', value: pct(metrics.winRate) },
      { label: 'Avg ACV', value: money(metrics.avgDealSize) },
      { label: 'Landing ACV', value: money(metrics.landingAcv) },
      { label: 'POV Success', value: pct(metrics.povSuccessRate), sub: (metrics.povWon || 0) + '/' + (metrics.povEntered || 0) }
    ]" :key="card.label">
      <div class="rounded-lg border border-border bg-card p-3 text-center">
        <p class="text-[10px] font-medium uppercase text-muted-foreground" x-text="card.label"></p>
        <p class="mt-1 text-lg font-semibold tabular-nums" x-text="loading ? '...' : card.value"></p>
        <p class="text-[10px] text-muted-foreground" x-text="card.sub || ''"></p>
      </div>
    </template>
  </div>

  <section class="rounded-lg border border-border bg-card p-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 class="font-medium">Pipeline Board</h2>
      <div class="flex flex-wrap gap-2 text-[11px]">
        <div class="flex overflow-hidden rounded-md border border-border">
          <template x-for="manager in managers" :key="manager">
            <button class="px-2.5 py-1" :class="managerFilter === manager ? 'bg-primary text-primary-foreground' : 'bg-muted/30 text-muted-foreground'" x-on:click="managerFilter = manager" x-text="manager"></button>
          </template>
        </div>
        <div class="flex max-w-full overflow-x-auto rounded-md border border-border">
          <template x-for="pipeline in visiblePipelines()" :key="pipeline.id">
            <button class="whitespace-nowrap px-2.5 py-1" :class="activePipelineId === pipeline.id ? 'bg-primary text-primary-foreground' : 'bg-muted/30 text-muted-foreground'" x-on:click="activePipelineId = pipeline.id" x-text="pipeline.label"></button>
          </template>
        </div>
      </div>
    </div>
    <div class="flex gap-2 overflow-x-auto pb-2">
      <template x-for="col in columns()" :key="col.stage.id">
        <div class="w-[220px] shrink-0 rounded-lg border border-border bg-muted/10">
          <div class="border-b border-border p-2">
            <p class="truncate text-xs font-medium" x-text="col.stage.label"></p>
            <div class="mt-1 flex justify-between text-[10px] text-muted-foreground"><span x-text="col.deals.length + ' deals'"></span><span x-text="money(col.totalValue)"></span></div>
          </div>
          <div class="max-h-[420px] space-y-1 overflow-auto p-1.5">
            <template x-for="deal in col.deals" :key="deal.id">
              <button class="w-full rounded-md border border-border bg-card p-2 text-left hover:bg-muted" x-on:click="selectedDeal = deal">
                <p class="truncate text-[11px] font-medium" x-text="prop(deal, 'dealname') || 'Untitled'"></p>
                <p class="mt-0.5 truncate text-[10px] text-muted-foreground" x-text="dealOwner(deal)"></p>
                <div class="mt-1 flex justify-between text-[10px]"><span class="text-blue-700" x-text="money(amount(deal))"></span><span class="text-muted-foreground" x-text="(prop(deal, '_days_in_stage') || 0) + 'd'"></span></div>
              </button>
            </template>
          </div>
        </div>
      </template>
    </div>
  </section>

  <section class="rounded-lg border border-border bg-card p-4">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="font-medium" x-text="'POV Deals (' + povDeals().length + ')'"></h2>
      <span class="text-xs font-medium text-violet-700" x-text="'Total: ' + money(povDeals().reduce((sum, d) => sum + amount(d), 0))"></span>
    </div>
    <div class="max-h-96 overflow-auto">
      <table class="w-full text-xs">
        <thead class="sticky top-0 bg-card"><tr class="border-b border-border"><th class="py-2 text-left">Deal</th><th class="py-2 text-left">Stage</th><th class="py-2 text-right">Amount</th><th class="py-2 text-right">Close Date</th><th></th></tr></thead>
        <tbody>
          <template x-for="deal in povDeals()" :key="'pov-' + deal.id">
            <tr class="border-b border-border/50 hover:bg-muted/30"><td class="max-w-[360px] truncate py-1.5 font-medium" x-on:click="selectedDeal = deal" x-text="prop(deal, 'dealname') || 'Untitled'"></td><td class="py-1.5"><span class="rounded-full px-2 py-0.5 text-[10px]" :class="stageClass(stageLabel(prop(deal, 'dealstage')))" x-text="stageLabel(prop(deal, 'dealstage'))"></span></td><td class="py-1.5 text-right tabular-nums" x-text="money(amount(deal))"></td><td class="py-1.5 text-right text-muted-foreground" x-text="date(prop(deal, 'closedate'))"></td><td class="py-1.5 text-right"><a class="text-muted-foreground hover:text-foreground" target="_blank" :href="openDealUrl(deal)">Open</a></td></tr>
          </template>
        </tbody>
      </table>
    </div>
  </section>

  <section class="rounded-lg border border-border bg-card p-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 class="font-medium" x-text="'Deal Lookup (' + filteredDeals().length + ')'"></h2>
      <input class="w-64 rounded-md border border-input bg-background px-3 py-2 text-xs" x-model="search" placeholder="Search deals or stages" />
    </div>
    <div class="max-h-[520px] overflow-auto">
      <table class="w-full text-xs">
        <thead class="sticky top-0 bg-card"><tr class="border-b border-border">
          <th class="cursor-pointer py-2 text-left" x-on:click="sortBy('dealname')">Deal Name</th>
          <th class="cursor-pointer py-2 text-left" x-on:click="sortBy('stage')">Stage</th>
          <th class="cursor-pointer py-2 text-right" x-on:click="sortBy('amount')">Amount</th>
          <th class="cursor-pointer py-2 text-right" x-on:click="sortBy('createdate')">Created</th>
          <th class="cursor-pointer py-2 text-right" x-on:click="sortBy('closedate')">Close Date</th>
          <th></th>
        </tr></thead>
        <tbody>
          <template x-for="deal in filteredDeals()" :key="'row-' + deal.id">
            <tr class="border-b border-border/50 hover:bg-muted/30" :class="selectedDeal && selectedDeal.id === deal.id ? 'bg-primary/10' : ''"><td class="max-w-[360px] truncate py-1.5 font-medium" x-on:click="selectedDeal = deal" x-text="prop(deal, 'dealname') || 'Untitled'"></td><td class="py-1.5"><span class="rounded-full px-2 py-0.5 text-[10px]" :class="stageClass(stageLabel(prop(deal, 'dealstage')))" x-text="stageLabel(prop(deal, 'dealstage'))"></span></td><td class="py-1.5 text-right tabular-nums" x-text="money(amount(deal))"></td><td class="py-1.5 text-right text-muted-foreground" x-text="date(prop(deal, 'createdate'))"></td><td class="py-1.5 text-right text-muted-foreground" x-text="date(prop(deal, 'closedate'))"></td><td class="py-1.5 text-right"><a target="_blank" :href="openDealUrl(deal)">Open</a></td></tr>
          </template>
        </tbody>
      </table>
    </div>
  </section>

  <div x-show="selectedDeal" class="fixed inset-0 z-50 bg-background/80 p-4" x-on:click.self="selectedDeal = null">
    <div class="mx-auto max-w-2xl rounded-lg border border-border bg-card p-4 shadow-lg">
      <div class="flex items-start justify-between gap-3">
        <div><h2 class="text-lg font-semibold" x-text="selectedDeal ? prop(selectedDeal, 'dealname') : ''"></h2><p class="text-xs text-muted-foreground" x-text="selectedDeal ? stageLabel(prop(selectedDeal, 'dealstage')) : ''"></p></div>
        <button class="rounded-md border border-border px-2 py-1 text-xs" x-on:click="selectedDeal = null">Close</button>
      </div>
      <div class="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <p><span class="text-muted-foreground">Amount: </span><span x-text="selectedDeal ? money(amount(selectedDeal)) : ''"></span></p>
        <p><span class="text-muted-foreground">Owner: </span><span x-text="selectedDeal ? dealOwner(selectedDeal) : ''"></span></p>
        <p><span class="text-muted-foreground">Created: </span><span x-text="selectedDeal ? date(prop(selectedDeal, 'createdate')) : ''"></span></p>
        <p><span class="text-muted-foreground">Close: </span><span x-text="selectedDeal ? date(prop(selectedDeal, 'closedate')) : ''"></span></p>
      </div>
      <a x-show="selectedDeal" class="mt-4 inline-flex rounded-md border border-border px-3 py-2 text-xs hover:bg-muted" target="_blank" :href="selectedDeal ? openDealUrl(selectedDeal) : '#'">Open in HubSpot</a>
    </div>
  </div>
</div>`,
  );
}

export function cxDoubleClickExtension(): string {
  return baseExtension(
    "CX Double Click",
    `<script>
function cxDoubleClickApp() {
  return {
    loading: false,
    error: '',
    days: '90',
    segment: 'enterprise',
    selected: null,
    data: {
      ndr: [], renewals: [], expansion: [], csqls: [], prs: [], credits: [], seats: [], pylonAging: [], pylonResolution: []
    },
    async init() { await this.load(); },
    money(value) {
      const n = Number(value || 0);
      if (Math.abs(n) >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'm';
      if (Math.abs(n) >= 1000) return '$' + Math.round(n / 1000).toLocaleString() + 'k';
      return '$' + Math.round(n).toLocaleString();
    },
    num(value) { return Number(value || 0).toLocaleString(); },
    pct(value) { return Number(value || 0).toFixed(1) + '%'; },
    async q(key, sql) {
      const result = await appAction('bigquery', { sql });
      this.data[key] = result.rows || result.data?.rows || [];
    },
    async load() {
      this.loading = true;
      this.error = '';
      try {
        await Promise.all([
          this.q('ndr', this.ndrSql()),
          this.q('renewals', this.renewalsSql()),
          this.q('expansion', this.expansionSql()),
          this.q('csqls', this.csqlsSql()),
          this.q('prs', this.prsSql()),
          this.q('credits', this.creditSql()),
          this.q('seats', this.seatSql()),
          this.q('pylonAging', this.pylonAgingSql()),
          this.q('pylonResolution', this.pylonResolutionSql())
        ]);
      } catch (e) {
        this.error = e.message || String(e);
      } finally {
        this.loading = false;
      }
    },
    ndrSql() {
      const days = Number(this.days);
      return [
        'WITH daily_snaps AS (',
        '  SELECT id AS customer_id, DATE(event_date) AS snap_date, current_arr AS arr, ROW_NUMBER() OVER (PARTITION BY id, DATE(event_date) ORDER BY event_date DESC) AS rn',
        '  FROM \`builder-3b0a2.finance.arr_revenue_tracker_latest\`',
        "  WHERE plan = 'Enterprise' AND discard = false",
        '), snapshots AS (SELECT customer_id, snap_date, arr FROM daily_snaps WHERE rn = 1),',
        'weeks AS (SELECT wk AS eval_date FROM UNNEST(GENERATE_DATE_ARRAY(DATE_SUB(DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY)), INTERVAL 13 WEEK), DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY)), INTERVAL 1 WEEK)) AS wk UNION DISTINCT SELECT CURRENT_DATE()),',
        'end_snap AS (SELECT w.eval_date, s.customer_id, s.arr AS end_arr, ROW_NUMBER() OVER (PARTITION BY w.eval_date, s.customer_id ORDER BY s.snap_date DESC) AS rn FROM weeks w JOIN snapshots s ON s.snap_date <= w.eval_date),',
        'start_snap AS (SELECT w.eval_date, s.customer_id, s.arr AS start_arr, ROW_NUMBER() OVER (PARTITION BY w.eval_date, s.customer_id ORDER BY s.snap_date DESC) AS rn FROM weeks w JOIN snapshots s ON s.snap_date <= DATE_SUB(w.eval_date, INTERVAL ' + days + ' DAY))',
        'SELECT FORMAT_DATE(\\'%Y-%m-%d\\', e.eval_date) AS week, ROUND(100.0 * SUM(e.end_arr) / NULLIF(SUM(sa.start_arr), 0), 1) AS ndr_pct',
        'FROM (SELECT * FROM end_snap WHERE rn = 1) e JOIN (SELECT * FROM start_snap WHERE rn = 1) sa ON e.customer_id = sa.customer_id AND e.eval_date = sa.eval_date',
        'WHERE sa.start_arr > 0 GROUP BY e.eval_date ORDER BY e.eval_date'
      ].join('\\n');
    },
    renewalsSql() {
      return [
        'WITH categorized AS (',
        '  SELECT DATE_TRUNC(DATE(d.closedate), WEEK(MONDAY)) AS week_start,',
        "  CASE WHEN d.hs_is_closed_won = true THEN 'renewal_won' WHEN LOWER(d.stage_name) LIKE '%closed lost%' THEN 'churned' WHEN d.stage_name IS NOT NULL AND LOWER(d.stage_name) NOT LIKE '%closed%' THEN CASE WHEN LOWER(c.hs_csm_sentiment) LIKE '%healthy%' THEN 'healthy' WHEN LOWER(c.hs_csm_sentiment) LIKE '%radar%' OR LOWER(c.hs_csm_sentiment) LIKE '%yellow%' THEN 'on_the_radar' WHEN LOWER(c.hs_csm_sentiment) LIKE '%churn risk%' AND LOWER(c.hs_csm_sentiment) NOT LIKE '%confirmed%' THEN 'churn_risk' WHEN LOWER(c.hs_csm_sentiment) LIKE '%confirmed churn%' THEN 'confirmed_churn' ELSE 'no_status' END ELSE 'no_status' END AS category",
        '  FROM \`builder-3b0a2.hubspot.deals\` d LEFT JOIN \`builder-3b0a2.dbt_staging.hubspot_companies\` c ON CAST(d.company_id AS STRING) = CAST(c.company_id AS STRING)',
        "  WHERE d.pipeline_name = 'Enterprise: Renewal' AND d.closedate IS NOT NULL AND DATE(d.closedate) >= DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY)) AND DATE(d.closedate) < DATE_ADD(DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY)), INTERVAL 12 WEEK) AND d._polytomic_deleted_at IS NULL",
        ')',
        'SELECT FORMAT_DATE(\\'%Y-%m-%d\\', week_start) AS week, COUNTIF(category = \\'renewal_won\\') AS renewal_won, COUNTIF(category = \\'healthy\\') AS healthy, COUNTIF(category = \\'on_the_radar\\') AS on_the_radar, COUNTIF(category = \\'churn_risk\\') AS churn_risk, COUNTIF(category = \\'confirmed_churn\\') AS confirmed_churn, COUNTIF(category = \\'churned\\') AS churned, COUNTIF(category = \\'no_status\\') AS no_status, COUNT(*) AS total FROM categorized GROUP BY week_start HAVING COUNT(*) > 0 ORDER BY week_start'
      ].join('\\n');
    },
    expansionSql() {
      return [
        'WITH all_weeks AS (SELECT wk AS week_start FROM UNNEST(GENERATE_DATE_ARRAY(DATE \\'2026-02-02\\', DATE \\'2026-04-27\\', INTERVAL 1 WEEK)) AS wk),',
        'deals_qtd AS (SELECT DATE_TRUNC(date_became_s1, WEEK(MONDAY)) AS week_start, CASE WHEN enterprise_lead_source = \\'CSM Sourced\\' THEN \\'csm\\' WHEN enterprise_lead_source = \\'Outbound AE sourced\\' THEN \\'ae\\' ELSE \\'other\\' END AS cat, COALESCE(CAST(amount AS FLOAT64), 0) AS deal_amount FROM \`builder-3b0a2.hubspot.deals\` WHERE (pipeline_name LIKE \\'%Expansion%\\' OR pipeline_name LIKE \\'%Renewal%\\') AND _polytomic_deleted_at IS NULL AND date_became_s1 IS NOT NULL AND date_became_s1 >= DATE \\'2026-02-02\\' AND date_became_s1 <= DATE \\'2026-04-27\\'),',
        'weekly_wide AS (SELECT aw.week_start, COALESCE(SUM(IF(d.cat = \\'csm\\', d.deal_amount, 0)), 0) AS csm, COALESCE(SUM(IF(d.cat = \\'ae\\', d.deal_amount, 0)), 0) AS ae, COALESCE(SUM(IF(d.cat = \\'other\\', d.deal_amount, 0)), 0) AS other FROM all_weeks aw LEFT JOIN deals_qtd d ON d.week_start = aw.week_start GROUP BY aw.week_start),',
        'cumulative AS (SELECT week_start, SUM(csm) OVER (ORDER BY week_start) AS csm_sourced, SUM(ae) OVER (ORDER BY week_start) AS ae_sourced, SUM(other) OVER (ORDER BY week_start) AS other, (FLOOR(DATE_DIFF(week_start, DATE \\'2026-02-02\\', DAY) / 7) + 1) * 217000 AS target FROM weekly_wide)',
        'SELECT FORMAT_DATE(\\'%Y-%m-%d\\', week_start) AS week, ROUND(csm_sourced) AS csm_sourced, ROUND(ae_sourced) AS ae_sourced, ROUND(other) AS other, ROUND(target) AS target FROM cumulative ORDER BY week_start'
      ].join('\\n');
    },
    csqlsSql() {
      return "SELECT FORMAT_DATE('%Y-%m-%d', DATE_TRUNC(createdate, WEEK(MONDAY))) AS week, COUNT(*) AS csqls, COUNTIF(LOWER(COALESCE(hs_lead_status, '')) LIKE '%qualified%') AS qualified FROM \`builder-3b0a2.hubspot.contacts\` WHERE createdate >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 WEEK) AND _polytomic_deleted_at IS NULL GROUP BY week ORDER BY week";
    },
    prsSql() {
      return "SELECT FORMAT_DATE('%Y-%m-%d', DATE_TRUNC(createdDate, WEEK(MONDAY))) AS week, COUNT(*) AS prs_reviewed, COUNT(DISTINCT JSON_VALUE(data, '$.repo')) AS repos FROM \`builder-3b0a2.analytics.events_partitioned\` WHERE event LIKE '%pr review%' AND createdDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 12 WEEK) GROUP BY week ORDER BY week";
    },
    creditSql() {
      return "WITH weekly AS (SELECT date AS week, ai_credit_utilization_30d AS utilization FROM \`builder-3b0a2.dbt_analytics.enterprise_ai_credit_utilization\` WHERE date = DATE_TRUNC(date, WEEK(MONDAY)) AND date >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY)), INTERVAL 12 WEEK) AND DATE_DIFF(date, first_fusion_deal_close_d, DAY) > 45 AND ai_credit_utilization_30d IS NOT NULL) SELECT FORMAT_DATE('%Y-%m-%d', week) AS week, ROUND(100 * AVG(utilization), 1) AS avg_utilization, COUNT(*) AS customers FROM weekly GROUP BY week ORDER BY week";
    },
    seatSql() {
      return "WITH weekly AS (SELECT date AS week, seat_utilization_30d AS utilization FROM \`builder-3b0a2.dbt_analytics.enterprise_seat_utilization\` WHERE date = DATE_TRUNC(date, WEEK(MONDAY)) AND date >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY)), INTERVAL 12 WEEK) AND DATE_DIFF(date, first_fusion_deal_close_d, DAY) > 45 AND seat_utilization_30d IS NOT NULL) SELECT FORMAT_DATE('%Y-%m-%d', week) AS week, ROUND(100 * AVG(utilization), 1) AS avg_utilization, COUNT(*) AS customers FROM weekly GROUP BY week ORDER BY week";
    },
    pylonAgingSql() {
      return "SELECT COALESCE(account_name, 'Unknown') AS account, COUNT(*) AS open_issues, AVG(DATE_DIFF(CURRENT_DATE(), DATE(created_at), DAY)) AS avg_age_days FROM \`builder-3b0a2.pylon.issues\` WHERE LOWER(COALESCE(state, '')) NOT IN ('closed', 'done') GROUP BY account ORDER BY avg_age_days DESC LIMIT 25";
    },
    pylonResolutionSql() {
      return "SELECT FORMAT_DATE('%Y-%m-%d', DATE_TRUNC(DATE(closed_at), WEEK(MONDAY))) AS week, COUNT(*) AS resolved, ROUND(AVG(DATE_DIFF(DATE(closed_at), DATE(created_at), DAY)), 1) AS avg_resolution_days FROM \`builder-3b0a2.pylon.issues\` WHERE closed_at IS NOT NULL AND DATE(closed_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 WEEK) GROUP BY week ORDER BY week";
    },
    max(rows, key) {
      return Math.max(1, ...rows.map((r) => Number(r[key] || 0)));
    },
    latest(rows, key) {
      return rows.length ? rows[rows.length - 1][key] : null;
    },
    detail(title, rows) {
      this.selected = { title, rows };
    }
  };
}
</script>
<div x-data="cxDoubleClickApp()" x-init="init()" class="space-y-4">
  <div class="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
    <label class="space-y-1"><span class="text-xs text-muted-foreground">NDR period</span><select x-model="days" class="rounded-md border border-border bg-background px-3 py-2"><option value="90">90 day</option><option value="180">6 month</option><option value="365">12 month</option></select></label>
    <label class="space-y-1"><span class="text-xs text-muted-foreground">Segment</span><select x-model="segment" class="rounded-md border border-border bg-background px-3 py-2"><option value="enterprise">Enterprise</option><option value="fusion">Ramped Fusion</option><option value="all">All CX</option></select></label>
    <button class="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground" x-on:click="load()" x-text="loading ? 'Loading' : 'Refresh'"></button>
    <p x-show="error" class="text-xs text-red-700" x-text="error"></p>
  </div>
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <template x-for="card in [
      { label: 'Latest NDR', value: latest(data.ndr, 'ndr_pct') == null ? '-' : pct(latest(data.ndr, 'ndr_pct')) },
      { label: 'Renewals Next 12w', value: num(data.renewals.reduce((s, r) => s + Number(r.total || 0), 0)) },
      { label: 'Expansion Pipeline QTD', value: money(latest(data.expansion, 'csm_sourced') + latest(data.expansion, 'ae_sourced') + latest(data.expansion, 'other')) },
      { label: 'Open Aged Pylon Issues', value: num(data.pylonAging.reduce((s, r) => s + Number(r.open_issues || 0), 0)) }
    ]" :key="card.label">
      <div class="rounded-lg border border-border bg-card p-4"><p class="text-[11px] uppercase text-muted-foreground" x-text="card.label"></p><p class="mt-2 text-2xl font-semibold tabular-nums" x-text="card.value"></p></div>
    </template>
  </div>
  <div class="grid gap-4 lg:grid-cols-2">
    <template x-for="widget in [
      { title: 'NDR Trend', rows: data.ndr, key: 'ndr_pct', type: 'pct' },
      { title: 'Upcoming Renewals by Risk', rows: data.renewals, key: 'total', type: 'num' },
      { title: 'Expansion Pipeline', rows: data.expansion, key: 'target', type: 'money' },
      { title: 'CSQLs', rows: data.csqls, key: 'csqls', type: 'num' },
      { title: 'PR Review Activity', rows: data.prs, key: 'prs_reviewed', type: 'num' },
      { title: 'Agent Credit Utilization', rows: data.credits, key: 'avg_utilization', type: 'pct' },
      { title: 'Seat Utilization', rows: data.seats, key: 'avg_utilization', type: 'pct' },
      { title: 'Pylon Resolution', rows: data.pylonResolution, key: 'avg_resolution_days', type: 'num' }
    ]" :key="widget.title">
      <section class="rounded-lg border border-border bg-card p-4">
        <div class="mb-3 flex items-center justify-between"><h2 class="font-medium" x-text="widget.title"></h2><button class="text-xs text-muted-foreground hover:text-foreground" x-on:click="detail(widget.title, widget.rows)">Details</button></div>
        <div class="flex h-48 items-end gap-1 border-b border-l border-border p-2">
          <template x-for="row in widget.rows" :key="widget.title + '-' + (row.week || row.account)">
            <div class="min-w-[8px] flex-1 rounded-t bg-sky-500" :style="'height:' + Math.max(2, Number(row[widget.key] || 0) / max(widget.rows, widget.key) * 100) + '%'" :title="JSON.stringify(row)"></div>
          </template>
        </div>
      </section>
    </template>
  </div>
  <section class="rounded-lg border border-border bg-card p-4">
    <h2 class="mb-3 font-medium">Pylon Aging by Account</h2>
    <div class="max-h-80 overflow-auto">
      <table class="w-full text-xs"><thead class="sticky top-0 bg-card"><tr class="border-b border-border"><th class="py-2 text-left">Account</th><th class="py-2 text-right">Open Issues</th><th class="py-2 text-right">Avg Age</th></tr></thead><tbody><template x-for="row in data.pylonAging" :key="row.account"><tr class="border-b border-border/50"><td class="py-1.5" x-text="row.account"></td><td class="py-1.5 text-right" x-text="num(row.open_issues)"></td><td class="py-1.5 text-right" x-text="Number(row.avg_age_days || 0).toFixed(1) + 'd'"></td></tr></template></tbody></table>
    </div>
  </section>
  <div x-show="selected" class="fixed inset-0 z-50 bg-background/80 p-4" x-on:click.self="selected = null">
    <div class="mx-auto max-w-5xl rounded-lg border border-border bg-card p-4 shadow-lg">
      <div class="mb-3 flex items-center justify-between"><h2 class="font-semibold" x-text="selected?.title"></h2><button class="rounded-md border border-border px-2 py-1 text-xs" x-on:click="selected = null">Close</button></div>
      <pre class="max-h-[70vh] overflow-auto rounded-md bg-muted p-3 text-xs" x-text="JSON.stringify(selected?.rows || [], null, 2)"></pre>
    </div>
  </div>
</div>`,
  );
}

export function expansionAttainmentExtension(): string {
  return baseExtension(
    "Expansion Attainment Plan",
    `<script>
function expansionAttainmentApp() {
  return {
    loading: false,
    error: '',
    accounts: [],
    deals: [],
    summary: {},
    targetARR: 7500000,
    pipelineConversionRate: 35,
    avgDaysToClose: 90,
    qTargets: [760000, 1390000, 2150000, 3200000],
    qExpansionPercents: [10, 15, 25, 45],
    scenarios: [],
    scenarioName: '',
    viewLimit: 25,
    async init() {
      await this.loadScenarioStore();
      await this.load();
    },
    async loadScenarioStore() {
      try {
        const rows = await extensionData.list('scenarios', { scope: 'org' });
        this.scenarios = rows.map((r) => Object.assign({ id: r.itemId || r.id }, r.data || {}));
      } catch {}
    },
    async saveScenario() {
      const id = 'scenario-' + Date.now();
      const scenario = {
        name: this.scenarioName || 'Scenario ' + new Date().toLocaleDateString(),
        targetARR: this.targetARR,
        pipelineConversionRate: this.pipelineConversionRate,
        avgDaysToClose: this.avgDaysToClose,
        qTargets: this.qTargets,
        qExpansionPercents: this.qExpansionPercents,
        savedAt: new Date().toISOString()
      };
      await extensionData.set('scenarios', id, scenario, { scope: 'org' });
      this.scenarioName = '';
      await this.loadScenarioStore();
    },
    applyScenario(s) {
      this.targetARR = Number(s.targetARR || this.targetARR);
      this.pipelineConversionRate = Number(s.pipelineConversionRate || this.pipelineConversionRate);
      this.avgDaysToClose = Number(s.avgDaysToClose || this.avgDaysToClose);
      this.qTargets = (s.qTargets || this.qTargets).map(Number);
      this.qExpansionPercents = (s.qExpansionPercents || this.qExpansionPercents).map(Number);
    },
    async load() {
      this.loading = true;
      this.error = '';
      try {
        const [accountResult, dealResult, pipelineResult] = await Promise.all([
          appAction('bigquery', { sql: this.accountsSql() }),
          appAction('hubspot-deals', {}),
          appAction('hubspot-pipelines', {})
        ]);
        this.accounts = accountResult.rows || [];
        const allDeals = dealResult.deals || [];
        const pipelines = pipelineResult.pipelines || [];
        this.deals = this.expansionDeals(allDeals, pipelines);
        this.summary = {
          enterpriseAccounts: this.accounts.length,
          totalCurrentARR: this.accounts.reduce((s, a) => s + Number(a.current_enterprise_arr || 0), 0),
          openPipelineDeals: this.deals.length,
          openPipelineValue: this.deals.reduce((s, d) => s + Number(d.amount || 0), 0)
        };
      } catch (e) {
        this.error = e.message || String(e);
      } finally {
        this.loading = false;
      }
    },
    accountsSql() {
      return [
        'SELECT company_name, company_id, root_org_id, current_enterprise_arr, upcoming_renewal_date,',
        '  hs_csm_sentiment AS sentiment, customer_stage AS lifecycle_status, company_owner_name AS ae, csm_owner_name AS csm',
        'FROM \`builder-3b0a2.dbt_staging.hubspot_companies\`',
        'WHERE current_enterprise_arr > 0',
        'ORDER BY current_enterprise_arr DESC'
      ].join('\\n');
    },
    expansionDeals(allDeals, pipelines) {
      return allDeals.filter((d) => {
        const p = d.properties || {};
        const pipe = pipelines.find((x) => x.id === p.pipeline);
        const label = String(pipe?.label || '').toLowerCase();
        const stage = (pipe?.stages || []).find((s) => s.id === p.dealstage);
        const prob = Number(stage?.metadata?.probability || 0);
        return prob > 0 && prob < 1 && label.includes('expansion') && !label.includes('new business');
      }).map((d) => {
        const p = d.properties || {};
        const pipe = pipelines.find((x) => x.id === p.pipeline);
        const stage = (pipe?.stages || []).find((s) => s.id === p.dealstage);
        return {
          id: d.id,
          name: p.dealname || 'Untitled',
          amount: Number(p.amount || 0),
          stage: stage?.label || null,
          pipeline: pipe?.label || null,
          closeDate: p.closedate || null,
          stageProbability: Number(stage?.metadata?.probability || 0),
          ae: p.hubspot_owner_id || null,
          csm: p.customer_success_owner || null
        };
      });
    },
    money(value) {
      const n = Number(value || 0);
      if (Math.abs(n) >= 1000000) return '$' + (n / 1000000).toFixed(2) + 'm';
      if (Math.abs(n) >= 1000) return '$' + Math.round(n / 1000).toLocaleString() + 'k';
      return '$' + Math.round(n).toLocaleString();
    },
    classifyHealth(sentiment) {
      const s = String(sentiment || '').toLowerCase();
      if (s.includes('confirmed churn') || s === 'churned') return 'confirmed_churn';
      if (s.includes('churn risk') || s.includes('at risk')) return 'churn_risk';
      if (s.includes('radar')) return 'on_the_radar';
      if (s.includes('healthy')) return 'healthy';
      return 'unknown';
    },
    calcExpectedNdr(arr, category, percent) {
      if (category === 'churn_risk') return arr * -0.5;
      if (category === 'confirmed_churn') return arr * -1;
      return arr * (percent / 100);
    },
    avgExpansionPercent() {
      return this.qExpansionPercents.reduce((a, b) => a + Number(b), 0) / this.qExpansionPercents.length;
    },
    scenario() {
      const avg = this.avgExpansionPercent();
      const expansionFromExisting = this.accounts.reduce((sum, a) => sum + this.calcExpectedNdr(Number(a.current_enterprise_arr || 0), this.classifyHealth(a.sentiment), avg), 0);
      const pipelineExpected = this.deals.reduce((sum, d) => sum + d.amount * d.stageProbability, 0);
      const totalProjected = expansionFromExisting + pipelineExpected;
      const gap = this.targetARR - totalProjected;
      const attainmentPct = totalProjected / this.targetARR * 100;
      const eligibleArr = this.accounts.filter((a) => !this.classifyHealth(a.sentiment).includes('churn')).reduce((s, a) => s + Number(a.current_enterprise_arr || 0), 0);
      const neededExpansionPct = eligibleArr > 0 ? (this.targetARR - pipelineExpected) / eligibleArr * 100 : 0;
      const neededConversionPct = this.summary.openPipelineValue > 0 ? (this.targetARR - expansionFromExisting) / this.summary.openPipelineValue * 100 : 0;
      return { expansionFromExisting, pipelineExpected, totalProjected, gap, attainmentPct, neededExpansionPct, neededConversionPct };
    },
    quarterWindows: [
      { label: 'Q1 (Feb-Apr 2026)', start: '2026-02-01', end: '2026-04-30' },
      { label: 'Q2 (May-Jul 2026)', start: '2026-05-01', end: '2026-07-31' },
      { label: 'Q3 (Aug-Oct 2026)', start: '2026-08-01', end: '2026-10-31' },
      { label: 'Q4 (Nov 2026-Jan 2027)', start: '2026-11-01', end: '2027-01-31' }
    ],
    quarterIndex(date) {
      if (!date) return -1;
      const d = new Date(date);
      return this.quarterWindows.findIndex((q) => d >= new Date(q.start) && d <= new Date(q.end));
    },
    quarterPlan(i) {
      const accounts = this.accounts.filter((a) => this.quarterIndex(a.upcoming_renewal_date) === i);
      const deals = this.deals.filter((d) => this.quarterIndex(d.closeDate) === i && !String(d.pipeline || '').toLowerCase().includes('new business'));
      const expansionPercent = Number(this.qExpansionPercents[i]);
      const expectedRenewals = accounts.reduce((s, a) => s + this.calcExpectedNdr(Number(a.current_enterprise_arr || 0), this.classifyHealth(a.sentiment), expansionPercent), 0);
      const expectedPipeline = deals.reduce((s, d) => s + d.amount * d.stageProbability, 0);
      const expectedRevenue = expectedRenewals + expectedPipeline;
      const gap = Number(this.qTargets[i]) - expectedRevenue;
      return { accounts, deals, expectedRevenue, gap };
    },
    scoredAccounts() {
      const avg = this.avgExpansionPercent();
      return this.accounts.map((a) => {
        const arr = Number(a.current_enterprise_arr || 0);
        const health = this.classifyHealth(a.sentiment);
        let score = arr >= 500000 ? 40 : arr >= 200000 ? 30 : arr >= 100000 ? 20 : 10;
        score += health === 'healthy' ? 30 : health === 'on_the_radar' ? 15 : health === 'unknown' ? 10 : 0;
        const lifecycle = String(a.lifecycle_status || '').toLowerCase();
        score += lifecycle.includes('live') || lifecycle.includes('active') ? 20 : lifecycle.includes('onboarding') ? 10 : 5;
        if (a.upcoming_renewal_date) {
          const months = (new Date(a.upcoming_renewal_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30);
          if (months >= 0 && months <= 6) score += 10;
          else if (months > 6 && months <= 12) score += 5;
        }
        const priority = score >= 75 ? 'Critical' : score >= 60 ? 'High' : score >= 40 ? 'Medium' : 'Low';
        return Object.assign({}, a, { score, health, priority, expectedNdr: this.calcExpectedNdr(arr, health, avg) });
      }).sort((a, b) => b.score - a.score);
    }
  };
}
</script>
<div x-data="expansionAttainmentApp()" x-init="init()" class="space-y-4">
  <p x-show="error" class="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700" x-text="error"></p>
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <template x-for="card in [
      { label: 'Enterprise Accounts', value: Number(summary.enterpriseAccounts || 0).toLocaleString(), sub: 'Active customers' },
      { label: 'Current Total ARR', value: money(summary.totalCurrentARR), sub: 'Existing revenue base' },
      { label: 'Open Pipeline Deals', value: Number(summary.openPipelineDeals || 0).toLocaleString(), sub: 'Expansion pipeline' },
      { label: 'Pipeline Value', value: money(summary.openPipelineValue), sub: 'Potential revenue' }
    ]" :key="card.label">
      <div class="rounded-lg border border-border bg-card p-4"><p class="text-sm text-muted-foreground" x-text="card.label"></p><p class="mt-1 text-2xl font-semibold" x-text="loading ? '...' : card.value"></p><p class="mt-1 text-xs text-muted-foreground" x-text="card.sub"></p></div>
    </template>
  </div>
  <section class="rounded-lg border border-border bg-card p-4">
    <h2 class="mb-4 font-medium">Scenario Parameters</h2>
    <div class="grid gap-4 md:grid-cols-3">
      <label class="space-y-1"><span class="text-xs text-muted-foreground">Total Target ARR</span><input type="number" x-model.number="targetARR" class="w-full rounded-md border border-input bg-background px-3 py-2 text-right" /></label>
      <label class="space-y-1"><span class="text-xs text-muted-foreground">Pipeline Conversion Rate</span><input type="range" min="10" max="70" step="5" x-model.number="pipelineConversionRate" class="w-full" /><span class="block text-right text-sm" x-text="pipelineConversionRate + '%'"></span></label>
      <label class="space-y-1"><span class="text-xs text-muted-foreground">Avg Days to Close</span><input type="number" x-model.number="avgDaysToClose" class="w-full rounded-md border border-input bg-background px-3 py-2 text-right" /></label>
    </div>
    <div class="mt-5 grid gap-4 border-t border-border pt-4 lg:grid-cols-4">
      <template x-for="(q, i) in quarterWindows" :key="q.label">
        <div class="space-y-2"><p class="text-sm font-medium" x-text="q.label"></p><label class="block text-xs text-muted-foreground">ARR Target<input type="number" x-model.number="qTargets[i]" class="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-right text-sm" /></label><label class="block text-xs text-muted-foreground">Expansion %<input type="range" min="5" max="100" step="5" x-model.number="qExpansionPercents[i]" class="mt-1 w-full" /><span class="block text-right text-sm text-foreground" x-text="qExpansionPercents[i] + '%'"></span></label></div>
      </template>
    </div>
    <div class="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4">
      <label class="space-y-1"><span class="text-xs text-muted-foreground">Scenario name</span><input x-model="scenarioName" class="rounded-md border border-input bg-background px-3 py-2" placeholder="Board plan, downside case" /></label>
      <button class="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted" x-on:click="saveScenario()">Save org scenario</button>
      <select class="rounded-md border border-border bg-background px-3 py-2 text-xs" x-on:change="if ($event.target.value) applyScenario(scenarios.find((s) => s.id === $event.target.value))">
        <option value="">Load scenario</option>
        <template x-for="s in scenarios" :key="s.id"><option :value="s.id" x-text="s.name"></option></template>
      </select>
    </div>
  </section>
  <section class="rounded-lg border border-border bg-card p-4">
    <div class="mb-4 flex items-center justify-between"><h2 class="font-medium">Projected Attainment</h2><span class="rounded-full px-2 py-1 text-xs" :class="scenario().attainmentPct >= 100 ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700'" x-text="scenario().attainmentPct.toFixed(1) + '%'"></span></div>
    <div class="grid gap-4 md:grid-cols-3">
      <div><p class="text-sm text-muted-foreground">From Existing Accounts</p><p class="text-2xl font-semibold" x-text="money(scenario().expansionFromExisting)"></p><p class="text-xs text-muted-foreground" x-text="avgExpansionPercent().toFixed(1) + '% avg expansion'"></p></div>
      <div><p class="text-sm text-muted-foreground">From Pipeline</p><p class="text-2xl font-semibold" x-text="money(scenario().pipelineExpected)"></p><p class="text-xs text-muted-foreground">Weighted by deal stage probability</p></div>
      <div><p class="text-sm text-muted-foreground">Total Projected</p><p class="text-2xl font-semibold" x-text="money(scenario().totalProjected)"></p><p class="text-xs text-muted-foreground" x-text="'Gap: ' + money(scenario().gap)"></p></div>
    </div>
    <div class="mt-4 h-2 rounded-full bg-muted"><div class="h-2 rounded-full bg-primary" :style="'width:' + Math.min(100, Math.max(0, scenario().attainmentPct)) + '%'"></div></div>
    <div class="mt-4 grid gap-3 md:grid-cols-3">
      <div class="rounded-lg border border-border p-3"><p class="font-medium">Existing Account Expansion</p><p class="mt-1 text-xs text-muted-foreground" x-text="'Need ' + scenario().neededExpansionPct.toFixed(1) + '% expansion across healthy/radar accounts.'"></p></div>
      <div class="rounded-lg border border-border p-3"><p class="font-medium">Pipeline Conversion</p><p class="mt-1 text-xs text-muted-foreground" x-text="'Need ' + scenario().neededConversionPct.toFixed(1) + '% conversion on open pipeline.'"></p></div>
      <div class="rounded-lg border border-border p-3"><p class="font-medium">Balanced Growth</p><p class="mt-1 text-xs text-muted-foreground" x-text="'Raise expansion and conversion by 30% while focusing quick wins under ' + avgDaysToClose + ' days.'"></p></div>
    </div>
  </section>
  <section class="space-y-3">
    <h2 class="font-medium">Quarterly Execution Plan</h2>
    <template x-for="(q, i) in quarterWindows" :key="q.label">
      <div class="rounded-lg border border-border bg-card p-4">
        <div class="flex flex-wrap items-center justify-between gap-2"><h3 class="font-medium" x-text="q.label + ' (' + qExpansionPercents[i] + '% expansion)'"></h3><span class="text-sm font-semibold" x-text="'Target: ' + money(qTargets[i])"></span></div>
        <div class="mt-3 grid gap-3 sm:grid-cols-4"><div><p class="text-xs text-muted-foreground">Renewing Accounts</p><p class="text-xl font-semibold" x-text="quarterPlan(i).accounts.length"></p></div><div><p class="text-xs text-muted-foreground">Closing Deals</p><p class="text-xl font-semibold" x-text="quarterPlan(i).deals.length"></p></div><div><p class="text-xs text-muted-foreground">Expected Revenue</p><p class="text-xl font-semibold" x-text="money(quarterPlan(i).expectedRevenue)"></p></div><div><p class="text-xs text-muted-foreground">Gap to Target</p><p class="text-xl font-semibold" x-text="quarterPlan(i).gap > 0 ? '-' + money(quarterPlan(i).gap) : 'On Track'"></p></div></div>
        <details class="mt-3 rounded-md border border-border"><summary class="cursor-pointer px-3 py-2 text-xs font-medium">Accounts and deals</summary><pre class="max-h-72 overflow-auto bg-muted p-3 text-xs" x-text="JSON.stringify({ accounts: quarterPlan(i).accounts.slice(0, 20), deals: quarterPlan(i).deals.slice(0, 20) }, null, 2)"></pre></details>
      </div>
    </template>
  </section>
  <section class="rounded-lg border border-border bg-card p-4">
    <div class="mb-3 flex items-center justify-between"><h2 class="font-medium">Account Prioritization</h2><button class="text-xs text-muted-foreground" x-on:click="viewLimit += 25">Show more</button></div>
    <div class="max-h-[560px] overflow-auto">
      <table class="w-full text-xs"><thead class="sticky top-0 bg-card"><tr class="border-b border-border"><th class="py-2 text-left">#</th><th class="py-2 text-left">Company</th><th class="py-2 text-right">Current ARR</th><th class="py-2 text-right">Expected NDR</th><th class="py-2 text-left">Health</th><th class="py-2 text-left">Lifecycle</th><th class="py-2 text-left">Renewal</th><th class="py-2 text-left">Priority</th><th class="py-2 text-right">Score</th></tr></thead>
      <tbody><template x-for="(account, idx) in scoredAccounts().slice(0, viewLimit)" :key="account.company_id"><tr class="border-b border-border/50"><td class="py-1.5" x-text="idx + 1"></td><td class="py-1.5 font-medium" x-text="account.company_name"></td><td class="py-1.5 text-right" x-text="money(account.current_enterprise_arr)"></td><td class="py-1.5 text-right" x-text="money(account.expectedNdr)"></td><td class="py-1.5" x-text="account.health"></td><td class="py-1.5" x-text="account.lifecycle_status || '-'"></td><td class="py-1.5" x-text="account.upcoming_renewal_date || '-'"></td><td class="py-1.5" x-text="account.priority"></td><td class="py-1.5 text-right" x-text="account.score"></td></tr></template></tbody></table>
    </div>
  </section>
</div>`,
  );
}
