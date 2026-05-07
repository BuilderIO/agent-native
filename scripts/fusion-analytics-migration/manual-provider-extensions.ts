function baseExtension(title: string, body: string): string {
  return `<div class="p-4 space-y-4 text-sm text-foreground" x-data="{}">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 class="text-lg font-semibold">${escapeHtml(title)}</h1>
    </div>
  </div>
  ${body}
</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function stripeExtension(): string {
  return baseExtension(
    "Stripe Billing",
    `<script>
      function stripeBillingExtension() {
        return {
          query: '',
          months: 6,
          submittedSearch: '',
          loading: false,
          error: '',
          data: {},
          detectSearchType(value) {
            const trimmed = (value || '').trim();
            if (!trimmed) return '';
            if (trimmed.startsWith('cus_')) return 'Customer ID';
            if (trimmed.includes('@')) return 'Email';
            return 'Name / Root ID / Space ID';
          },
          params(mode) {
            const trimmed = this.submittedSearch.trim();
            const params = { mode, months: Number(this.months || 6) };
            if (trimmed.startsWith('cus_')) params.customerId = trimmed;
            else if (trimmed.includes('@')) params.email = trimmed;
            else params.query = trimmed;
            return params;
          },
          async run() {
            if (!this.query.trim()) return;
            this.loading = true;
            this.error = '';
            this.submittedSearch = this.query.trim();
            this.data = {};
            try {
              const modes = ['billing', 'billing-by-product', 'payment-status', 'refunds', 'subscriptions'];
              const values = await Promise.all(modes.map((mode) => appAction('stripe', this.params(mode))));
              this.data = Object.fromEntries(modes.map((mode, index) => [mode, values[index]]));
            } catch (e) {
              this.error = e.message || String(e);
            } finally {
              this.loading = false;
            }
          },
          customerList() {
            const sources = ['billing', 'billing-by-product', 'payment-status', 'refunds', 'subscriptions'];
            for (const source of sources) {
              const customers = this.data[source]?.customers;
              if (Array.isArray(customers) && customers.length) return customers;
            }
            return [];
          },
          activeSubscriptions() {
            return this.data.subscriptions?.subscriptions || [];
          },
          invoices() {
            return this.data.billing?.invoices || [];
          },
          products() {
            return this.data['billing-by-product']?.products || [];
          },
          refunds() {
            return this.data.refunds?.refunds || [];
          },
          charges() {
            return this.data['payment-status']?.charges || [];
          },
          failedIntents() {
            return (this.data['payment-status']?.paymentIntents || []).filter((intent) => intent.last_payment_error || intent.status === 'requires_payment_method');
          },
          arrEstimate() {
            let total = 0;
            for (const sub of this.activeSubscriptions()) {
              for (const item of sub.items?.data || []) {
                const amount = Number(item.price?.unit_amount || 0) * Number(item.quantity || 1);
                const interval = item.price?.recurring?.interval || 'month';
                const count = Number(item.price?.recurring?.interval_count || 1);
                const multiplier = interval === 'year' ? 1 / count : interval === 'month' ? 12 / count : interval === 'week' ? 52 / count : interval === 'day' ? 365 / count : 0;
                total += amount * multiplier;
              }
            }
            return total ? total / 100 : null;
          },
          moneyCents(value, currency) {
            return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format(Number(value || 0) / 100);
          },
          money(value) {
            if (value == null) return 'No ARR data';
            return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value || 0));
          },
          date(seconds) {
            if (!seconds) return '-';
            return new Date(Number(seconds) * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
          },
          statusClass(status) {
            const value = String(status || '').toLowerCase();
            if (['active', 'paid', 'succeeded', 'trialing'].includes(value)) return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500';
            if (['open', 'pending', 'processing'].includes(value)) return 'border-blue-500/30 bg-blue-500/10 text-blue-500';
            if (['past_due', 'requires_payment_method', 'requires_action', 'incomplete'].includes(value)) return 'border-amber-500/30 bg-amber-500/10 text-amber-500';
            if (['failed', 'canceled', 'unpaid', 'void', 'uncollectible'].includes(value)) return 'border-red-500/30 bg-red-500/10 text-red-500';
            return 'border-border bg-muted text-muted-foreground';
          },
          reason(reason) {
            if (reason === 'requested_by_customer') return 'Customer request';
            if (reason === 'duplicate') return 'Duplicate';
            if (reason === 'fraudulent') return 'Fraudulent';
            return reason || '-';
          },
          lineItems(invoice) {
            return invoice?.lines?.data || [];
          }
        };
      }
    </script>
    <div x-data="stripeBillingExtension()" class="space-y-4">
      <section class="rounded-lg border bg-card p-4">
        <div class="flex flex-wrap items-center gap-3">
          <div class="relative min-w-72 flex-1">
            <input x-model="query" x-on:keydown.enter="run()" class="w-full rounded-md border bg-background px-3 py-2 pr-36 text-sm" placeholder="Search by email, name, customer ID, root ID, or space ID" />
            <span x-show="detectSearchType(query)" class="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-500" x-text="detectSearchType(query)"></span>
          </div>
          <label class="flex items-center gap-2 text-xs text-muted-foreground">
            Last
            <input x-model.number="months" type="number" min="1" max="60" class="w-20 rounded-md border bg-background px-2 py-2 text-center text-sm text-foreground" />
            months
          </label>
          <button class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" x-bind:disabled="!query.trim() || loading" x-on:click="run()">Look Up</button>
        </div>
        <p class="mt-2 text-xs text-muted-foreground">Examples: john@example.com, Jane Smith, cus_ABC123, root_12345, or space_67890.</p>
      </section>

      <p x-show="loading" class="rounded-md border bg-muted/40 p-3 text-muted-foreground">Loading all Stripe sections...</p>
      <p x-show="error" x-text="error" class="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-red-500"></p>

      <template x-if="submittedSearch && !loading && !error">
        <div class="space-y-4">
          <div x-show="customerList().length" class="flex flex-wrap gap-2 px-1 text-xs text-muted-foreground">
            <span>Customer:</span>
            <template x-for="customer in customerList()" :key="customer.id">
              <span class="rounded-full border bg-muted px-2 py-0.5"><span class="font-medium text-foreground" x-text="customer.name || customer.email || customer.id"></span> <span class="font-mono" x-text="'(' + customer.id + ')'"></span></span>
            </template>
          </div>

          <section class="rounded-lg border bg-card p-4">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-xs text-muted-foreground">Active ARR Estimate</p>
                <p class="text-2xl font-semibold text-blue-500" x-text="money(arrEstimate())"></p>
              </div>
              <div class="text-right text-xs text-muted-foreground">
                <p x-text="activeSubscriptions().length + ' active subscriptions'"></p>
                <p>Computed from active subscription item prices</p>
              </div>
            </div>
          </section>

          <section class="rounded-lg border bg-card">
            <div class="border-b p-4">
              <h2 class="font-semibold">Active Stripe Subscriptions <span class="text-xs font-normal text-muted-foreground" x-text="'(' + activeSubscriptions().length + ')'"></span></h2>
            </div>
            <div class="space-y-2 p-4">
              <p x-show="!activeSubscriptions().length" class="py-6 text-center text-sm text-muted-foreground">No active subscriptions found.</p>
              <template x-for="sub in activeSubscriptions()" :key="sub.id">
                <div class="rounded-md border p-3">
                  <div class="flex items-start justify-between gap-3">
                    <div class="space-y-2">
                      <template x-for="item in (sub.items?.data || [])" :key="item.id">
                        <div>
                          <p class="font-medium" x-text="item.price?.nickname || item.price?.productName || item.price?.product || item.id"></p>
                          <p class="text-xs text-muted-foreground"><span x-text="item.price?.unit_amount != null ? moneyCents(Number(item.price.unit_amount) * Number(item.quantity || 1), item.price.currency) : 'Custom pricing'"></span> <span x-show="item.price?.recurring" x-text="'/ ' + ((item.price.recurring.interval_count || 1) > 1 ? item.price.recurring.interval_count + ' ' : '') + item.price.recurring.interval + ((item.price.recurring.interval_count || 1) > 1 ? 's' : '')"></span></p>
                        </div>
                      </template>
                    </div>
                    <span class="shrink-0 rounded-full border px-2 py-0.5 text-[10px]" x-bind:class="statusClass(sub.status)" x-text="String(sub.status || 'unknown').replace(/_/g, ' ')"></span>
                  </div>
                  <p class="mt-2 text-[11px] text-muted-foreground">Period: <span x-text="date(sub.current_period_start)"></span> - <span x-text="date(sub.current_period_end)"></span> <span x-show="sub.cancel_at_period_end" class="text-amber-500" x-text="' cancels ' + date(sub.current_period_end)"></span></p>
                </div>
              </template>
            </div>
          </section>

          <section class="rounded-lg border bg-card">
            <div class="border-b p-4">
              <h2 class="font-semibold">Payment Status</h2>
            </div>
            <div class="space-y-3 p-4">
              <div x-show="failedIntents().length" class="space-y-2">
                <p class="text-xs font-semibold uppercase tracking-wide text-red-500">Failed / Action Required</p>
                <template x-for="intent in failedIntents()" :key="intent.id">
                  <div class="rounded-md border border-red-500/30 bg-red-500/5 p-3">
                    <div class="flex items-start justify-between gap-3">
                      <div>
                        <p class="font-medium" x-text="moneyCents(intent.amount, intent.currency)"></p>
                        <p class="text-xs text-muted-foreground" x-text="date(intent.created)"></p>
                        <p class="text-xs text-red-500" x-show="intent.last_payment_error" x-text="intent.last_payment_error?.message"></p>
                      </div>
                      <span class="rounded-full border px-2 py-0.5 text-[10px]" x-bind:class="statusClass(intent.status)" x-text="String(intent.status || '').replace(/_/g, ' ')"></span>
                    </div>
                  </div>
                </template>
              </div>
              <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent Charges</p>
              <p x-show="!charges().length" class="py-6 text-center text-sm text-muted-foreground">No recent payments found.</p>
              <template x-for="charge in charges().slice(0, 15)" :key="charge.id">
                <div class="rounded-md border p-3">
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <p class="font-medium" x-text="moneyCents(charge.amount, charge.currency)"></p>
                      <p class="text-xs text-muted-foreground"><span x-text="date(charge.created)"></span> <span x-show="charge.description" x-text="' - ' + charge.description"></span></p>
                      <p x-show="charge.failure_message" class="text-xs text-red-500" x-text="charge.failure_message"></p>
                    </div>
                    <div class="flex flex-wrap justify-end gap-2">
                      <span x-show="charge.refunded" class="rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-500">refunded</span>
                      <span class="rounded-full border px-2 py-0.5 text-[10px]" x-bind:class="statusClass(charge.status)" x-text="charge.status"></span>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </section>

          <section class="rounded-lg border bg-card">
            <div class="border-b p-4">
              <h2 class="font-semibold">Invoice History <span class="text-xs font-normal text-muted-foreground" x-text="'(' + invoices().length + ' invoices, last ' + months + ' months)'"></span></h2>
            </div>
            <div class="max-h-[620px] space-y-3 overflow-auto p-4">
              <p x-show="!invoices().length" class="py-6 text-center text-sm text-muted-foreground">No invoices found for this timeframe.</p>
              <template x-for="invoice in invoices()" :key="invoice.id">
                <div class="rounded-md border p-3">
                  <div class="mb-3 flex items-start justify-between gap-3 border-b pb-3">
                    <div>
                      <p class="font-mono text-xs font-medium" x-text="invoice.number || String(invoice.id || '').slice(0, 12)"></p>
                      <p class="text-xs text-muted-foreground" x-text="date(invoice.created)"></p>
                    </div>
                    <div class="text-right">
                      <span class="rounded-full border px-2 py-0.5 text-[10px]" x-bind:class="statusClass(invoice.status)" x-text="invoice.status || 'unknown'"></span>
                      <p class="mt-1 font-semibold" x-text="moneyCents(invoice.amount_due, invoice.currency)"></p>
                    </div>
                  </div>
                  <div class="overflow-auto">
                    <table class="w-full min-w-[760px] text-xs">
                      <thead class="text-muted-foreground">
                        <tr><th class="px-2 py-1 text-left">Description</th><th class="px-2 py-1 text-center">Start</th><th class="px-2 py-1 text-center">End</th><th class="px-2 py-1 text-right">Qty</th><th class="px-2 py-1 text-right">Unit Cost</th><th class="px-2 py-1 text-right">Amount</th></tr>
                      </thead>
                      <tbody>
                        <template x-for="(line, index) in lineItems(invoice)" :key="index">
                          <tr class="border-t">
                            <td class="px-2 py-2" x-text="line.description || '-'"></td>
                            <td class="px-2 py-2 text-center text-muted-foreground" x-text="date(line.period?.start)"></td>
                            <td class="px-2 py-2 text-center text-muted-foreground" x-text="date(line.period?.end)"></td>
                            <td class="px-2 py-2 text-right" x-text="line.quantity || 1"></td>
                            <td class="px-2 py-2 text-right text-muted-foreground" x-text="moneyCents(Number(line.amount || 0) / Number(line.quantity || 1), line.currency)"></td>
                            <td class="px-2 py-2 text-right font-medium" x-text="moneyCents(line.amount, line.currency)"></td>
                          </tr>
                        </template>
                      </tbody>
                    </table>
                  </div>
                </div>
              </template>
            </div>
          </section>

          <section class="rounded-lg border bg-card">
            <div class="border-b p-4">
              <h2 class="font-semibold">Billing by Product <span class="text-xs font-normal text-muted-foreground" x-text="'(' + products().length + ' products)'"></span></h2>
            </div>
            <div class="overflow-auto p-4">
              <table class="w-full min-w-[720px] text-xs">
                <thead class="bg-muted text-muted-foreground"><tr><th class="px-3 py-2 text-left">Product</th><th class="px-3 py-2 text-left">Category</th><th class="px-3 py-2 text-right">Total Amount</th><th class="px-3 py-2 text-right">Invoices</th><th class="px-3 py-2 text-left">Product ID</th></tr></thead>
                <tbody>
                  <template x-for="product in products()" :key="product.productId">
                    <tr class="border-t"><td class="px-3 py-2 font-medium" x-text="product.productName"></td><td class="px-3 py-2 text-muted-foreground" x-text="product.productCategory"></td><td class="px-3 py-2 text-right font-semibold" x-text="moneyCents(product.totalAmount, product.currency)"></td><td class="px-3 py-2 text-right text-muted-foreground" x-text="product.invoiceCount"></td><td class="px-3 py-2 font-mono text-[10px] text-muted-foreground" x-text="product.productId"></td></tr>
                  </template>
                </tbody>
              </table>
              <p x-show="!products().length" class="py-6 text-center text-sm text-muted-foreground">No product billing data found.</p>
            </div>
          </section>

          <section class="rounded-lg border bg-card">
            <div class="border-b p-4">
              <h2 class="font-semibold">Refund Status <span class="text-xs font-normal text-muted-foreground" x-text="'(' + refunds().length + ' refunds)'"></span></h2>
            </div>
            <div class="overflow-auto p-4">
              <table class="w-full min-w-[640px] text-xs">
                <thead class="bg-muted text-muted-foreground"><tr><th class="px-3 py-2 text-left">Date</th><th class="px-3 py-2 text-left">Refund ID</th><th class="px-3 py-2 text-right">Amount</th><th class="px-3 py-2 text-left">Reason</th><th class="px-3 py-2 text-left">Status</th></tr></thead>
                <tbody>
                  <template x-for="refund in refunds()" :key="refund.id">
                    <tr class="border-t"><td class="px-3 py-2 text-muted-foreground" x-text="date(refund.created)"></td><td class="px-3 py-2 font-mono" x-text="String(refund.id || '').slice(0, 18)"></td><td class="px-3 py-2 text-right font-medium" x-text="moneyCents(refund.amount, refund.currency)"></td><td class="px-3 py-2" x-text="reason(refund.reason)"></td><td class="px-3 py-2"><span class="rounded-full border px-2 py-0.5 text-[10px]" x-bind:class="statusClass(refund.status)" x-text="refund.status"></span></td></tr>
                  </template>
                </tbody>
              </table>
              <p x-show="!refunds().length" class="py-6 text-center text-sm text-muted-foreground">No refunds found for this customer.</p>
            </div>
          </section>
        </div>
      </template>

      <div x-show="!submittedSearch && !loading" class="py-12 text-center text-sm text-muted-foreground">
        Search by email, name, customer ID, root ID, or space ID to see customer Stripe data.
      </div>
    </div>`,
  );
}

export function slackExtension(): string {
  return baseExtension(
    "Slack Feedback",
    `<script>
      function slackFeedbackExtension() {
        return {
          workspace: 'primary',
          loading: false,
          error: '',
          team: null,
          channels: [],
          channelSearch: '',
          selected: [],
          defaults: ['product-suggestions-from-app', 'product-feedback-cancellation-and-upgrade-form'],
          filterChips: ['bug', 'issue', 'broken', 'error', 'feedback', 'request'],
          activeChips: [],
          query: '',
          messages: [],
          users: {},
          page: 0,
          hasNextPage: false,
          cursorStack: [{}],
          async init() {
            await this.loadTeamAndChannels();
          },
          async loadTeamAndChannels() {
            this.loading = true;
            this.error = '';
            try {
              const [teamData, channelData] = await Promise.all([
                appAction('slack-messages', { mode: 'team', workspace: this.workspace }),
                appAction('slack-messages', { mode: 'channels', workspace: this.workspace })
              ]);
              this.team = teamData.team;
              this.channels = channelData.channels || [];
              this.selected = this.channels.filter((channel) => this.defaults.includes(channel.name)).map((channel) => ({ id: channel.id, name: channel.name }));
              if (this.selected.length) await this.loadHistory(true);
            } catch (e) {
              this.error = e.message || String(e);
            } finally {
              this.loading = false;
            }
          },
          filteredChannels() {
            const q = this.channelSearch.trim().toLowerCase();
            if (!q) return this.channels;
            return this.channels.filter((channel) => channel.name.toLowerCase().includes(q) || (channel.topic?.value || '').toLowerCase().includes(q) || (channel.purpose?.value || '').toLowerCase().includes(q));
          },
          isSelected(id) {
            return this.selected.some((channel) => channel.id === id);
          },
          toggleChannel(channel) {
            if (this.isSelected(channel.id)) this.selected = this.selected.filter((item) => item.id !== channel.id);
            else this.selected = [...this.selected, { id: channel.id, name: channel.name }];
            this.query = '';
            this.activeChips = [];
            this.cursorStack = [{}];
            this.page = 0;
            this.loadHistory(true);
          },
          toggleChip(chip) {
            if (this.activeChips.includes(chip)) this.activeChips = this.activeChips.filter((item) => item !== chip);
            else this.activeChips = [...this.activeChips, chip];
          },
          async refresh() {
            await this.loadTeamAndChannels();
          },
          async loadHistory(reset) {
            if (!this.selected.length) {
              this.messages = [];
              return;
            }
            if (reset) {
              this.cursorStack = [{}];
              this.page = 0;
            }
            this.loading = true;
            this.error = '';
            try {
              const cursors = this.cursorStack[this.page] || {};
              const data = await appAction('slack-messages', {
                mode: 'multi-history',
                workspace: this.workspace,
                channels: this.selected.map((channel) => channel.id).join(','),
                names: this.selected.map((channel) => channel.name).join(','),
                limit: 20,
                cursors
              });
              this.messages = data.messages || [];
              this.users = data.users || {};
              this.hasNextPage = !!data.has_more;
              this.nextCursors = data.next_cursors || {};
            } catch (e) {
              this.error = e.message || String(e);
            } finally {
              this.loading = false;
            }
          },
          async search() {
            if (this.query.trim().length < 2) {
              await this.loadHistory(true);
              return;
            }
            this.loading = true;
            this.error = '';
            try {
              const data = await appAction('slack-messages', { mode: 'search', workspace: this.workspace, query: this.query.trim(), limit: 50 });
              this.messages = data.messages || [];
              this.users = data.users || {};
              this.hasNextPage = false;
              this.page = 0;
            } catch (e) {
              this.error = e.message || String(e);
            } finally {
              this.loading = false;
            }
          },
          nextPage() {
            if (!this.hasNextPage) return;
            this.cursorStack = this.cursorStack.slice(0, this.page + 1).concat([this.nextCursors || {}]);
            this.page += 1;
            this.loadHistory(false);
          },
          prevPage() {
            if (this.page <= 0) return;
            this.page -= 1;
            this.loadHistory(false);
          },
          displayMessages() {
            if (!this.activeChips.length) return this.messages;
            return this.messages.filter((message) => {
              const text = (message.text || '').toLowerCase();
              return this.activeChips.some((chip) => text.includes(chip));
            });
          },
          userFor(message) {
            return this.users?.[message.user] || this.users?.[message.bot_id] || {};
          },
          displayName(message) {
            const user = this.userFor(message);
            return user.profile?.display_name || user.real_name || user.name || message.username || 'Unknown';
          },
          avatar(message) {
            return this.userFor(message).profile?.image_48 || message.icons?.image_48 || '';
          },
          time(ts) {
            return new Date(parseFloat(ts || '0') * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
          },
          cleanText(text) {
            return String(text || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
          },
          analyze() {
            const channelNames = this.selected.map((channel) => '#' + channel.name);
            const channelIds = this.selected.map((channel) => channel.id);
            const message = 'Look at the slack feedback for the last week in ' + channelNames.join(' and ') + '. What are the key trends and have there been any recent spikes of issues?';
            const context = 'The user is viewing the Slack Feedback dashboard. They are on the "' + (this.team?.name || 'Builder Internal') + '" workspace, channels: ' + this.selected.map((channel, index) => '#' + channel.name + ' (ID: ' + channelIds[index] + ')').join(', ') + '. Use the slack-messages action with mode=multi-history or mode=search to fetch and analyze messages.';
            window.parent.postMessage({ type: 'agentNative.submitChat', data: { message, context, submit: true } }, '*');
          }
        };
      }
    </script>
    <div x-data="slackFeedbackExtension()" x-init="init()" class="space-y-5">
      <div class="flex flex-wrap items-center gap-3">
        <span class="rounded-md border bg-card px-3 py-1.5 text-xs font-medium" x-text="team?.name || 'Builder Internal'"></span>
        <button class="rounded-md border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground" x-on:click="refresh()">Refresh</button>
        <button x-show="selected.length" class="ml-auto rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground" x-on:click="analyze()">Analyze Feedback</button>
      </div>

      <section class="rounded-lg border bg-card p-3">
        <div class="grid gap-3 lg:grid-cols-[320px_1fr]">
          <div class="space-y-2">
            <input x-model="channelSearch" class="w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="Search channels..." />
            <div class="max-h-72 overflow-auto rounded-md border">
              <template x-for="channel in filteredChannels()" :key="channel.id">
                <button class="flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left text-xs last:border-b-0 hover:bg-muted" x-bind:class="isSelected(channel.id) ? 'bg-primary/10 text-primary' : ''" x-on:click="toggleChannel(channel)">
                  <span class="truncate" x-text="'#' + channel.name"></span>
                  <span class="shrink-0 text-[10px] text-muted-foreground" x-text="(channel.num_members || 0) + ' members'"></span>
                </button>
              </template>
            </div>
          </div>
          <div class="space-y-3">
            <div class="flex flex-wrap gap-2">
              <template x-for="channel in selected" :key="channel.id">
                <button class="rounded-full bg-muted px-2.5 py-1 text-xs" x-on:click="toggleChannel(channel)" x-text="'#' + channel.name + ' x'"></button>
              </template>
              <p x-show="!selected.length" class="text-sm text-muted-foreground">Select one or more channels to view feedback.</p>
            </div>
            <div class="flex gap-2">
              <input x-model="query" x-on:keydown.enter="search()" class="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm" x-bind:placeholder="selected.length ? 'Search selected Slack feedback...' : 'Search Slack...'" />
              <button class="rounded-md border px-3 py-2 text-sm" x-on:click="search()">Search</button>
            </div>
            <div class="flex flex-wrap gap-2">
              <template x-for="chip in filterChips" :key="chip">
                <button class="rounded-full border px-3 py-1 text-xs font-medium" x-bind:class="activeChips.includes(chip) ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'" x-on:click="toggleChip(chip)" x-text="chip"></button>
              </template>
              <button x-show="activeChips.length" class="text-xs text-muted-foreground underline" x-on:click="activeChips = []">Clear filters</button>
            </div>
          </div>
        </div>
      </section>

      <p x-show="loading" class="rounded-md border bg-muted/40 p-3 text-muted-foreground">Loading Slack messages...</p>
      <p x-show="error" x-text="error" class="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-red-500"></p>

      <div x-show="!loading && !error && selected.length" class="text-xs text-muted-foreground">
        <span x-text="displayMessages().length + ' messages on this page'"></span>
        <span x-show="query.trim().length >= 2"> (search results)</span>
        <span x-show="activeChips.length" x-text="' filtered by: ' + activeChips.join(', ')"></span>
      </div>

      <div class="space-y-3">
        <template x-for="message in displayMessages()" :key="message.ts">
          <article class="rounded-lg border bg-card p-4">
            <div class="mb-2 flex items-center gap-3">
              <img x-show="avatar(message)" x-bind:src="avatar(message)" class="h-8 w-8 rounded-full" alt="" />
              <div x-show="!avatar(message)" class="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary" x-text="displayName(message).charAt(0).toUpperCase()"></div>
              <div class="min-w-0 flex-1">
                <span class="font-medium" x-text="displayName(message)"></span>
                <span class="ml-2 text-xs text-muted-foreground" x-text="time(message.ts)"></span>
              </div>
              <span x-show="message.channel_name" class="text-[11px] text-muted-foreground" x-text="'#' + message.channel_name"></span>
            </div>
            <p class="whitespace-pre-wrap text-sm leading-relaxed" x-text="cleanText(message.text)"></p>
            <div class="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span x-show="message.reply_count" x-text="message.reply_count + (message.reply_count === 1 ? ' reply' : ' replies')"></span>
              <template x-for="reaction in (message.reactions || [])" :key="reaction.name">
                <span class="rounded-full bg-muted px-2 py-0.5" x-text="':' + reaction.name + ': ' + reaction.count"></span>
              </template>
            </div>
          </article>
        </template>
      </div>

      <div x-show="!loading && selected.length && !displayMessages().length" class="py-10 text-center text-sm text-muted-foreground">No messages match the current view.</div>
      <div x-show="!query.trim() && (page > 0 || hasNextPage)" class="flex items-center justify-between">
        <button class="rounded-md border bg-card px-3 py-1.5 text-xs disabled:opacity-40" x-bind:disabled="page <= 0" x-on:click="prevPage()">Previous</button>
        <span class="text-xs text-muted-foreground" x-text="'Page ' + (page + 1)"></span>
        <button class="rounded-md border bg-card px-3 py-1.5 text-xs disabled:opacity-40" x-bind:disabled="!hasNextPage" x-on:click="nextPage()">Next</button>
      </div>
    </div>`,
  );
}

export function dbtExtension(): string {
  return baseExtension(
    "dbt Model Workspace",
    `<script>
      function dbtWorkspaceExtension() {
        return {
          tab: 'files',
          selectedFile: 'models/mart/subscription_ai_usage.sql',
          saved: [],
          result: null,
          error: '',
          loading: false,
          models: [
            { path: 'models/mart/subscription_ai_usage.sql', name: 'subscription_ai_usage', isNew: true },
            { path: 'models/mart/dim_subscriptions.sql', name: 'dim_subscriptions' },
            { path: 'models/mart/dim_organizations.sql', name: 'dim_organizations' },
            { path: 'models/staging/stripe_subscriptions.sql', name: 'stripe_subscriptions' },
            { path: 'models/intermediate/stripe_arr_from_events.sql', name: 'stripe_arr_from_events' }
          ],
          readData(row) {
            let value = row ? row.data : null;
            if (typeof value === 'string') {
              try { value = JSON.parse(value); } catch (e) {}
            }
            if (value && value.value !== undefined) return value.value;
            if (value && value.data && value.data.value !== undefined) return value.data.value;
            if (value && value.data !== undefined) return value.data;
            return value || {};
          },
          modelSql: '',
          testSql: '',
          async init() {
            this.seedSql();
            await this.loadSaved();
          },
          seedSql() {
            this.modelSql = [
              '{{ config(',
              '    schema="dbt_mart",',
              '    materialized="table",',
              '    tags=["hourly", "analytics"]',
              ') }}',
              '',
              'WITH subscriptions AS (',
              '  SELECT subscription_id, root_id, space_id, start_date, stripe_actual_canceled_at, stripe_scheduled_cancel_at, status, plan, subscription_arr',
              "  FROM {{ ref('dim_subscriptions') }}",
              "  WHERE plan = 'Self-serve'",
              '), organizations AS (',
              '  SELECT root_id, org_id AS space_id, subscription_name, type, kind, root_org_id, created_date AS space_created_date',
              "  FROM {{ ref('dim_organizations') }}",
              '), users AS (',
              '  SELECT user_id, email, created_date AS user_created_date',
              "  FROM {{ ref('dim_users_core') }}",
              '), ai_usage AS (',
              '  SELECT',
              '    s.subscription_id, s.root_id, s.start_date, s.stripe_actual_canceled_at, s.stripe_scheduled_cancel_at, s.status, s.plan, s.subscription_arr,',
              '    o.space_id, o.subscription_name, o.type AS org_type, o.kind AS org_kind, o.root_org_id, o.space_created_date,',
              '    u.email AS user_email, u.user_created_date,',
              '    c.request_id AS credit_usage_id, c.timestamp AS usage_timestamp, CAST(JSON_VALUE(c.meta, "$.promptCreditsUsed") AS FLOAT64) AS credits_used,',
              '    c.user_id, c.organization_id, JSON_VALUE(c.meta, "$.model") AS model, JSON_VALUE(c.meta, "$.inputTokens") AS input_tokens, JSON_VALUE(c.meta, "$.outputTokens") AS output_tokens,',
              '    TIMESTAMP_DIFF(c.timestamp, s.start_date, DAY) AS days_since_subscription,',
              "    CASE WHEN c.timestamp < s.start_date THEN 'Before Subscription' WHEN c.timestamp <= TIMESTAMP_ADD(s.start_date, INTERVAL 7 DAY) THEN 'Week 1' WHEN c.timestamp <= TIMESTAMP_ADD(s.start_date, INTERVAL 30 DAY) THEN 'Week 2-4' ELSE 'After 30 Days' END AS usage_period",
              '  FROM subscriptions s',
              '  LEFT JOIN organizations o ON s.root_id = o.root_id',
              "  LEFT JOIN {{ source('logs', 'ai_credits_usage') }} c ON c.orgId = o.space_id",
              '  LEFT JOIN users u ON c.userId = u.user_id',
              "  WHERE c.timestamp >= '2025-01-05'",
              ')',
              'SELECT * FROM ai_usage',
              'WHERE usage_timestamp IS NOT NULL'
            ].join('\\n');
            this.testSql = [
              '-- Test subscription_ai_usage with recent self-serve subscriptions',
              'WITH recent_subs AS (',
              '  SELECT subscription_id, root_id, start_date, status, subscription_arr',
              '  FROM \`builder-3b0a2.dbt_mart.dim_subscriptions\`',
              "  WHERE plan = 'Self-serve'",
              '    AND start_date >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 60 DAY)',
              '  LIMIT 5',
              '), organizations AS (',
              '  SELECT root_id, org_id AS space_id, subscription_name, type, kind, created_date AS space_created_date',
              '  FROM \`builder-3b0a2.dbt_mart.dim_organizations\`',
              '), users AS (',
              '  SELECT user_id, email, created_date AS user_created_date',
              '  FROM \`builder-3b0a2.dbt_mart.dim_users_core\`',
              '), ai_usage_detail AS (',
              '  SELECT s.subscription_id, DATE(s.start_date) AS sub_start, o.space_id, o.subscription_name, u.email, DATE(c.timestamp) AS usage_date,',
              '    TIMESTAMP_DIFF(c.timestamp, s.start_date, DAY) AS days_since_sub,',
              '    ROUND(CAST(JSON_VALUE(c.meta, "$.promptCreditsUsed") AS FLOAT64), 3) AS credits,',
              '    JSON_VALUE(c.meta, "$.model") AS model, JSON_VALUE(c.meta, "$.inputTokens") AS input_tokens, JSON_VALUE(c.meta, "$.outputTokens") AS output_tokens, JSON_VALUE(c.meta, "$.hasError") AS has_error',
              '  FROM recent_subs s',
              '  LEFT JOIN organizations o ON s.root_id = o.root_id',
              '  LEFT JOIN \`builder-3b0a2.logs.ai_credits_usage\` c ON c.organization_id = o.space_id AND c.timestamp >= "2025-01-05"',
              '  LEFT JOIN users u ON c.user_id = u.user_id',
              '  WHERE c.timestamp IS NOT NULL',
              '  LIMIT 100',
              ')',
              'SELECT * FROM ai_usage_detail ORDER BY subscription_id, usage_date'
            ].join('\\n');
          },
          async loadSaved() {
            this.saved = await extensionData.list('models', { scope: 'org' });
          },
          selectModel(model) {
            this.selectedFile = model.path || 'new';
            if (model.path === 'models/mart/subscription_ai_usage.sql') {
              this.seedSql();
              return;
            }
            this.modelSql = '-- ' + model.name + '.sql\\n-- Loading from ' + model.path + '\\n\\nSELECT * FROM \`builder-3b0a2.dbt_mart.' + model.name + '\` LIMIT 10';
            this.testSql = 'SELECT * FROM \`builder-3b0a2.dbt_mart.' + model.name + '\` LIMIT 10';
          },
          async saveSnippet() {
            const id = this.selectedFile === 'new' ? String(Date.now()) : this.selectedFile;
            await extensionData.set('models', id, { name: id, sql: this.modelSql, testSql: this.testSql, updatedAt: new Date().toISOString() }, { scope: 'org' });
            await this.loadSaved();
          },
          async restoreSnippet(row) {
            const value = this.readData(row);
            this.selectedFile = value.name || row.itemId || 'saved';
            this.modelSql = value.sql || '';
            this.testSql = value.testSql || value.sql || '';
          },
          async runSql(sql) {
            if (!sql.trim()) return;
            this.loading = true;
            this.error = '';
            this.result = null;
            try {
              this.result = await appAction('bigquery', { sql });
            } catch (e) {
              this.error = e.message || String(e);
            } finally {
              this.loading = false;
              this.tab = 'results';
            }
          },
          columns() {
            const rows = this.result?.rows || [];
            if (!rows.length) return [];
            return Object.keys(rows[0]);
          }
        };
      }
    </script>
    <div x-data="dbtWorkspaceExtension()" x-init="init()" class="space-y-4">
      <div class="flex rounded-md border bg-card p-1">
        <button class="flex-1 rounded px-3 py-1.5 text-xs font-medium" x-bind:class="tab === 'files' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'" x-on:click="tab = 'files'">Files</button>
        <button class="flex-1 rounded px-3 py-1.5 text-xs font-medium" x-bind:class="tab === 'workspace' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'" x-on:click="tab = 'workspace'">Workspace</button>
        <button class="flex-1 rounded px-3 py-1.5 text-xs font-medium" x-bind:class="tab === 'results' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'" x-on:click="tab = 'results'">Results</button>
      </div>

      <div x-show="tab === 'files'" class="grid gap-4 lg:grid-cols-[300px_1fr]">
        <section class="rounded-lg border bg-card p-4">
          <h2 class="mb-3 font-semibold">dbt Models</h2>
          <div class="space-y-1">
            <button class="w-full rounded-md bg-blue-500/10 px-3 py-2 text-left text-sm text-blue-500" x-on:click="selectedFile = 'new'; modelSql = ''; testSql = ''; tab = 'workspace'">New Model</button>
            <template x-for="model in models" :key="model.path">
              <button class="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-xs hover:bg-muted" x-bind:class="selectedFile === model.path ? 'bg-muted font-medium' : ''" x-on:click="selectModel(model); tab = 'workspace'">
                <span class="truncate" x-text="model.name"></span>
                <span x-show="model.isNew" class="rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] text-white">NEW</span>
              </button>
            </template>
          </div>
        </section>
        <section class="rounded-lg border bg-card p-4">
          <h2 class="mb-3 font-semibold">Saved Snippets</h2>
          <div class="space-y-2">
            <template x-for="row in saved" :key="row.itemId || row.id">
              <button class="w-full rounded-md border px-3 py-2 text-left hover:bg-muted" x-on:click="restoreSnippet(row); tab = 'workspace'">
                <p class="font-medium" x-text="row.itemId || row.id"></p>
                <p class="text-xs text-muted-foreground" x-text="(row.data?.updatedAt || row.data?.value?.updatedAt || '')"></p>
              </button>
            </template>
            <p x-show="!saved.length" class="py-8 text-center text-sm text-muted-foreground">No saved dbt snippets yet.</p>
          </div>
        </section>
      </div>

      <div x-show="tab === 'workspace'" class="space-y-4">
        <section class="rounded-lg border bg-card p-4">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 class="font-semibold" x-text="selectedFile === 'new' ? 'New dbt Model' : selectedFile"></h2>
            <div class="flex gap-2">
              <button class="rounded-md border px-3 py-1.5 text-xs" x-on:click="saveSnippet()">Save Snippet</button>
              <button class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground" x-on:click="runSql(modelSql)">Run Model SQL</button>
            </div>
          </div>
          <textarea x-model="modelSql" class="h-[420px] w-full rounded-md border bg-background p-3 font-mono text-xs" placeholder="Write dbt model SQL here"></textarea>
        </section>
        <section class="rounded-lg border bg-card p-4">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h2 class="font-semibold">Test Query</h2>
            <button class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground" x-on:click="runSql(testSql)">Run Test Query</button>
          </div>
          <textarea x-model="testSql" class="h-56 w-full rounded-md border bg-background p-3 font-mono text-xs" placeholder="SELECT * FROM \`builder-3b0a2.dbt_mart.your_model\` LIMIT 10"></textarea>
        </section>
      </div>

      <div x-show="tab === 'results'" class="space-y-3">
        <p x-show="loading" class="rounded-md border bg-muted/40 p-3 text-muted-foreground">Running query...</p>
        <p x-show="error" x-text="error" class="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-red-500"></p>
        <section x-show="result" class="rounded-lg border bg-card">
          <div class="border-b p-4"><h2 class="font-semibold">Query Results</h2></div>
          <div class="overflow-auto p-4">
            <table class="w-full min-w-[720px] text-xs">
              <thead class="bg-muted text-muted-foreground"><tr><template x-for="col in columns()" :key="col"><th class="px-3 py-2 text-left" x-text="col"></th></template></tr></thead>
              <tbody><template x-for="(row, index) in (result?.rows || [])" :key="index"><tr class="border-t"><template x-for="col in columns()" :key="col"><td class="max-w-80 truncate px-3 py-2" x-text="row[col] == null ? '' : String(row[col])"></td></template></tr></template></tbody>
            </table>
            <p x-show="result && !(result.rows || []).length" class="py-8 text-center text-sm text-muted-foreground">No rows returned.</p>
          </div>
        </section>
      </div>
    </div>`,
  );
}

export function queryExplorerExtension(): string {
  return baseExtension(
    "Query Explorer",
    `<script>
      function queryExplorerExtension() {
        return {
          sql: 'SELECT 1 AS ok',
          loading: false,
          error: '',
          result: null,
          history: [],
          async init() {
            this.history = await extensionData.list('query-history', { scope: 'org' });
          },
          async run() {
            if (!this.sql.trim()) return;
            this.loading = true;
            this.error = '';
            this.result = null;
            try {
              const result = await appAction('bigquery', { sql: this.sql });
              this.result = result;
              await extensionData.set('query-history', String(Date.now()), { sql: this.sql, rowCount: (result.rows || []).length, timestamp: Date.now() }, { scope: 'org' });
              await this.init();
            } catch (e) {
              this.error = e.message || String(e);
            } finally {
              this.loading = false;
            }
          },
          async clearHistory() {
            for (const row of this.history) await extensionData.remove('query-history', row.itemId || row.id, { scope: 'org' });
            this.history = [];
          },
          restore(row) {
            const value = row.data?.value || row.data || {};
            this.sql = value.sql || '';
          },
          columns() {
            const rows = this.result?.rows || [];
            if (!rows.length) return [];
            return Object.keys(rows[0]);
          },
          rowData(row) {
            let value = row ? row.data : null;
            if (typeof value === 'string') {
              try { value = JSON.parse(value); } catch (e) {}
            }
            if (value && value.value !== undefined) return value.value;
            if (value && value.data && value.data.value !== undefined) return value.data.value;
            if (value && value.data !== undefined) return value.data;
            return value || {};
          },
          time(value) {
            return value ? new Date(value).toLocaleString() : '';
          }
        };
      }
    </script>
    <div x-data="queryExplorerExtension()" x-init="init()" class="space-y-4">
      <section class="rounded-lg border bg-card p-4">
        <div class="mb-3 flex items-center justify-between gap-3">
          <h2 class="font-semibold">SQL Query</h2>
          <button class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" x-bind:disabled="loading || !sql.trim()" x-on:click="run()">Run BigQuery</button>
        </div>
        <textarea x-model="sql" class="h-72 w-full rounded-md border bg-background p-3 font-mono text-xs"></textarea>
      </section>

      <p x-show="loading" class="rounded-md border bg-muted/40 p-3 text-muted-foreground">Running query...</p>
      <p x-show="error" x-text="error" class="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-red-500"></p>

      <section x-show="result" class="rounded-lg border bg-card">
        <div class="border-b p-4"><h2 class="font-semibold">Query Results</h2></div>
        <div class="overflow-auto p-4">
          <table class="w-full min-w-[720px] text-xs">
            <thead class="bg-muted text-muted-foreground"><tr><template x-for="col in columns()" :key="col"><th class="px-3 py-2 text-left" x-text="col"></th></template></tr></thead>
            <tbody><template x-for="(row, index) in (result?.rows || [])" :key="index"><tr class="border-t"><template x-for="col in columns()" :key="col"><td class="max-w-80 truncate px-3 py-2" x-text="row[col] == null ? '' : String(row[col])"></td></template></tr></template></tbody>
          </table>
          <p x-show="result && !(result.rows || []).length" class="py-8 text-center text-sm text-muted-foreground">No rows returned.</p>
        </div>
      </section>

      <section class="rounded-lg border bg-card">
        <div class="flex items-center justify-between border-b p-4">
          <h2 class="font-semibold">Query History</h2>
          <button x-show="history.length" class="rounded-md border px-3 py-1.5 text-xs text-muted-foreground" x-on:click="clearHistory()">Clear</button>
        </div>
        <div class="space-y-2 p-4">
          <template x-for="row in history.slice().reverse().slice(0, 20)" :key="row.itemId || row.id">
            <button class="w-full rounded-md border p-3 text-left hover:bg-muted" x-on:click="restore(row)">
              <p class="mb-1 text-xs text-muted-foreground"><span x-text="rowData(row).rowCount || 0"></span> rows - <span x-text="time(rowData(row).timestamp)"></span></p>
              <p class="truncate font-mono text-xs" x-text="rowData(row).sql"></p>
            </button>
          </template>
          <p x-show="!history.length" class="py-8 text-center text-sm text-muted-foreground">No query history yet.</p>
        </div>
      </section>
    </div>`,
  );
}

export function sentryExtension(): string {
  return providerDashboardExtension(
    "Sentry Error Health",
    "sentryProviderExtension",
    `return {
      period: '24h',
      search: '',
      project: '',
      projects: [],
      issues: [],
      stats: null,
      loading: false,
      error: '',
      async init() { await this.refresh(); },
      async refresh() {
        this.loading = true; this.error = '';
        try {
          const [projects, issues, stats] = await Promise.all([
            appAction('sentry', { mode: 'projects' }),
            appAction('sentry', { mode: 'issues', project: this.project || undefined, query: this.search || undefined, statsPeriod: this.period }),
            appAction('sentry', { mode: 'stats', statsPeriod: this.period, category: 'error' })
          ]);
          this.projects = projects.projects || [];
          this.issues = issues.issues || [];
          this.stats = stats;
        } catch (e) { this.error = e.message || String(e); }
        finally { this.loading = false; }
      },
      summary() {
        const totalEvents = this.issues.reduce((sum, issue) => sum + Number(issue.count || 0), 0);
        const users = this.issues.reduce((sum, issue) => sum + Number(issue.userCount || 0), 0);
        return { totalEvents, unresolved: this.issues.filter((issue) => issue.status === 'unresolved').length, users };
      },
      byProject() {
        const map = {};
        for (const issue of this.issues) {
          const name = issue.project?.name || issue.project?.slug || 'Unknown';
          map[name] = (map[name] || 0) + Number(issue.count || 0);
        }
        return Object.entries(map).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10);
      },
      byLevel() {
        const map = {};
        for (const issue of this.issues) map[issue.level || 'unknown'] = (map[issue.level || 'unknown'] || 0) + Number(issue.count || 0);
        return Object.entries(map).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
      },
      fmt(n) { return Number(n || 0).toLocaleString(); },
      ago(value) {
        const diff = Date.now() - new Date(value).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return mins + 'm ago';
        const hours = Math.floor(mins / 60);
        if (hours < 24) return hours + 'h ago';
        return Math.floor(hours / 24) + 'd ago';
      }
    };`,
    `<div class="flex flex-wrap items-center gap-3">
      <div class="flex overflow-hidden rounded-md border">
        <template x-for="p in ['1h','24h','7d','14d','30d']" :key="p"><button class="px-3 py-1.5 text-xs font-medium" x-bind:class="period === p ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'" x-on:click="period = p; refresh()" x-text="p"></button></template>
      </div>
      <select x-model="project" x-on:change="refresh()" class="rounded-md border bg-background px-3 py-1.5 text-sm"><option value="">All projects</option><template x-for="p in projects" :key="p.slug"><option x-bind:value="p.slug" x-text="p.name || p.slug"></option></template></select>
      <input x-model="search" x-on:keydown.enter="refresh()" class="rounded-md border bg-background px-3 py-1.5 text-sm" placeholder="Search issues..." />
      <button class="rounded-md border px-3 py-1.5 text-xs" x-on:click="refresh()">Refresh</button>
    </div>
    <div class="grid gap-3 md:grid-cols-4">
      <div class="rounded-lg border bg-card p-4"><p class="text-xs text-muted-foreground">Total Events</p><p class="text-2xl font-semibold" x-text="fmt(summary().totalEvents)"></p></div>
      <div class="rounded-lg border bg-card p-4"><p class="text-xs text-muted-foreground">Unresolved Issues</p><p class="text-2xl font-semibold text-red-500" x-text="fmt(summary().unresolved)"></p></div>
      <div class="rounded-lg border bg-card p-4"><p class="text-xs text-muted-foreground">Users Affected</p><p class="text-2xl font-semibold" x-text="fmt(summary().users)"></p></div>
      <div class="rounded-lg border bg-card p-4"><p class="text-xs text-muted-foreground">Projects</p><p class="text-2xl font-semibold" x-text="fmt(projects.length)"></p></div>
    </div>
    <div class="grid gap-4 lg:grid-cols-2">
      ${barList("Errors by Project", "byProject()", "name", "count")}
      ${barList("Errors by Level", "byLevel()", "name", "count")}
    </div>
    <section class="rounded-lg border bg-card">
      <div class="border-b p-4"><h2 class="font-semibold">Top Issues</h2></div>
      <div class="overflow-auto p-4">
        <table class="w-full min-w-[900px] text-xs">
          <thead class="bg-muted text-muted-foreground"><tr><th class="px-3 py-2 text-left">Issue</th><th class="px-3 py-2 text-left">Level</th><th class="px-3 py-2 text-right">Events</th><th class="px-3 py-2 text-right">Users</th><th class="px-3 py-2 text-left">Last Seen</th></tr></thead>
          <tbody><template x-for="issue in issues" :key="issue.id"><tr class="border-t"><td class="px-3 py-2"><a class="font-medium hover:underline" x-bind:href="issue.permalink" target="_blank" x-text="issue.title"></a><p class="truncate text-muted-foreground" x-text="(issue.project?.name || '') + ' - ' + (issue.culprit || '')"></p></td><td class="px-3 py-2" x-text="issue.level"></td><td class="px-3 py-2 text-right" x-text="fmt(issue.count)"></td><td class="px-3 py-2 text-right" x-text="fmt(issue.userCount)"></td><td class="px-3 py-2" x-text="ago(issue.lastSeen)"></td></tr></template></tbody>
        </table>
      </div>
    </section>`,
  );
}

export function gcloudExtension(): string {
  return providerDashboardExtension(
    "Google Cloud Health",
    "gcloudProviderExtension",
    `return {
      period: '24h',
      serviceType: 'cloud_run',
      service: 'ai-codegen',
      severity: '',
      services: { cloudRun: [], cloudFunctions: [] },
      metrics: {},
      logs: [],
      loading: false,
      error: '',
      async init() { await this.refresh(); },
      metricNames() {
        if (this.serviceType === 'cloud_function') return {
          requests: 'cloudfunctions.googleapis.com/function/execution_count',
          latency: 'cloudfunctions.googleapis.com/function/execution_times',
          instances: 'cloudfunctions.googleapis.com/function/active_instances'
        };
        return {
          requests: 'run.googleapis.com/request_count',
          latency: 'run.googleapis.com/request_latencies',
          instances: 'run.googleapis.com/container/instance_count'
        };
      },
      async refresh() {
        this.loading = true; this.error = '';
        try {
          const names = this.metricNames();
          const calls = [
            appAction('gcloud', { mode: 'services' }),
            appAction('gcloud', { mode: 'logs', service: this.service, serviceType: this.serviceType, severity: this.severity || undefined, limit: this.period === '1h' ? 50 : 100 }),
            appAction('gcloud', { mode: 'metrics', service: this.service, serviceType: this.serviceType, period: this.period, metric: names.requests }),
            appAction('gcloud', { mode: 'metrics', service: this.service, serviceType: this.serviceType, period: this.period, metric: names.latency }),
            appAction('gcloud', { mode: 'metrics', service: this.service, serviceType: this.serviceType, period: this.period, metric: names.instances })
          ];
          const [services, logs, requests, latency, instances] = await Promise.all(calls);
          this.services = services;
          this.logs = logs.entries || [];
          this.metrics = { requests, latency, instances };
        } catch (e) { this.error = e.message || String(e); }
        finally { this.loading = false; }
      },
      serviceList() { return this.serviceType === 'cloud_function' ? (this.services.cloudFunctions || []) : (this.services.cloudRun || []); },
      points(name) { return (this.metrics[name]?.timeSeries || []).flatMap((series) => series.points || []); },
      avg(name) { const p = this.points(name); return p.length ? p.reduce((s, item) => s + Number(item.value || 0), 0) / p.length : null; },
      max(name) { const p = this.points(name); return p.length ? Math.max(...p.map((item) => Number(item.value || 0))) : null; },
      latest(name) { const p = this.points(name); return p.length ? Number(p[p.length - 1].value || 0) : null; },
      chart(name) { return this.points(name).slice(-24).map((point, index) => ({ name: index + 1, count: Number(point.value || 0) })); },
      fmt(n) { return n == null ? '-' : Number(n).toFixed(1); },
      time(value) { return value ? new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }) : ''; },
      message(entry) { return entry.textPayload || entry.jsonPayload?.message || entry.jsonPayload?.msg || JSON.stringify(entry.jsonPayload || {}, null, 2); }
    };`,
    `<div class="flex flex-wrap items-center gap-3">
      <div class="flex overflow-hidden rounded-md border"><template x-for="p in ['1h','6h','24h','7d']" :key="p"><button class="px-3 py-1.5 text-xs font-medium" x-bind:class="period === p ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'" x-on:click="period = p; refresh()" x-text="p"></button></template></div>
      <select x-model="serviceType" x-on:change="refresh()" class="rounded-md border bg-background px-3 py-1.5 text-sm"><option value="cloud_run">Cloud Run</option><option value="cloud_function">Cloud Function</option></select>
      <select x-model="service" x-on:change="refresh()" class="min-w-56 rounded-md border bg-background px-3 py-1.5 text-sm"><template x-for="item in serviceList()" :key="item.name"><option x-bind:value="item.name" x-text="item.name"></option></template></select>
      <select x-model="severity" x-on:change="refresh()" class="rounded-md border bg-background px-3 py-1.5 text-sm"><option value="">All logs</option><option>ERROR</option><option>WARNING</option><option>INFO</option><option>DEBUG</option></select>
      <button class="rounded-md border px-3 py-1.5 text-xs" x-on:click="refresh()">Refresh</button>
    </div>
    <div class="grid gap-3 md:grid-cols-4">
      <div class="rounded-lg border bg-card p-4"><p class="text-xs text-muted-foreground">Avg Request Rate</p><p class="text-2xl font-semibold" x-text="fmt(avg('requests')) + '/s'"></p></div>
      <div class="rounded-lg border bg-card p-4"><p class="text-xs text-muted-foreground">Avg Latency</p><p class="text-2xl font-semibold" x-text="fmt(avg('latency')) + 'ms'"></p></div>
      <div class="rounded-lg border bg-card p-4"><p class="text-xs text-muted-foreground">Max Instances</p><p class="text-2xl font-semibold" x-text="fmt(max('instances'))"></p></div>
      <div class="rounded-lg border bg-card p-4"><p class="text-xs text-muted-foreground">Current Instances</p><p class="text-2xl font-semibold" x-text="fmt(latest('instances'))"></p></div>
    </div>
    <div class="grid gap-4 lg:grid-cols-3">
      ${barList("Requests", "chart('requests')", "name", "count")}
      ${barList("Latency", "chart('latency')", "name", "count")}
      ${barList("Instances", "chart('instances')", "name", "count")}
    </div>
    <section class="rounded-lg border bg-card">
      <div class="border-b p-4"><h2 class="font-semibold">Recent Logs</h2></div>
      <div class="max-h-[520px] overflow-auto">
        <template x-for="entry in logs" :key="entry.insertId">
          <details class="border-b p-3 last:border-b-0">
            <summary class="cursor-pointer text-xs"><span class="inline-block w-36 text-muted-foreground" x-text="time(entry.timestamp)"></span><span class="mr-2 rounded bg-muted px-1.5 py-0.5" x-text="entry.severity"></span><span class="font-mono" x-text="message(entry).split('\\n')[0]"></span></summary>
            <pre class="mt-2 max-h-72 overflow-auto rounded bg-muted p-3 text-xs" x-text="message(entry)"></pre>
          </details>
        </template>
      </div>
    </section>`,
  );
}

export function jiraExtension(): string {
  return providerDashboardExtension(
    "Jira Tickets",
    "jiraProviderExtension",
    `return {
      tab: 'overview',
      days: 30,
      projects: [],
      selectedProjects: [],
      analytics: null,
      issues: [],
      boards: [],
      boardId: '',
      sprints: [],
      jql: 'ORDER BY updated DESC',
      loading: false,
      error: '',
      async init() { await this.refresh(); },
      async refresh() {
        this.loading = true; this.error = '';
        try {
          const [projects, analytics, search, boards] = await Promise.all([
            appAction('jira', { mode: 'projects' }),
            appAction('jira-analytics', { projects: this.selectedProjects.join(','), days: this.days }),
            appAction('jira', { mode: 'search', jql: this.jql, maxResults: 25 }),
            appAction('jira', { mode: 'boards' })
          ]);
          this.projects = projects.projects || [];
          this.analytics = analytics;
          this.issues = search.issues || search.results || [];
          this.boards = boards.boards || [];
        } catch (e) { this.error = e.message || String(e); }
        finally { this.loading = false; }
      },
      toggleProject(key) {
        if (this.selectedProjects.includes(key)) this.selectedProjects = this.selectedProjects.filter((item) => item !== key);
        else this.selectedProjects = [...this.selectedProjects, key];
        this.refresh();
      },
      async loadSprints() {
        if (!this.boardId) return;
        this.loading = true; this.error = '';
        try {
          const data = await appAction('jira', { mode: 'sprints', boardId: Number(this.boardId) });
          this.sprints = data.sprints || [];
        } catch (e) { this.error = e.message || String(e); }
        finally { this.loading = false; }
      },
      byStatus() { return Object.entries(this.analytics?.byStatus || {}).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count); },
      byAssignee() { return (this.analytics?.byAssignee || []).slice(0, 15).map((item) => ({ name: item.name, count: item.count })); },
      createdResolved() { return [{ name: 'Created', count: this.analytics?.createdInPeriod || 0 }, { name: 'Resolved', count: this.analytics?.resolvedInPeriod || 0 }]; },
      fmt(n) { return Number(n || 0).toLocaleString(); },
      field(issue, key) { return issue.fields?.[key] || issue[key] || ''; }
    };`,
    `<div class="flex flex-wrap items-center gap-3">
      <div class="flex overflow-hidden rounded-md border"><template x-for="p in [7,14,30,90]" :key="p"><button class="px-3 py-1.5 text-xs font-medium" x-bind:class="days === p ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'" x-on:click="days = p; refresh()" x-text="p + 'd'"></button></template></div>
      <div class="flex flex-wrap gap-1.5"><button class="rounded-full px-2.5 py-1 text-xs" x-bind:class="!selectedProjects.length ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'" x-on:click="selectedProjects = []; refresh()">All</button><template x-for="project in projects" :key="project.key"><button class="rounded-full px-2.5 py-1 text-xs" x-bind:class="selectedProjects.includes(project.key) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'" x-on:click="toggleProject(project.key)" x-text="project.key"></button></template></div>
    </div>
    <div class="flex rounded-md border bg-card p-1"><template x-for="t in ['overview','search','sprints']" :key="t"><button class="flex-1 rounded px-3 py-1.5 text-xs font-medium capitalize" x-bind:class="tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'" x-on:click="tab = t" x-text="t"></button></template></div>
    <div x-show="tab === 'overview'" class="space-y-4">
      <div class="grid gap-3 md:grid-cols-4">
        <div class="rounded-lg border bg-card p-4"><p class="text-xs text-muted-foreground">Open Issues</p><p class="text-2xl font-semibold" x-text="fmt(analytics?.totalOpen)"></p></div>
        <div class="rounded-lg border bg-card p-4"><p class="text-xs text-muted-foreground">Created</p><p class="text-2xl font-semibold" x-text="fmt(analytics?.createdInPeriod)"></p></div>
        <div class="rounded-lg border bg-card p-4"><p class="text-xs text-muted-foreground">Resolved</p><p class="text-2xl font-semibold text-emerald-500" x-text="fmt(analytics?.resolvedInPeriod)"></p></div>
        <div class="rounded-lg border bg-card p-4"><p class="text-xs text-muted-foreground">Net Change</p><p class="text-2xl font-semibold" x-text="fmt((analytics?.createdInPeriod || 0) - (analytics?.resolvedInPeriod || 0))"></p></div>
      </div>
      <div class="grid gap-4 lg:grid-cols-2">${barList("Open Issues by Status", "byStatus()", "name", "count")}${barList("Created vs Resolved", "createdResolved()", "name", "count")}</div>
      ${barList("Open Issues by Assignee", "byAssignee()", "name", "count")}
    </div>
    <div x-show="tab === 'search'" class="space-y-3">
      <div class="flex gap-2"><input x-model="jql" x-on:keydown.enter="refresh()" class="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 font-mono text-xs" /><button class="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground" x-on:click="refresh()">Search</button></div>
      <div class="overflow-auto rounded-lg border bg-card"><table class="w-full min-w-[860px] text-xs"><thead class="bg-muted text-muted-foreground"><tr><th class="px-3 py-2 text-left">Key</th><th class="px-3 py-2 text-left">Summary</th><th class="px-3 py-2 text-left">Status</th><th class="px-3 py-2 text-left">Assignee</th></tr></thead><tbody><template x-for="issue in issues" :key="issue.key"><tr class="border-t"><td class="px-3 py-2 font-mono" x-text="issue.key"></td><td class="px-3 py-2" x-text="field(issue, 'summary')"></td><td class="px-3 py-2" x-text="field(issue, 'status')?.name || field(issue, 'status')"></td><td class="px-3 py-2" x-text="field(issue, 'assignee')?.displayName || 'Unassigned'"></td></tr></template></tbody></table></div>
    </div>
    <div x-show="tab === 'sprints'" class="space-y-3">
      <div class="flex items-center gap-2"><select x-model="boardId" x-on:change="loadSprints()" class="rounded-md border bg-background px-3 py-2 text-sm"><option value="">Select board</option><template x-for="board in boards" :key="board.id"><option x-bind:value="board.id" x-text="board.name"></option></template></select></div>
      <template x-for="sprint in sprints" :key="sprint.id"><div class="rounded-lg border bg-card p-3"><div class="flex items-center justify-between gap-2"><p class="font-medium" x-text="sprint.name"></p><span class="rounded-full bg-muted px-2 py-0.5 text-xs" x-text="sprint.state"></span></div><p class="mt-1 text-xs text-muted-foreground" x-text="sprint.goal || ''"></p></div></template>
    </div>`,
  );
}

export function fusionEngExtension(): string {
  return providerDashboardExtension(
    "Fusion Engineering",
    "fusionEngProviderExtension",
    `return {
      codegenMode: 'quality-v4',
      environment: 'cloud',
      timeRangeMs: 21600000,
      modelRegex: '.*',
      dashboards: [],
      alerts: null,
      panels: [],
      loading: false,
      error: '',
      async init() { await this.refresh(); },
      range() { const to = Date.now(); return { from: String(to - Number(this.timeRangeMs)), to: String(to) }; },
      queries() {
        return [
          { title: 'Setup Agent', expr: 'sum by(outcome) (increase(projects_proposed_config_total[24h]))' },
          { title: 'Completion Latency p90', expr: 'histogram_quantile(0.9, sum by(le) (rate(vcpcodegen_completion_latency_bucket[1h])))' },
          { title: 'Span Durations p95', expr: 'histogram_quantile(0.95, sum by(le, span) (rate(with_span_duration_bucket[1h])))' },
          { title: 'CodeGen Attempts', expr: 'sum by(mode) (increase(vcpcodegen_total{position="fusion"}[1h]))' },
          { title: 'Codegen Issues', expr: 'sum by(type) (increase(vcpcodegen_code_issue_total{job="ai-codegen", model=~"$AIModel"}[10m]))' },
          { title: 'Machine Pings', expr: 'sum by(region) (increase(projects_remote_machine_total{environment="$environment"}[5m]))' }
        ].map((panel) => ({ ...panel, expr: panel.expr.replaceAll('$AIModel', this.modelRegex).replaceAll('$environment', this.environment).replaceAll('$CodegenMode', this.codegenMode) }));
      },
      async refresh() {
        this.loading = true; this.error = '';
        try {
          const range = this.range();
          const [dashboards, alerts, ...panelResults] = await Promise.all([
            appAction('grafana', { mode: 'dashboards', search: 'Fusion' }),
            appAction('grafana', { mode: 'alerts' }),
            ...this.queries().map((panel, index) => appAction('grafana', {
              mode: 'query',
              datasourceUid: 'grafanacloud-prom',
              from: range.from,
              to: range.to,
              queries: [{ refId: String.fromCharCode(65 + index), expr: panel.expr, range: true, datasource: { uid: 'grafanacloud-prom', type: 'prometheus' } }]
            }))
          ]);
          this.dashboards = dashboards.dashboards || [];
          this.alerts = alerts;
          this.panels = this.queries().map((panel, index) => ({ ...panel, rows: this.frameRows(panelResults[index]) }));
        } catch (e) { this.error = e.message || String(e); }
        finally { this.loading = false; }
      },
      frameRows(response) {
        const rows = [];
        const results = response?.results || {};
        for (const result of Object.values(results)) {
          for (const frame of result.frames || []) {
            const fields = frame.schema?.fields || [];
            const values = frame.data?.values || [];
            for (let i = 1; i < fields.length; i++) {
              const label = Object.values(fields[i].labels || {}).filter(Boolean).join(' / ') || fields[i].name || 'value';
              const series = values[i] || [];
              const latest = series.filter((v) => v != null).slice(-1)[0] || 0;
              rows.push({ name: label, count: Number(latest || 0) });
            }
          }
        }
        return rows.sort((a, b) => b.count - a.count).slice(0, 10);
      },
      fmt(n) { return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
    };`,
    `<div class="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
      <label class="space-y-1 text-xs text-muted-foreground">Mode<select x-model="codegenMode" x-on:change="refresh()" class="block rounded-md border bg-background px-3 py-2 text-sm text-foreground"><option value="quality-v4">quality-v4</option></select></label>
      <label class="space-y-1 text-xs text-muted-foreground">Environment<select x-model="environment" x-on:change="refresh()" class="block rounded-md border bg-background px-3 py-2 text-sm text-foreground"><option value="cloud">cloud</option><option value="cloud-v2">cloud-v2</option></select></label>
      <label class="space-y-1 text-xs text-muted-foreground">Time Range<select x-model.number="timeRangeMs" x-on:change="refresh()" class="block rounded-md border bg-background px-3 py-2 text-sm text-foreground"><option value="3600000">Last 1h</option><option value="10800000">Last 3h</option><option value="21600000">Last 6h</option><option value="43200000">Last 12h</option><option value="86400000">Last 24h</option><option value="604800000">Last 7d</option></select></label>
      <label class="min-w-56 flex-1 space-y-1 text-xs text-muted-foreground">AI Model Regex<input x-model="modelRegex" x-on:keydown.enter="refresh()" class="block w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground" /></label>
      <button class="rounded-md border px-3 py-2 text-xs" x-on:click="refresh()">Refresh</button>
    </div>
    <div class="grid gap-3 md:grid-cols-4">
      <div class="rounded-lg border bg-card p-4"><p class="text-xs text-muted-foreground">Dashboards</p><p class="text-2xl font-semibold" x-text="fmt(dashboards.length)"></p></div>
      <div class="rounded-lg border bg-card p-4"><p class="text-xs text-muted-foreground">Alert Rules</p><p class="text-2xl font-semibold" x-text="fmt(alerts?.totalRules)"></p></div>
      <div class="rounded-lg border bg-card p-4"><p class="text-xs text-muted-foreground">Firing Alerts</p><p class="text-2xl font-semibold text-red-500" x-text="fmt(alerts?.totalFiring)"></p></div>
      <div class="rounded-lg border bg-card p-4"><p class="text-xs text-muted-foreground">Panels Queried</p><p class="text-2xl font-semibold" x-text="fmt(panels.length)"></p></div>
    </div>
    <div class="grid gap-4 lg:grid-cols-2">
      <template x-for="panel in panels" :key="panel.title">
        <section class="rounded-lg border bg-card p-4">
          <h2 class="mb-3 font-semibold" x-text="panel.title"></h2>
          <div class="space-y-2">
            <template x-for="row in panel.rows" :key="row.name">
              <div class="grid grid-cols-[minmax(0,1fr)_80px] items-center gap-3 text-xs">
                <span class="truncate" x-text="row.name"></span>
                <span class="text-right tabular-nums" x-text="fmt(row.count)"></span>
                <div class="col-span-2 h-2 overflow-hidden rounded-full bg-muted"><div class="h-full rounded-full bg-primary" x-bind:style="'width:' + Math.min(100, Math.abs(row.count) / Math.max(1, Math.abs(panel.rows[0]?.count || 1)) * 100) + '%'"></div></div>
              </div>
            </template>
            <p x-show="!panel.rows.length" class="py-8 text-center text-sm text-muted-foreground">No data returned.</p>
          </div>
        </section>
      </template>
    </div>
    <section class="rounded-lg border bg-card">
      <div class="border-b p-4"><h2 class="font-semibold">Grafana Dashboards</h2></div>
      <div class="grid gap-2 p-4 md:grid-cols-2"><template x-for="dashboard in dashboards.slice(0, 12)" :key="dashboard.uid || dashboard.uri"><a class="rounded-md border p-3 hover:bg-muted" x-bind:href="dashboard.url" target="_blank"><p class="font-medium" x-text="dashboard.title"></p><p class="text-xs text-muted-foreground" x-text="dashboard.folderTitle || dashboard.type"></p></a></template></div>
    </section>`,
  );
}

function providerDashboardExtension(
  title: string,
  controllerName: string,
  controllerBody: string,
  body: string,
): string {
  return baseExtension(
    title,
    `<script>
      function ${controllerName}() {
        ${controllerBody}
      }
    </script>
    <div x-data="${controllerName}()" x-init="init()" class="space-y-4">
      <p x-show="loading" class="rounded-md border bg-muted/40 p-3 text-muted-foreground">Loading ${escapeHtml(title)}...</p>
      <p x-show="error" x-text="error" class="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-red-500"></p>
      ${body}
    </div>`,
  );
}

function barList(
  title: string,
  rowsExpression: string,
  labelKey: string,
  valueKey: string,
): string {
  return `<section class="rounded-lg border bg-card p-4">
    <h2 class="mb-3 font-semibold">${escapeHtml(title)}</h2>
    <div class="space-y-2">
      <template x-for="row in ${rowsExpression}" :key="row.${labelKey}">
        <div class="grid grid-cols-[minmax(0,1fr)_80px] items-center gap-3 text-xs">
          <span class="truncate" x-text="row.${labelKey}"></span>
          <span class="text-right tabular-nums" x-text="fmt(row.${valueKey})"></span>
          <div class="col-span-2 h-2 overflow-hidden rounded-full bg-muted">
            <div class="h-full rounded-full bg-primary" x-bind:style="'width:' + Math.min(100, Number(row.${valueKey} || 0) / Math.max(1, Number((${rowsExpression})[0]?.${valueKey} || 1)) * 100) + '%'"></div>
          </div>
        </div>
      </template>
      <p x-show="!(${rowsExpression}).length" class="py-8 text-center text-sm text-muted-foreground">No data returned.</p>
    </div>
  </section>`;
}
