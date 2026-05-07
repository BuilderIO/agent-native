function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function baseExtension(title: string, body: string): string {
  return `<div class="p-4 space-y-4 text-sm text-foreground" x-data="{}">
  <div>
    <h1 class="text-lg font-semibold">${escapeHtml(title)}</h1>
  </div>
  ${body}
</div>`;
}

export function gcnExtension(): string {
  return baseExtension(
    "GCN Conference Prep",
    `<script>
      function gcnConferencePrep() {
        return {
          activeTab: 'search',
          previousTab: null,
          input: '',
          mode: 'company',
          search: null,
          activeMeeting: null,
          meetings: [],
          speakers: [],
          loading: true,
          error: '',
          notice: '',
          repFilter: 'all',
          expandedMeeting: '',
          speakerQuery: '',
          speakerType: 'All',
          ownerFilter: 'all',
          speakerSort: 'name',
          speakerSortDir: 'asc',
          aeNotes: [
            { company: 'Thales', note: 'customer', ae: 'Andrew Bishop', sponsorTier: 'Foundation' },
            { company: 'Grafana Labs', note: 'We should target Grafana, had open deals in both CMS and Fusion in the past year.', ae: 'Andrew Goodhand', sponsorTier: 'Foundation' },
            { company: 'Pendo', note: '(AG) Just expanded and met with at their annual user conference.', ae: 'Andrew Goodhand', sponsorTier: 'Foundation' },
            { company: 'Accenture', note: 'Accenture has a new MD (https://www.linkedin.com/in/ruchi-goyal-ca/) who is responsible for AI tooling and AI accelerated development. My contact was supposed to set up a call with her for me and Brent, but last week they announced partnerships with both Anthropic around Claude Code and Replit, and they have been radio silent since. They have chatted with us here and there on partnerships, but have not gotten anything concrete up and running. Accenture has supported a few of our larger publish customers (ABinBev, JTI).', ae: 'Julia Shkrabova', sponsorTier: 'Luminary' },
            { company: 'Atos', note: 'nothing yet', ae: 'Julia Shkrabova', sponsorTier: 'Velocity' },
            { company: 'Capgemini', note: 'Have an upcoming disco call with them next week. Past opportunity owned by Bish, went dark after an NBM.', ae: 'Julia Shkrabova', sponsorTier: 'Luminary' },
            { company: 'Cognizant', note: 'Did an NBM for a Design director last week, he is going to be at dinner in NYC but he seemed to think that tech evals are to be done on a global Cognizant level. Had some partner conversations in the past, and a past deal was owned by Jess F, but never went anywhere in the last stage.', ae: 'Julia Shkrabova', sponsorTier: 'Luminary' },
            { company: 'Deloitte', note: 'You can learn how Deloitte is using Builder here: https://for-deloitte.netlify.app/\\nToday we work only with engineers at Deloitte, predominately on the ConvergeConsumer team.', ae: 'Julia Shkrabova', sponsorTier: 'Luminary' },
            { company: 'EPAM', note: 'Did an NBM. Tools for EPAM are evaluated on the global level, did not go super far cause the person i was speaking with did not have access to buying power.', ae: 'Julia Shkrabova', sponsorTier: 'Premier' },
            { company: 'Globant', note: 'Old opp existed that moved from Jess F to Bish to me, ghosted though.', ae: 'Julia Shkrabova', sponsorTier: 'Foundation' },
            { company: 'HCLTech', note: 'Did an NBM for a group, but they were just looking to do their work on a free trial.', ae: 'Julia Shkrabova', sponsorTier: 'Marquee' },
            { company: 'Infosys', note: 'Did a bunch of demos for them, but never really got anywhere legitimate.', ae: 'Julia Shkrabova', sponsorTier: 'Signature' },
            { company: 'KPMG LLP', note: 'Lots going on with KPMG, we work across AIQ and Advisory Digital teams. Very healthy usage, used Builder to create design system.', ae: 'Julia Shkrabova', sponsorTier: 'Premier' },
            { company: 'McKinsey & Company', note: 'nothing yet', ae: 'Julia Shkrabova', sponsorTier: 'Marquee' },
            { company: 'NTT DATA', note: 'customer, actively posting on LI', ae: 'Julia Shkrabova', sponsorTier: 'Premier' },
            { company: 'Publicis Sapient', note: 'nothing yet', ae: 'Julia Shkrabova', sponsorTier: 'Signature' },
            { company: 'PwC', note: 'nothing yet', ae: 'Julia Shkrabova', sponsorTier: 'Marquee' },
            { company: 'Quantiphi', note: 'nothing yet', ae: 'Julia Shkrabova', sponsorTier: 'Premier' },
            { company: 'ServiceNow', note: 'customer', ae: 'Thomas Godfrey', sponsorTier: 'Premier' },
            { company: 'Aerospike', note: 'AG - had conversations about migrating to publish but could not get in time for Contentful renewal.', ae: 'Andrew Goodhand', sponsorTier: 'Velocity' },
            { company: 'Hightouch', note: '(AG) Many common contacts there bc of Segment connection. Had some prelim convos last year but it was early fusion.', ae: 'Andrew Goodhand', sponsorTier: 'Foundation' },
            { company: 'Grid Dynamics', note: 'Our prospect Achilles will be there - https://www.linkedin.com/in/achillesc/', ae: 'Jacqueline Lamb', sponsorTier: 'Foundation' }
          ],
          async init() {
            this.loading = true;
            this.error = '';
            try {
              const meetings = await extensionData.get('legacy', 'meetings', { scope: 'org' });
              const speakers = await extensionData.get('legacy', 'speakers', { scope: 'org' });
              const meetingValue = this.unwrapLegacy(meetings);
              const speakerValue = this.unwrapLegacy(speakers);
              this.meetings = meetingValue && Array.isArray(meetingValue.meetings) ? meetingValue.meetings : Array.isArray(meetingValue) ? meetingValue : [];
              this.speakers = speakerValue && Array.isArray(speakerValue.speakers) ? speakerValue.speakers : Array.isArray(speakerValue) ? speakerValue : [];
            } catch (error) {
              this.error = error && error.message ? error.message : String(error);
            } finally {
              this.loading = false;
            }
          },
          unwrapLegacy(row) {
            if (!row) return null;
            const raw = row.data !== undefined ? row.data : row.value !== undefined ? row.value : row;
            let value = raw;
            if (typeof value === 'string') {
              try { value = JSON.parse(value); } catch (error) {}
            }
            if (value && value.value !== undefined) return value.value;
            if (value && value.data && value.data.value !== undefined) return value.data.value;
            if (value && value.data !== undefined) return value.data;
            return value;
          },
          extractLinkedIn(value) {
            const trimmed = String(value || '').trim();
            if (!/linkedin\\.com\\/in\\//i.test(trimmed)) return null;
            try {
              const parsed = new URL(/^https?:\\/\\//i.test(trimmed) ? trimmed : 'https://' + trimmed);
              if (!parsed.hostname.includes('linkedin.com')) return null;
              return parsed.href.split('?')[0].replace(/\\/$/, '');
            } catch (error) {
              return null;
            }
          },
          extractDomain(value) {
            const trimmed = String(value || '').trim();
            if (!trimmed || this.extractLinkedIn(trimmed)) return null;
            if (!/^https?:\\/\\//i.test(trimmed) && !/^www\\./i.test(trimmed) && !/^[a-z0-9-]+\\.[a-z]{2,}/i.test(trimmed)) return null;
            try {
              const parsed = new URL(/^https?:\\/\\//i.test(trimmed) ? trimmed : 'https://' + trimmed);
              return parsed.hostname.replace(/^www\\./i, '').toLowerCase();
            } catch (error) {
              return null;
            }
          },
          handleInput() {
            if (this.extractLinkedIn(this.input)) this.mode = 'person';
            else if (this.extractDomain(this.input)) this.mode = 'company';
          },
          handleSearch() {
            const query = this.input.trim();
            if (!query) return;
            const linkedinUrl = this.extractLinkedIn(query);
            const domain = this.extractDomain(query);
            this.previousTab = null;
            this.activeMeeting = null;
            if (linkedinUrl) {
              this.mode = 'person';
              this.search = { query: linkedinUrl, mode: 'person', linkedinUrl: linkedinUrl };
            } else if (domain) {
              this.mode = 'company';
              this.search = { query: domain, mode: 'company', domain: domain };
            } else {
              this.search = { query: query, mode: this.mode };
            }
            this.activeTab = 'search';
          },
          clearSearch() {
            this.input = '';
            this.search = null;
            this.activeMeeting = null;
            this.previousTab = null;
          },
          switchTab(tab) {
            this.activeTab = tab;
            if (tab !== 'search') this.clearSearch();
          },
          backToPrevious() {
            if (!this.previousTab) return;
            const tab = this.previousTab;
            this.clearSearch();
            this.activeTab = tab;
          },
          selectMeetingPerson(meeting) {
            this.previousTab = 'meetings';
            this.activeMeeting = meeting;
            this.input = meeting.name || '';
            this.mode = 'person';
            this.search = { query: meeting.name || '', mode: 'person', company: meeting.company || '' };
            this.activeTab = 'search';
          },
          selectMeetingCompany(meeting) {
            this.previousTab = 'meetings';
            this.activeMeeting = meeting;
            this.input = meeting.company || '';
            this.mode = 'company';
            this.search = { query: meeting.company || '', mode: 'company' };
            this.activeTab = 'search';
          },
          selectSpeaker(speaker) {
            this.previousTab = 'speakers';
            this.activeMeeting = null;
            this.input = speaker.name || '';
            this.mode = 'person';
            this.search = { query: speaker.name || '', mode: 'person', company: speaker.company || '', linkedinUrl: speaker.linkedinUrl || '' };
            this.activeTab = 'search';
          },
          selectSpeakerCompany(company) {
            this.previousTab = 'speakers';
            this.activeMeeting = null;
            this.input = company || '';
            this.mode = 'company';
            this.search = { query: company || '', mode: 'company' };
            this.activeTab = 'search';
          },
          meetingKey(meeting, index) {
            return [meeting.name || '', meeting.company || '', meeting.calDate || '', meeting.calTime || '', index].join('|');
          },
          parseMeetingTime(value) {
            const match = String(value || '').match(/(\\d+):(\\d+)\\s*(am|pm)/i);
            if (!match) return 9999;
            let hour = Number(match[1]);
            const minute = Number(match[2]);
            const period = match[3].toLowerCase();
            if (period === 'pm' && hour !== 12) hour += 12;
            if (period === 'am' && hour === 12) hour = 0;
            return hour * 60 + minute;
          },
          reps() {
            return Array.from(new Set(this.meetings.map((meeting) => meeting.builderRep).filter(Boolean))).sort();
          },
          filteredMeetings() {
            return this.meetings.filter((meeting) => this.repFilter === 'all' || meeting.builderRep === this.repFilter);
          },
          groupedMeetings() {
            const groups = {};
            this.filteredMeetings().forEach((meeting) => {
              const date = meeting.calDate || 'TBD';
              if (!groups[date]) groups[date] = [];
              groups[date].push(meeting);
            });
            Object.keys(groups).forEach((date) => groups[date].sort((a, b) => this.parseMeetingTime(a.calTime) - this.parseMeetingTime(b.calTime)));
            const order = { '4/22': 1, '4/23': 2, TBD: 99 };
            return Object.keys(groups).sort((a, b) => (order[a] || 50) - (order[b] || 50) || a.localeCompare(b)).map((date) => ({ date: date, label: this.dateLabel(date), meetings: groups[date] }));
          },
          dateLabel(date) {
            if (date === '4/22') return 'Tuesday - April 22';
            if (date === '4/23') return 'Wednesday - April 23';
            if (date === 'TBD') return 'Date TBD';
            return date;
          },
          hasResearch(meeting) {
            return Boolean(meeting.accountSummary || (meeting.talkingPoints && meeting.talkingPoints.length) || (meeting.openQuestions && meeting.openQuestions.length) || this.aeNote(meeting.company));
          },
          aeNote(companyName) {
            const lower = String(companyName || '').toLowerCase().trim();
            if (!lower) return null;
            return this.aeNotes.find((note) => {
              const company = note.company.toLowerCase();
              return company === lower || company.includes(lower) || lower.includes(company);
            }) || null;
          },
          matchingMeetings(query, mode) {
            const needle = String(query || '').toLowerCase();
            if (!needle) return [];
            return this.meetings.filter((meeting) => {
              if (mode === 'person') {
                return String(meeting.name || '').toLowerCase().includes(needle) || String(meeting.email || '').toLowerCase().includes(needle);
              }
              return String(meeting.company || '').toLowerCase().includes(needle) || String(meeting.email || '').toLowerCase().includes(needle);
            }).slice(0, 8);
          },
          matchingSpeakers(query) {
            const needle = String(query || '').toLowerCase().replace(/^https?:\\/\\/(www\\.)?linkedin\\.com\\/in\\//i, '').replace(/\\/$/, '');
            if (!needle) return [];
            return this.speakers.filter((speaker) => {
              return [speaker.name, speaker.company, speaker.title, speaker.linkedinUrl].some((value) => String(value || '').toLowerCase().includes(needle));
            }).slice(0, 8);
          },
          typeTabs() {
            return ['All', 'Customer', 'Partner', 'Luminary', 'GDE', 'Googler'];
          },
          typeValue(tab) {
            if (tab === 'GDE') return 'Google Developer Expert';
            if (tab === 'All') return null;
            return tab;
          },
          tabCount(tab) {
            const value = this.typeValue(tab);
            return value ? this.speakers.filter((speaker) => speaker.type === value).length : this.speakers.length;
          },
          owners() {
            return Array.from(new Set(this.speakers.map((speaker) => speaker.companyOwner).filter((owner) => owner && owner !== 'No owner assigned'))).sort();
          },
          filteredSpeakers() {
            const query = this.speakerQuery.toLowerCase();
            const type = this.typeValue(this.speakerType);
            return this.speakers.filter((speaker) => {
              if (type && speaker.type !== type) return false;
              if (this.ownerFilter !== 'all' && speaker.companyOwner !== this.ownerFilter) return false;
              if (!query) return true;
              return [speaker.name, speaker.company, speaker.title, speaker.companyOwner].some((value) => String(value || '').toLowerCase().includes(query));
            }).sort((a, b) => {
              const av = String(a[this.speakerSort] || '');
              const bv = String(b[this.speakerSort] || '');
              const cmp = av.localeCompare(bv);
              return this.speakerSortDir === 'asc' ? cmp : -cmp;
            });
          },
          sortSpeakers(key) {
            if (this.speakerSort === key) this.speakerSortDir = this.speakerSortDir === 'asc' ? 'desc' : 'asc';
            else {
              this.speakerSort = key;
              this.speakerSortDir = 'asc';
            }
          },
          linkedinSearch(name, company) {
            return 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent([name, company].filter(Boolean).join(' '));
          },
          searchTitle() {
            if (!this.search) return '';
            if (this.search.linkedinUrl) return this.search.query.replace(/^https?:\\/\\/(www\\.)?linkedin\\.com\\/in\\//i, '').replace(/\\/$/, '');
            return this.search.query;
          },
          companyForPerson() {
            if (!this.search) return '';
            if (this.search.company) return this.search.company;
            const speaker = this.matchingSpeakers(this.search.query)[0];
            return speaker && speaker.company ? speaker.company : this.search.query;
          },
          contextPrompt() {
            if (!this.search) return '';
            if (this.search.mode === 'company') {
              return 'I am about to have a conversation with someone from ' + this.search.query + ' at Google Cloud Next. Pull all relevant context you have: HubSpot deal status, recent Gong calls, key contacts, any open support tickets. Then give me 3-5 concise talking points I should lead with, any red flags to be aware of, and open questions I should ask.';
            }
            return 'I am about to meet ' + this.search.query + ' at Google Cloud Next. Look up their Apollo profile, any HubSpot contact record, Gong calls they have been on, and give me: their role and background, our relationship history with them, 3 conversation starters, and anything I should avoid bringing up.';
          },
          meetingPrompt(meeting) {
            return 'I have a scheduled meeting at Google Cloud Next with ' + (meeting.name || 'this contact') + (meeting.title ? ', ' + meeting.title : '') + (meeting.company ? ' at ' + meeting.company : '') + '. Meeting time: ' + (meeting.calDate || 'TBD') + ' ' + (meeting.calTime || '') + '. Builder rep: ' + (meeting.builderRep || 'TBD') + '. Pull all available context (HubSpot deals, Gong call history, Apollo data) and give me: 1) Quick account status, 2) 3-5 tailored talking points for this meeting, 3) Any red flags or open items to be aware of.';
          },
          submitPrompt(message) {
            if (!message) return;
            const payload = { type: 'agentNative.submitChat', data: { message: message, submit: true, openSidebar: true } };
            if (window.parent && window.parent !== window) window.parent.postMessage(payload, '*');
            else window.postMessage(payload, window.location.origin);
            this.notice = 'Sent prompt to agent chat.';
            window.setTimeout(() => { this.notice = ''; }, 3000);
          },
          formatStatus(status) {
            return status || 'No status';
          }
        };
      }
    </script>
    <div x-data="gcnConferencePrep()" x-init="init()" class="mx-auto max-w-5xl space-y-5">
      <div class="rounded-lg border bg-card p-4 shadow-sm">
        <div class="flex flex-wrap items-center gap-2">
          <div class="flex rounded-md bg-muted p-1">
            <button type="button" class="rounded px-3 py-1.5 text-xs font-medium" x-bind:class="mode === 'company' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'" x-on:click="mode = 'company'">Company</button>
            <button type="button" class="rounded px-3 py-1.5 text-xs font-medium" x-bind:class="mode === 'person' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'" x-on:click="mode = 'person'">Person</button>
          </div>
          <div class="relative min-w-[240px] flex-1">
            <input x-model="input" x-on:input="handleInput()" x-on:keydown.enter="handleSearch()" class="h-10 w-full rounded-md border bg-background px-3 pr-10 text-sm outline-none focus:ring-2 focus:ring-primary/30" x-bind:placeholder="mode === 'company' ? 'Company name or URL, e.g. Deloitte or https://andela.com' : 'Person name or LinkedIn URL'" />
            <button x-show="input" type="button" class="absolute right-2 top-2 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted" x-on:click="clearSearch()">Clear</button>
          </div>
          <button type="button" class="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-40" x-bind:disabled="!input.trim()" x-on:click="handleSearch()">Search</button>
        </div>
        <div class="mt-2 flex flex-wrap gap-2 text-xs">
          <p x-show="extractLinkedIn(input)" class="rounded bg-blue-500/10 px-2 py-1 text-blue-700">LinkedIn profile detected; person mode will use the normalized profile URL.</p>
          <p x-show="!extractLinkedIn(input) && extractDomain(input)" class="rounded bg-emerald-500/10 px-2 py-1 text-emerald-700">Company URL detected: <span class="font-mono" x-text="extractDomain(input)"></span></p>
          <p x-show="notice" class="rounded bg-green-500/10 px-2 py-1 text-green-700" x-text="notice"></p>
        </div>
      </div>

      <div class="flex gap-1 border-b">
        <button type="button" class="border-b-2 px-4 py-2 text-sm font-medium" x-bind:class="activeTab === 'search' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'" x-on:click="switchTab('search')">Context Lookup <span x-show="search" class="ml-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary" x-text="searchTitle()"></span></button>
        <button type="button" class="border-b-2 px-4 py-2 text-sm font-medium" x-bind:class="activeTab === 'meetings' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'" x-on:click="switchTab('meetings')">Cabana Meetings</button>
        <button type="button" class="border-b-2 px-4 py-2 text-sm font-medium" x-bind:class="activeTab === 'speakers' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'" x-on:click="switchTab('speakers')">Speaker List</button>
      </div>

      <p x-show="loading" class="rounded border bg-muted/30 p-4 text-muted-foreground">Loading migrated GCN meetings and speakers...</p>
      <p x-show="error" class="rounded border border-red-500/30 bg-red-500/10 p-4 text-red-700" x-text="error"></p>

      <section x-show="activeTab === 'search' && !loading" class="space-y-4">
        <div x-show="!search" class="py-12 text-center">
          <div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-lg font-semibold">GCN</div>
          <p class="font-medium">Search a company or person to get started</p>
          <p class="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">Browse scheduled Cabana meetings or the migrated GCN speaker list, then hand a focused prep prompt to the agent chat.</p>
          <div class="mx-auto mt-6 grid max-w-2xl gap-3 text-left md:grid-cols-3">
            <div class="rounded-lg border bg-card p-3"><p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Company search</p><p class="mt-1 text-xs text-muted-foreground">Name and URL parsing with matching migrated meetings and AE notes.</p></div>
            <div class="rounded-lg border bg-card p-3"><p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Person search</p><p class="mt-1 text-xs text-muted-foreground">Name and LinkedIn parsing with speaker and Cabana context.</p></div>
            <div class="rounded-lg border bg-card p-3"><p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Talking points</p><p class="mt-1 text-xs text-muted-foreground">Submit full prep prompts to the agent chat from any result.</p></div>
          </div>
        </div>

        <div x-show="search" class="space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <button x-show="previousTab" type="button" class="rounded border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted" x-on:click="backToPrevious()">Back to <span x-text="previousTab === 'meetings' ? 'Cabana Meetings' : 'Speaker List'"></span></button>
              <div>
                <p class="font-semibold" x-text="searchTitle()"></p>
                <p class="text-xs text-muted-foreground" x-text="search && search.linkedinUrl ? 'LinkedIn profile' : search ? search.mode : ''"></p>
              </div>
            </div>
            <button type="button" class="rounded-md border px-3 py-2 text-xs font-medium hover:bg-muted" x-on:click="submitPrompt(contextPrompt())">Get talking points</button>
          </div>

          <template x-if="search && search.mode === 'company'">
            <div class="space-y-4">
              <div class="rounded-lg border bg-card p-4">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 class="font-medium">Company context lookup</h2>
                    <p class="mt-1 text-sm text-muted-foreground">Use the agent prompt for live HubSpot, Gong, Apollo, ticket, and account research. Migrated Cabana context is shown below.</p>
                    <p x-show="search.domain" class="mt-2 text-xs text-emerald-700">Parsed domain: <span class="font-mono" x-text="search.domain"></span></p>
                  </div>
                  <button type="button" class="rounded bg-primary px-3 py-2 text-xs font-medium text-primary-foreground" x-on:click="submitPrompt(contextPrompt())">Send prep prompt</button>
                </div>
              </div>
              <template x-if="aeNote(search.query)">
                <div class="rounded-lg border border-amber-500/40 bg-amber-50 p-4 text-amber-950">
                  <div class="flex flex-wrap justify-between gap-2 text-xs font-semibold uppercase tracking-wide"><span>AE Notes</span><span x-text="aeNote(search.query).ae + ' - ' + aeNote(search.query).sponsorTier + ' sponsor'"></span></div>
                  <p class="mt-2 whitespace-pre-line text-sm" x-text="aeNote(search.query).note"></p>
                </div>
              </template>
              <template x-if="activeMeeting">
                <div class="rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <p class="text-xs font-semibold uppercase tracking-wide text-primary">Selected Cabana meeting</p>
                  <p class="mt-1 font-medium" x-text="activeMeeting.name + (activeMeeting.title ? ', ' + activeMeeting.title : '')"></p>
                  <p class="text-xs text-muted-foreground" x-text="[activeMeeting.calDate, activeMeeting.calTime, activeMeeting.location, activeMeeting.builderRep].filter(Boolean).join(' - ')"></p>
                  <p x-show="activeMeeting.accountSummary" class="mt-3 text-sm" x-text="activeMeeting.accountSummary"></p>
                </div>
              </template>
              <div class="space-y-2">
                <h2 class="text-sm font-medium">Matching Cabana meetings</h2>
                <template x-if="matchingMeetings(search.query, 'company').length === 0"><p class="rounded border p-4 text-sm text-muted-foreground">No migrated meetings match this company.</p></template>
                <template x-for="(meeting, index) in matchingMeetings(search.query, 'company')" :key="meetingKey(meeting, index)">
                  <button type="button" class="w-full rounded-lg border bg-card p-3 text-left hover:bg-muted/40" x-on:click="selectMeetingCompany(meeting)">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <span class="font-medium" x-text="meeting.name"></span>
                      <span class="text-xs text-muted-foreground" x-text="[meeting.calDate, meeting.calTime, meeting.builderRep].filter(Boolean).join(' - ')"></span>
                    </div>
                    <p class="mt-1 text-xs text-muted-foreground" x-text="[meeting.title, meeting.company, formatStatus(meeting.hsStatus)].filter(Boolean).join(' - ')"></p>
                  </button>
                </template>
              </div>
            </div>
          </template>

          <template x-if="search && search.mode === 'person'">
            <div class="space-y-4">
              <div class="rounded-lg border bg-card p-4">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 class="font-medium">Person context lookup</h2>
                    <p class="mt-1 text-sm text-muted-foreground">Use the agent prompt for Apollo enrichment, HubSpot contact lookup, Gong history, and conversation starters.</p>
                    <a x-show="search.linkedinUrl" class="mt-2 inline-block text-xs text-blue-600 underline" x-bind:href="search.linkedinUrl" target="_blank" rel="noopener noreferrer">Open LinkedIn profile</a>
                  </div>
                  <button type="button" class="rounded bg-primary px-3 py-2 text-xs font-medium text-primary-foreground" x-on:click="submitPrompt(contextPrompt())">Send prep prompt</button>
                </div>
              </div>
              <template x-if="aeNote(companyForPerson())">
                <div class="rounded-lg border border-amber-500/40 bg-amber-50 p-4 text-amber-950">
                  <div class="flex flex-wrap justify-between gap-2 text-xs font-semibold uppercase tracking-wide"><span>AE Notes</span><span x-text="aeNote(companyForPerson()).ae + ' - ' + aeNote(companyForPerson()).sponsorTier + ' sponsor'"></span></div>
                  <p class="mt-2 whitespace-pre-line text-sm" x-text="aeNote(companyForPerson()).note"></p>
                </div>
              </template>
              <template x-if="activeMeeting">
                <div class="rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <p class="text-xs font-semibold uppercase tracking-wide text-primary">Selected Cabana meeting</p>
                  <p class="mt-1 font-medium" x-text="activeMeeting.company"></p>
                  <p class="text-xs text-muted-foreground" x-text="[activeMeeting.calDate, activeMeeting.calTime, activeMeeting.location, activeMeeting.builderRep].filter(Boolean).join(' - ')"></p>
                  <p x-show="activeMeeting.accountSummary" class="mt-3 text-sm" x-text="activeMeeting.accountSummary"></p>
                </div>
              </template>
              <div class="grid gap-3 md:grid-cols-2">
                <div class="space-y-2">
                  <h2 class="text-sm font-medium">Matching speakers</h2>
                  <template x-if="matchingSpeakers(search.query).length === 0"><p class="rounded border p-4 text-sm text-muted-foreground">No migrated speakers match this person.</p></template>
                  <template x-for="(speaker, index) in matchingSpeakers(search.query)" :key="speaker.name + speaker.company + index">
                    <div class="rounded-lg border bg-card p-3">
                      <div class="flex flex-wrap items-start justify-between gap-2">
                        <div><p class="font-medium" x-text="speaker.name"></p><p class="text-xs text-muted-foreground" x-text="speaker.title"></p></div>
                        <span class="rounded bg-muted px-2 py-0.5 text-[10px]" x-text="speaker.type === 'Google Developer Expert' ? 'GDE' : speaker.type"></span>
                      </div>
                      <button type="button" class="mt-2 text-xs font-medium hover:text-primary" x-on:click="selectSpeakerCompany(speaker.company)" x-text="speaker.company"></button>
                    </div>
                  </template>
                </div>
                <div class="space-y-2">
                  <h2 class="text-sm font-medium">Matching meetings</h2>
                  <template x-if="matchingMeetings(search.query, 'person').length === 0"><p class="rounded border p-4 text-sm text-muted-foreground">No migrated meetings match this person.</p></template>
                  <template x-for="(meeting, index) in matchingMeetings(search.query, 'person')" :key="meetingKey(meeting, index)">
                    <button type="button" class="w-full rounded-lg border bg-card p-3 text-left hover:bg-muted/40" x-on:click="selectMeetingPerson(meeting)">
                      <p class="font-medium" x-text="meeting.name"></p>
                      <p class="text-xs text-muted-foreground" x-text="[meeting.title, meeting.company, meeting.calDate, meeting.calTime].filter(Boolean).join(' - ')"></p>
                    </button>
                  </template>
                </div>
              </div>
            </div>
          </template>
        </div>
      </section>

      <section x-show="activeTab === 'meetings' && !loading" class="space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap gap-3 text-sm"><span><strong x-text="meetings.length"></strong> meetings</span><span class="text-green-700"><strong x-text="meetings.filter((meeting) => meeting.accepted).length"></strong> accepted</span></div>
          <div class="flex flex-wrap items-center gap-1.5 text-xs">
            <span class="text-muted-foreground">Rep:</span>
            <button type="button" class="rounded-full border px-2.5 py-1" x-bind:class="repFilter === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'" x-on:click="repFilter = 'all'">All</button>
            <template x-for="rep in reps()" :key="rep"><button type="button" class="rounded-full border px-2.5 py-1" x-bind:class="repFilter === rep ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'" x-on:click="repFilter = rep" x-text="rep"></button></template>
          </div>
        </div>
        <template x-for="group in groupedMeetings()" :key="group.date">
          <div class="space-y-2">
            <div class="flex items-center gap-2"><span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground" x-text="group.label"></span><div class="h-px flex-1 bg-border"></div><span class="text-xs text-muted-foreground" x-text="group.meetings.length"></span></div>
            <template x-for="(meeting, index) in group.meetings" :key="meetingKey(meeting, index)">
              <div class="rounded-lg border bg-card" x-bind:class="meeting.accepted ? 'border-green-500/40 bg-green-500/5' : ''">
                <div class="flex cursor-pointer flex-wrap items-center gap-3 p-3 hover:bg-muted/40" x-on:click="selectMeetingCompany(meeting)">
                  <div class="w-28 text-xs text-muted-foreground" x-text="meeting.calTime || 'TBD'"></div>
                  <div class="min-w-[220px] flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <button type="button" class="font-medium hover:text-primary" x-on:click.stop="selectMeetingPerson(meeting)" x-text="meeting.name"></button>
                      <a class="text-xs text-blue-600 underline" x-bind:href="linkedinSearch(meeting.name, meeting.company)" target="_blank" rel="noopener noreferrer" x-on:click.stop>LinkedIn</a>
                      <span x-show="meeting.accepted" class="text-[10px] font-semibold uppercase tracking-wide text-green-700">Accepted</span>
                      <span x-show="!meeting.accepted && meeting.status === 'Requested'" class="text-[10px] font-semibold uppercase tracking-wide text-amber-600">Requested</span>
                      <span x-show="meeting.hsStatus" class="text-[10px] text-muted-foreground" x-text="meeting.hsStatus"></span>
                      <span x-show="meeting.gongCalls > 0" class="text-[10px] text-muted-foreground" x-text="meeting.gongCalls + ' Gong calls'"></span>
                    </div>
                    <p class="mt-1 text-xs text-muted-foreground"><span x-text="meeting.title"></span><span x-show="meeting.title && meeting.company"> - </span><button type="button" class="font-medium hover:text-primary" x-on:click.stop="selectMeetingCompany(meeting)" x-text="meeting.company"></button></p>
                  </div>
                  <span x-show="meeting.builderRep" class="rounded bg-muted px-2 py-1 text-[10px]" x-text="meeting.builderRep"></span>
                  <a x-show="meeting.email" class="rounded border px-2 py-1 text-xs hover:bg-muted" x-bind:href="'mailto:' + meeting.email" x-on:click.stop>Email</a>
                  <button type="button" class="rounded border px-2 py-1 text-xs hover:bg-muted" x-on:click.stop="submitPrompt(meetingPrompt(meeting))">Prep</button>
                  <button x-show="hasResearch(meeting)" type="button" class="rounded border px-2 py-1 text-xs hover:bg-muted" x-on:click.stop="expandedMeeting = expandedMeeting === meetingKey(meeting, index) ? '' : meetingKey(meeting, index)" x-text="expandedMeeting === meetingKey(meeting, index) ? 'Hide' : 'Details'"></button>
                </div>
                <div x-show="expandedMeeting === meetingKey(meeting, index)" class="space-y-4 border-t p-4">
                  <div x-show="meeting.accountSummary"><p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Account Status</p><p class="mt-1 text-sm" x-text="meeting.accountSummary"></p></div>
                  <div x-show="meeting.talkingPoints && meeting.talkingPoints.length"><p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Talking Points</p><ol class="mt-2 list-decimal space-y-1 pl-5 text-sm"><template x-for="point in meeting.talkingPoints" :key="point"><li x-text="point"></li></template></ol></div>
                  <div x-show="meeting.openQuestions && meeting.openQuestions.length"><p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Open Questions</p><ul class="mt-2 list-disc space-y-1 pl-5 text-sm"><template x-for="question in meeting.openQuestions" :key="question"><li x-text="question"></li></template></ul></div>
                  <template x-if="aeNote(meeting.company)"><div class="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-amber-950"><p class="text-[10px] font-semibold uppercase tracking-wide" x-text="'AE Notes - ' + aeNote(meeting.company).ae"></p><p class="mt-1 whitespace-pre-line text-xs" x-text="aeNote(meeting.company).note"></p></div></template>
                </div>
              </div>
            </template>
          </div>
        </template>
      </section>

      <section x-show="activeTab === 'speakers' && !loading" class="space-y-4">
        <div class="flex flex-wrap gap-3 text-xs text-muted-foreground"><span><strong class="text-foreground" x-text="speakers.length"></strong> total attendees</span><span><strong class="text-green-700" x-text="speakers.filter((speaker) => ['Customer', 'Partner', 'Luminary'].includes(speaker.type)).length"></strong> customers and partners</span><span><span x-text="speakers.filter((speaker) => speaker.featured).length"></span> official GCN speakers</span></div>
        <div class="flex gap-0 overflow-x-auto border-b">
          <template x-for="tab in typeTabs()" :key="tab"><button type="button" class="shrink-0 border-b-2 px-4 py-2 text-sm font-medium" x-bind:class="speakerType === tab ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'" x-on:click="speakerType = tab"><span x-text="tab"></span><span class="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px]" x-text="tabCount(tab)"></span></button></template>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <input x-model="speakerQuery" class="h-9 min-w-[240px] flex-1 rounded-md border bg-background px-3 text-sm" placeholder="Search name, company, title, AE..." />
          <select x-model="ownerFilter" class="h-9 rounded-md border bg-background px-2 text-xs"><option value="all">All AEs</option><template x-for="owner in owners()" :key="owner"><option x-bind:value="owner" x-text="owner"></option></template></select>
          <button type="button" class="rounded border px-2.5 py-1.5 text-xs" x-on:click="sortSpeakers('name')">Sort name</button>
          <button type="button" class="rounded border px-2.5 py-1.5 text-xs" x-on:click="sortSpeakers('company')">Sort company</button>
          <span class="text-xs text-muted-foreground" x-text="filteredSpeakers().length + ' of ' + speakers.length + ' shown'"></span>
        </div>
        <template x-if="filteredSpeakers().length === 0"><p class="rounded border p-8 text-center text-muted-foreground">No attendees match your search.</p></template>
        <div class="grid gap-3 md:grid-cols-2">
          <template x-for="(speaker, index) in filteredSpeakers()" :key="speaker.name + speaker.company + index">
            <div class="rounded-lg border bg-card p-4 hover:bg-muted/30">
              <div class="flex items-start justify-between gap-3">
                <button type="button" class="text-left" x-on:click="selectSpeaker(speaker)"><p class="font-medium hover:text-primary" x-text="speaker.name"></p><p class="mt-1 text-xs text-muted-foreground" x-text="speaker.title"></p></button>
                <span class="rounded px-2 py-0.5 text-[10px] font-medium" x-bind:class="speaker.type === 'Customer' ? 'bg-green-500/10 text-green-700' : speaker.type === 'Partner' ? 'bg-purple-500/10 text-purple-700' : speaker.type === 'Luminary' ? 'bg-amber-500/10 text-amber-700' : 'bg-muted text-muted-foreground'" x-text="speaker.type === 'Google Developer Expert' ? 'GDE' : speaker.type"></span>
              </div>
              <div class="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <button type="button" class="font-medium hover:text-primary" x-on:click="selectSpeakerCompany(speaker.company)" x-text="speaker.company"></button>
                <span x-show="speaker.persona" class="text-muted-foreground" x-text="speaker.persona"></span>
                <span x-show="speaker.companyOwner && speaker.companyOwner !== 'No owner assigned'" class="text-muted-foreground" x-text="speaker.companyOwner"></span>
                <span x-show="speaker.featured" class="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700">Featured</span>
              </div>
              <div class="mt-3 flex gap-2">
                <button type="button" class="rounded border px-2.5 py-1.5 text-xs hover:bg-muted" x-on:click="selectSpeaker(speaker)">View person</button>
                <button type="button" class="rounded border px-2.5 py-1.5 text-xs hover:bg-muted" x-on:click="selectSpeakerCompany(speaker.company)">View company</button>
                <a x-show="speaker.linkedinUrl" class="rounded border px-2.5 py-1.5 text-xs hover:bg-muted" x-bind:href="speaker.linkedinUrl" target="_blank" rel="noopener noreferrer">LinkedIn</a>
                <a x-show="speaker.profileUrl" class="rounded border px-2.5 py-1.5 text-xs hover:bg-muted" x-bind:href="speaker.profileUrl" target="_blank" rel="noopener noreferrer">GCN page</a>
              </div>
            </div>
          </template>
        </div>
      </section>
    </div>`,
  );
}

export function engagementExtension(): string {
  return baseExtension(
    "User Engagement Planner",
    `<script>
      function engagementPlanner() {
        return {
          orgIdInput: '',
          loading: false,
          error: '',
          orgData: null,
          prompt: '',
          notice: '',
          sqlQuote(value) {
            return String(value || '').replace(/'/g, "''");
          },
          rowsFrom(result) {
            if (!result) return [];
            if (Array.isArray(result.rows)) return result.rows;
            if (result.data && Array.isArray(result.data.rows)) return result.data.rows;
            if (result.result && Array.isArray(result.result.rows)) return result.result.rows;
            if (Array.isArray(result)) return result;
            return [];
          },
          async queryBigQuery(sql) {
            const result = await appAction('bigquery', { sql: sql });
            if (result && result.error) throw new Error(result.error);
            return this.rowsFrom(result);
          },
          async validate() {
            const trimmed = this.orgIdInput.trim();
            if (!trimmed) return;
            this.loading = true;
            this.error = '';
            this.orgData = null;
            this.prompt = '';
            try {
              let orgId = trimmed.replace(/-/g, '');
              const isUuid = /^[0-9a-f]{32}$/i.test(orgId);
              if (!isUuid) {
                const lookupSql = [
                  'SELECT root_org_id',
                  'FROM \`builder-3b0a2.dbt_staging.hubspot_companies\`',
                  "WHERE LOWER(company_name) = LOWER('" + this.sqlQuote(trimmed) + "')",
                  'LIMIT 1'
                ].join('\\n');
                const lookupRows = await this.queryBigQuery(lookupSql);
                if (!lookupRows.length) {
                  this.error = 'No company found with name: "' + trimmed + '". Check spelling or use the organization ID instead.';
                  return;
                }
                orgId = lookupRows[0].root_org_id;
                if (!orgId) {
                  this.error = 'Company "' + trimmed + '" found but has no Root Organization ID associated.';
                  return;
                }
              }
              const safeOrgId = this.sqlQuote(orgId);
              const sql = [
                'WITH fusion_activity AS (',
                "  SELECT '" + safeOrgId + "' AS root_org_id,",
                '    COUNT(DISTINCT user_id) AS user_count,',
                '    COUNT(*) AS message_count',
                '  FROM \`builder-3b0a2.amplitude.EVENTS_182198\`',
                "  WHERE event_type = 'fusion chat message submitted'",
                '    AND event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)',
                "    AND JSON_VALUE(event_properties, '$.rootOrganizationId') = '" + safeOrgId + "'",
                '),',
                'hubspot_lookup AS (',
                '  SELECT company_name',
                '  FROM \`builder-3b0a2.dbt_staging.hubspot_companies\`',
                "  WHERE root_org_id = '" + safeOrgId + "'",
                '  LIMIT 1',
                '),',
                'email_domain AS (',
                "  SELECT REGEXP_EXTRACT(email, r'@(.+)') AS domain",
                '  FROM \`builder-3b0a2.dbt_mart.dim_hs_contacts\` c',
                '  JOIN \`builder-3b0a2.dbt_staging_bigquery.signups\` s',
                '    ON c.builder_user_id = s.user_id',
                "  WHERE s.root_organization_id = '" + safeOrgId + "'",
                "    AND email NOT LIKE '%@builder.io'",
                '  LIMIT 1',
                ')',
                'SELECT fa.root_org_id, fa.user_count, fa.message_count, h.company_name, ed.domain AS email_domain',
                'FROM fusion_activity fa',
                'LEFT JOIN hubspot_lookup h ON TRUE',
                'LEFT JOIN email_domain ed ON TRUE'
              ].join('\\n');
              const rows = await this.queryBigQuery(sql);
              if (!rows.length) {
                this.error = 'No data found for organization ID: ' + trimmed;
                return;
              }
              const data = rows[0];
              if (Number(data.user_count || 0) === 0) {
                this.error = 'No Fusion activity found for this organization in the last 90 days.';
                return;
              }
              this.orgData = data;
            } catch (error) {
              this.error = error && error.message ? error.message : String(error);
            } finally {
              this.loading = false;
            }
          },
          orgName() {
            if (!this.orgData) return '';
            if (this.orgData.company_name) return this.orgData.company_name;
            if (this.orgData.email_domain) return 'Organization @' + this.orgData.email_domain;
            return 'Org ' + String(this.orgData.root_org_id || '').slice(0, 8);
          },
          buildPrompt() {
            if (!this.orgData) return '';
            const name = this.orgName();
            return [
              'Analyze user engagement and create an outreach strategy for **' + name + '** (Organization ID: ' + this.orgData.root_org_id + ').',
              '',
              'Please provide:',
              '1. Active users in the last 90 days with activity breakdown',
              '2. User segmentation based on engagement patterns (power users, dormant users, trial users, etc.)',
              '3. Recommended users for outreach with explanations',
              '4. Suggested messaging strategy for each segment',
              '5. Any technical friction or blockers identified in the data',
              '6. Cross-team analysis if multiple user groups exist',
              '',
              'Use the same analysis approach as the Amazon POC Org example, including:',
              '- Fusion chat message activity',
              '- HubSpot contact data and lifecycle stages',
              '- Activity patterns and drop-off analysis',
              '- Error patterns (container health checks, project issues)',
              '- Recent vs. dormant user identification',
              '- Team/geographic patterns (if evident from email domains)',
              '',
              'Please query real data from BigQuery and HubSpot, and present findings with charts where helpful.'
            ].join('\\n');
          },
          async generateStrategy() {
            this.prompt = this.buildPrompt();
            if (!this.prompt) return;
            try {
              await extensionData.set('prompts', this.orgData.root_org_id || this.orgIdInput.trim(), { company: this.orgName(), orgData: this.orgData, prompt: this.prompt, createdAt: new Date().toISOString() }, { scope: 'org' });
            } catch (error) {
              // Saving the prompt is helpful but should not block chat handoff.
            }
            this.submitPrompt(this.prompt);
          },
          submitPrompt(message) {
            const payload = { type: 'agentNative.submitChat', data: { message: message, submit: true, openSidebar: true } };
            if (window.parent && window.parent !== window) window.parent.postMessage(payload, '*');
            else window.postMessage(payload, window.location.origin);
            this.notice = 'Sent engagement strategy prompt to agent chat.';
            window.setTimeout(() => { this.notice = ''; }, 3000);
          },
          reset() {
            this.orgIdInput = '';
            this.orgData = null;
            this.error = '';
            this.prompt = '';
          }
        };
      }
    </script>
    <div x-data="engagementPlanner()" class="mx-auto max-w-4xl space-y-5">
      <div class="rounded-lg border bg-card p-5 shadow-sm">
        <label class="mb-2 block text-sm font-medium">Organization ID or Company Name</label>
        <div class="flex flex-wrap gap-3">
          <div class="min-w-[260px] flex-1">
            <input x-model="orgIdInput" x-on:input="error = ''; orgData = null; prompt = ''" x-on:keydown.enter="validate()" class="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" placeholder="e.g., CBRE Group or fa82ef21b9fd4a7cacb5f603666ae7cb" />
            <p class="mt-1.5 text-xs text-muted-foreground">Enter a HubSpot company name exactly, or paste a 32-character organization ID from HubSpot, Sigma, or Builder Admin.</p>
          </div>
          <button type="button" class="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-40" x-bind:disabled="loading || !orgIdInput.trim()" x-on:click="validate()"><span x-text="loading ? 'Validating...' : 'Validate'"></span></button>
        </div>
        <div class="mt-4 rounded-lg border bg-muted/40 p-3">
          <p class="text-xs font-medium">Quick tips</p>
          <ul class="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            <li>Easiest: use the company name from HubSpot, such as CBRE Group.</li>
            <li>Company name validation is exact-match against HubSpot companies.</li>
            <li>Validation queries BigQuery for Fusion chat activity in the last 90 days.</li>
          </ul>
        </div>
        <p x-show="error" class="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700" x-text="error"></p>
        <p x-show="notice" class="mt-4 rounded-md border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-700" x-text="notice"></p>
      </div>

      <template x-if="orgData">
        <div class="rounded-lg border bg-card p-5 shadow-sm">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="text-xs font-semibold uppercase tracking-wide text-green-700">Organization Validated</p>
              <h2 class="mt-1 text-lg font-semibold" x-text="orgName()"></h2>
              <p class="mt-1 font-mono text-xs text-muted-foreground" x-text="orgData.root_org_id"></p>
              <p x-show="orgData.email_domain" class="mt-1 text-sm text-muted-foreground">Domain: <span x-text="orgData.email_domain"></span></p>
            </div>
            <button type="button" class="rounded border px-3 py-2 text-xs hover:bg-muted" x-on:click="reset()">Analyze different org</button>
          </div>
          <div class="mt-4 grid gap-3 md:grid-cols-3">
            <div class="rounded-lg border bg-muted/30 p-4"><p class="text-xs text-muted-foreground">Active users (90d)</p><p class="mt-1 text-2xl font-semibold" x-text="orgData.user_count"></p></div>
            <div class="rounded-lg border bg-muted/30 p-4"><p class="text-xs text-muted-foreground">Messages (90d)</p><p class="mt-1 text-2xl font-semibold" x-text="orgData.message_count"></p></div>
            <div class="rounded-lg border bg-muted/30 p-4"><p class="text-xs text-muted-foreground">Source</p><p class="mt-1 text-sm font-medium">BigQuery + HubSpot</p></div>
          </div>
          <button type="button" class="mt-5 w-full rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground" x-on:click="generateStrategy()">Generate Engagement Strategy with AI</button>
          <p class="mt-2 text-center text-xs text-muted-foreground">This sends a detailed analysis prompt to the agent chat and saves a copy in extensionData prompts.</p>
          <textarea x-show="prompt" x-model="prompt" class="mt-4 h-56 w-full rounded-md border bg-background p-3 font-mono text-xs"></textarea>
        </div>
      </template>

      <div x-show="!orgData && !error" class="rounded-lg border bg-muted/30 p-5">
        <h2 class="text-sm font-semibold">How it works</h2>
        <ol class="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          <li>Enter a company name or organization ID.</li>
          <li>Validate the org against HubSpot and Fusion activity in BigQuery.</li>
          <li>Review active users, message count, domain, and organization ID.</li>
          <li>Send the generated strategy prompt to the agent chat for full analysis.</li>
        </ol>
      </div>
    </div>`,
  );
}
