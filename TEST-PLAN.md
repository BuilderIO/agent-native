# Comprehensive Test Plan — Agent-Native Framework (Apr 10-14 Features)

## Pre-Flight Setup (Human Required)

Before agents begin testing, the following must be done manually on the test machine:

### 1. Environment Setup

- Clone the repo and run `pnpm install` at the root
- Copy `.env.example` to `.env` in the workspace root (if one exists)
- Set `ANTHROPIC_API_KEY` in `.env` (required for agent chat and onboarding completion detection)
- **Optional but recommended:** Set `DATABASE_URL` to a Neon Postgres connection string if you want to test Postgres paths (otherwise SQLite is used)

### 2. Builder Connection (Required for browser API tests)

- Set `BUILDER_PRIVATE_KEY` and `BUILDER_PUBLIC_KEY` in `.env`. These come from connecting to Builder via the onboarding flow or manually from your Builder account settings.

### 3. Google OAuth (Required for mail/calendar org tests)

- Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env` if you want to test mail/calendar fully.
- If skipping Google OAuth, those template tests will be limited to UI-level checks.

### 4. Start the Apps

- Run `pnpm dev` in the relevant template directories. Key ports:
  - **dispatch**: `localhost:8090`
  - **mail**: `localhost:8082`
  - **calendar**: `localhost:8083`
  - **forms**: `localhost:8087`
  - **starter**: `localhost:8093`
- Alternatively, start a workspace with `pnpm dev` at the workspace root if one is configured.

### 5. Auth State

- Start with a **fresh browser profile** (no cookies) so the onboarding flow triggers naturally.
- Have a second browser profile or incognito ready for multi-user org tests.
- If testing upgrade flow: ensure the app starts in local dev mode (no `AUTH_MODE`, no `ACCESS_TOKEN`).

---

## Test Area 1: New User Onboarding Flow

**App:** Any template (use `starter` at localhost:8093 for cleanest test)
**Goal:** Verify the onboarding checklist appears, walks users through setup, and disappears when complete.

### 1.1 Initial Load — Onboarding Panel Appears

- Navigate to `localhost:8093` with a fresh profile
- **Verify:** The agent sidebar shows an onboarding checklist panel
- **Verify:** Four steps visible: "Connect an AI engine" (required), "Database", "Authentication", "File uploads"
- **Verify:** The LLM step is marked as required (blocking)
- **Verify:** Database shows "Use SQLite (default)" as primary option
- **Verify:** Auth shows "Use local mode (dev)" as primary option

### 1.2 LLM Step — Anthropic API Key Form

- Expand the "Connect an AI engine" step
- **Verify:** Two methods shown: "Use your Anthropic API key" (primary) and "Connect Builder" (with "free" badge)
- Click "Use your Anthropic API key"
- **Verify:** A form appears with a single field: `ANTHROPIC_API_KEY` with placeholder `sk-ant-...`
- **Verify:** The field is masked (secret input)
- Enter an invalid key (e.g., `not-a-key`) and submit
- **Verify:** The value is saved (the form submits to `/_agent-native/env-vars`)
- **Verify:** The step may show as "complete" since it only checks env var presence, not validity
- **Edge case:** Submit empty string — should not save or should show validation

### 1.3 LLM Step — Builder CLI Auth

- Click the "Connect Builder" method instead
- **Verify:** A popup window opens to the Builder OAuth consent page
- **Verify:** The UI shows a polling/waiting state ("Waiting for connection...")
- **Edge case:** Close the popup without completing — verify the UI recovers gracefully (stops polling, shows retry)
- **Edge case:** If `BUILDER_PRIVATE_KEY` is already set, verify this step shows as already complete

### 1.4 Database Step

- Expand the Database step
- **Verify:** "Use SQLite (default)" is primary, "Use Postgres / Neon" is secondary
- Click "Use Postgres / Neon"
- **Verify:** Form appears with `DATABASE_URL` field and placeholder `postgres://user:pass@host/db`
- **Verify:** Submitting writes to `.env` with scope "workspace"
- **Edge case:** Paste a malformed URL — the form should accept it (validation happens at connection time, not onboard time)

### 1.5 Auth Step

- Expand the Authentication step
- **Verify:** "Use local mode (dev)" is primary, "Sign in with Google" is secondary
- Click "Sign in with Google"
- **Verify:** Form shows `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` fields
- **Verify:** `GOOGLE_CLIENT_SECRET` is a masked/secret input

### 1.6 File Upload Step

- Expand the File uploads step
- **Verify:** "Connect Builder.io" (with "free" badge) and "Use your own provider" (link)
- **Verify:** "Use your own provider" links to external docs URL

### 1.7 Dismissal and Reopen

- Once at least the required LLM step is complete:
- **Verify:** A dismiss/close button appears on the onboarding panel
- Dismiss the panel
- **Verify:** The panel hides and a "Setup" button appears somewhere in the sidebar to reopen it
- Click "Setup" to reopen
- **Verify:** The panel reappears with current step statuses preserved

### 1.8 Template-Specific Steps

- Navigate to the mail template (`localhost:8082`)
- **Verify:** An additional "Connect Gmail" onboarding step appears (registered by the mail template)
- **Verify:** It offers a manual wizard method and an agent-task method

### 1.9 Cross-Tab Persistence

- Open the same app in a second tab
- Complete an onboarding step in tab 1
- **Verify:** Tab 2 reflects the change within a few seconds (polling interval is 3s)

---

## Test Area 2: Upgrade Account Flow (Local to Production)

**App:** Any template started in dev mode
**Goal:** Verify local@localhost data migrates cleanly to a real account.

### 2.1 Pre-Upgrade State

- Start any template in dev mode (no AUTH_MODE, no ACCESS_TOKEN set — default)
- **Verify:** You're auto-logged in as `local@localhost`
- Create some data: send agent chat messages, change settings, create resources
- **Verify:** Data appears in the UI (this is the baseline)

### 2.2 Navigate to Team Page

- Go to `/team`
- **Verify:** A "LocalModeSignInCard" or similar prompts "Sign in or create account"
- **Verify:** The card explains you're in dev mode

### 2.3 Trigger Upgrade

- Click the sign-in/create account button
- **Verify:** A `localStorage` flag `an_migrate_from_local=1` is set
- **Verify:** You're redirected to the auth/login page (Better Auth)
- Sign in with Google OAuth (or email/password if configured)
- **Verify:** After successful auth, the migration endpoint is called (`/_agent-native/auth/migrate-local-data`)

### 2.4 Post-Upgrade Verification

- **Verify:** All previous data is now visible under the new account
- **Verify:** Settings created as `local@localhost` are now scoped to your real email
- **Verify:** Agent chat history is preserved
- **Verify:** Application state (navigation, drafts) is preserved
- **Edge case:** Sign in with a second account that already has data — verify local data doesn't clobber existing data (the migration skips conflicts)

### 2.5 Idempotency

- Trigger the migration endpoint again (e.g., via browser devtools or curl)
- **Verify:** No errors, no duplicate data — the migration is idempotent

---

## Test Area 3: Organization / Team UX

**App:** Any template with org support (mail, calendar, forms, dispatch, etc.)
**Goal:** Verify org creation, invitations, switching, and data isolation.

### 3.1 Create Organization

- Navigate to `/team`
- **Verify:** A "Create organization" form is shown (if user has no org)
- Enter an org name and submit
- **Verify:** Org is created, user is set as "owner"
- **Verify:** The members list shows you as owner (with crown icon)

### 3.2 Invite a Teammate

- On the Team page, find the invite form (visible to owners/admins only)
- Enter an email address and click "Send" / "Invite"
- **Verify:** The invitation appears in the pending invitations list
- **Verify:** The note says "They'll need to sign in with Google using this exact email to accept the invitation"
- **Edge case:** Invite the same email twice — should show an error or prevent duplicate
- **Edge case:** Invite your own email — should be rejected (already a member)
- **Edge case:** Invite with an invalid email format — should show validation error

### 3.3 Accept an Invitation (Second User)

- In a second browser profile, sign in with the invited email
- **Verify:** An `InvitationBanner` appears at the top of the app showing the pending invite
- **Verify:** The Team page shows a `PendingInvitationsCard` with the invite details
- Click "Accept"
- **Verify:** The user is added to the org as "member"
- **Verify:** The banner disappears
- **Verify:** The members list now shows both users

### 3.4 Org Switching

- Have the first user create a second organization
- **Verify:** An `OrgSwitcher` dropdown appears in the sidebar/header
- Click the switcher and select the other org
- **Verify:** All data refreshes (React Query caches invalidated)
- **Verify:** The active org name updates in the switcher
- **Verify:** Data is scoped to the selected org (e.g., org settings, resources)
- **Edge case:** Switch rapidly between orgs — verify no stale data leaks

### 3.5 Role-Based Access Control

- As the owner, verify you can invite and remove members
- As a member (second user), verify you **cannot** invite or remove members
- **Verify:** The invite form is hidden for members
- **Verify:** Delete/remove buttons are hidden for members
- **Edge case:** Owner tries to remove themselves — should be prevented

### 3.6 Org Scoping in Templates

#### Mail

- Create email automations in org A
- Switch to org B
- **Verify:** Org A's automations are not visible
- **Verify:** Org B has a clean slate

#### Calendar

- Create booking links in org A
- **Verify:** They're not visible from org B

#### Dispatch

- Create vault secrets in org A
- **Verify:** They're not visible from org B

---

## Test Area 4: Dispatch Template — Core Functionality

**App:** dispatch at `localhost:8090`
**Goal:** Thorough testing of the workspace control plane features.

### 4.1 Overview Dashboard

- Navigate to `/overview`
- **Verify:** Four stat cards render: Vault secrets, Active grants, Destinations, Agents connected
- **Verify:** Stats reflect actual data (start at 0 for fresh install)
- **Verify:** Recent Activity section is empty or shows setup events
- **Verify:** Approval Mode shows current policy

### 4.2 Vault — Secrets Management

#### Create a Secret

- Navigate to `/vault`
- Click "Add secret"
- **Verify:** Dialog appears with fields: Name, Credential key, Value, Provider (dropdown), Description
- Fill in all fields (e.g., Name: "GitHub Token", Key: "GITHUB_TOKEN", Value: "ghp_test123", Provider: "github")
- Submit
- **Verify:** Secret appears in the list with name, key, provider badge
- **Verify:** Value is masked by default

#### View/Unmask a Secret

- Click the secret to expand it
- **Verify:** Value is shown masked (dots or asterisks)
- Click the eye/unmask icon
- **Verify:** Value becomes visible
- Click again to re-mask

#### Grant Secret to an App

- Click grant/share button on a secret
- **Verify:** A dialog appears listing discovered apps
- Select an app and confirm
- **Verify:** Grant appears under the secret's grant list
- **Verify:** Grant shows app name, status, sync/revoke buttons

#### Sync Secret to App

- Click "Sync" on a grant
- **Verify:** The secret is pushed to the target app (check the target app's env or settings)
- **Edge case:** Target app is offline — verify graceful error message

#### Revoke a Grant

- Click "Revoke" on a grant
- **Verify:** Grant is removed from the list
- **Verify:** The target app no longer has access

#### Delete a Secret

- Expand a secret, click Delete
- **Verify:** Confirmation dialog (should NOT be window.confirm — must be shadcn AlertDialog)
- Confirm deletion
- **Verify:** Secret removed from list
- **Verify:** All associated grants are also removed

#### Edge Cases

- Create a secret with empty value — should succeed (some secrets are just placeholders)
- Create two secrets with the same credential key — verify behavior (should it prevent duplicates?)
- Create a secret with very long value (1000+ chars) — verify UI doesn't break

### 4.3 Vault — Requests Tab

- Switch to the "Requests" tab
- **Verify:** Shows pending/approved/denied requests
- If approval policy is enabled, trigger a request from another app's agent
- **Verify:** Request appears with approve/deny buttons
- Approve a request
- **Verify:** Status changes, secret is granted

### 4.4 Vault — Audit Tab

- Switch to the "Audit" tab
- **Verify:** Shows chronological history of all vault operations
- **Verify:** Each entry shows: action, actor, timestamp, summary

### 4.5 Approvals Page

#### Configure Approval Policy

- Navigate to `/approvals`
- **Verify:** Left panel shows approval policy toggle and approver email input
- Toggle "Require approval for durable changes" ON
- Enter approver emails (comma-separated)
- Click "Save approvers"
- **Verify:** Policy is saved and reflected on reload

#### Test Approval Workflow

- With approvals enabled, perform a change that requires approval (e.g., upsert a destination)
- **Verify:** The change doesn't take effect immediately
- **Verify:** A pending approval request appears in the right panel
- Approve the request
- **Verify:** The change takes effect
- Reject a different request
- **Verify:** The change is not applied

### 4.6 Integrations Page

- Navigate to `/integrations`
- **Verify:** Summary stats: Apps discovered, Total integrations, Configured count
- **Verify:** App cards show: name, online status, integration progress
- **Verify:** Each integration shows: label, key, required badge, status (Configured/Granted/Missing)
- Click "Sync" on a reachable app
- **Verify:** Vault secrets sync to the app
- **Edge case:** All apps offline — verify graceful empty state

### 4.7 Destinations

- Navigate to `/destinations`
- **Verify:** Left panel shows saved destinations, right panel has add form

#### Create a Destination

- Fill in: Name, Platform (Slack/Telegram), Destination ID
- **Verify:** "Save destination" button enables when name + destination ID are filled
- Submit
- **Verify:** Destination appears in left panel

#### Test Message

- Find a saved destination
- Enter a test message and click "Send"
- **Verify:** If platform tokens are configured, message sends. If not, graceful error.

#### Delete a Destination

- Click delete on a destination
- **Verify:** Confirmation, then removal

### 4.8 Identities (User Linking)

- Navigate to `/identities`
- **Verify:** Left panel shows active links, right panel shows link tokens

#### Generate a Link Token

- Click "Create Slack token" or "Create Telegram token"
- **Verify:** Token appears with a `/link {token}` command
- **Verify:** Token shows platform, expiration (7 days), and unclaimed status

### 4.9 Workspace Resources

- Navigate to `/workspace`
- **Verify:** Tabs for Skills, Instructions, Agents

#### Create a Skill

- Click "Add resource"
- **Verify:** Dialog with: Kind dropdown, Scope dropdown, Name, Path (auto-generated), Description, Content (markdown)
- Select Kind: Skill, Scope: All apps
- Enter name and markdown content
- Submit
- **Verify:** Resource appears under Skills tab with correct badges

#### Create an Agent Profile

- Add resource with Kind: Agent
- Enter agent profile markdown with YAML frontmatter (name, description, model, tools, color)
- Submit
- **Verify:** Resource appears under Agents tab

#### Grant to Specific App

- Create a resource with Scope: "Selected apps"
- Click the grant button
- **Verify:** Grant dialog lists discovered apps
- Select an app, confirm
- **Verify:** Grant appears on the resource card

#### Sync Resources

- Click "Sync all" in the header
- **Verify:** Resources are pushed to all discovered apps (scope=all) or granted apps (scope=selected)
- **Verify:** Per-resource sync button also works

#### Delete a Resource

- Delete a resource
- **Verify:** Resource removed, all grants revoked

### 4.10 Agents Page

- Navigate to `/agents`
- **Verify:** Two sections: "Available by default" (built-in) and "Added in this workspace" (custom)

#### Built-in Agents

- **Verify:** Built-in agents listed: Mail, Calendar, Content, Analytics, Slides, Videos, Issues, Forms, Recruiting
- **Verify:** Each shows name, description, and color

#### Add External Agent

- Fill in the right sidebar form: Agent Name, Agent URL (e.g., `https://example.com`), Description
- Click "Add agent"
- **Verify:** Agent appears under "Added in this workspace"
- **Verify:** Shows as "custom" source with "shared" scope

#### Delete Custom Agent

- Click delete on a custom agent
- **Verify:** Agent removed from list
- **Edge case:** Try to delete a built-in agent — should not be possible

### 4.11 Audit Page

- Navigate to `/audit`
- **Verify:** Chronological list of all dispatch events
- Perform several operations (create secret, add destination, etc.)
- Return to audit page
- **Verify:** All operations appear with correct timestamps, actors, and summaries

### 4.12 Team Page

- Navigate to `/team`
- **Verify:** TeamPage component renders with org management
- (See Test Area 3 for detailed org tests)

---

## Test Area 5: Browser API Access

**App:** Any template with agent chat (best tested from dispatch or starter)
**Goal:** Verify agents can provision and use browser sessions via Builder.

### 5.1 Browser Connection Tool (Requires Builder Keys)

- Open agent chat in any app
- Ask the agent: "Get me a browser connection" or trigger the `get-browser-connection` tool
- **Verify:** If `BUILDER_PRIVATE_KEY` is set, the tool returns WebSocket connection details (wsUrl, wsKey, sessionId)
- **Verify:** If `BUILDER_PRIVATE_KEY` is NOT set, the tool returns a guidance message about connecting Builder

### 5.2 Browser Status Endpoint

- Hit `GET /_agent-native/builder/status` directly
- **Verify:** Returns `{ configured: true/false, connectUrl: "..." }`
- **Verify:** `connectUrl` includes the correct callback origin

### 5.3 Builder OAuth Callback

- Hit `GET /_agent-native/builder/callback` with test params: `p-key`, `api-key`, `user-id`, `org-name`
- **Verify:** Keys are written to `.env` file
- **Verify:** `process.env.BUILDER_PRIVATE_KEY` and `BUILDER_PUBLIC_KEY` are set
- **Edge case:** Callback with missing params — should fail gracefully

### 5.4 Agent Using Browser (End-to-End)

- With Builder connected, ask the agent: "Open my website at [url] and take a screenshot"
- **Verify:** The agent uses `get-browser-connection` to provision a session
- **Verify:** If MCP tools (claude-in-chrome) are available, the agent delegates to them
- **Edge case:** Builder connection expires or fails mid-session — verify graceful error handling

---

## Test Area 6: Custom Agents UX — End-to-End Workflows

**App:** dispatch at `localhost:8090`
**Goal:** Test the complete lifecycle of custom agent creation and management.

### 6.1 Agent Creation via UI

- Navigate to `/agents`
- Add a custom agent with: Name "Test Agent", URL "https://httpbin.org/post", Description "Test"
- **Verify:** Agent ID is auto-generated as slug (e.g., "test-agent")
- **Verify:** Agent saved as `agents/test-agent.json` resource
- **Verify:** Agent appears in UI with correct color (#6B7280 default)

### 6.2 Agent Discovery

- After adding a custom agent, call `list-connected-agents` action
- **Verify:** Custom agent appears alongside built-in agents
- **Verify:** Custom agent has `source: "custom"`, built-ins have `source: "builtin"`

### 6.3 Agent Scheduling (Recurring Jobs)

- Ask the agent to create a recurring job: "Every day at 9am, check my email for urgent items"
- **Verify:** The agent uses the `create-job` tool
- **Verify:** Job file created at `jobs/<name>.md` with cron schedule in YAML frontmatter
- **Verify:** `list-jobs` tool shows the job with correct schedule, enabled status, and next run time
- **Edge case:** Invalid cron expression — verify error handling

### 6.4 Job Management

- Use `update-job` to change the schedule
- **Verify:** Schedule updates, nextRun recalculates
- Disable a job via `update-job` (enabled: false)
- **Verify:** Job shows as disabled, scheduler skips it
- Re-enable the job
- **Verify:** Job becomes active again

### 6.5 Sub-Agent Task Spawning

- In agent chat, ask the agent to delegate a task: "Research the latest news about AI and give me a summary"
- **Verify:** The agent uses `spawn-task` to create a sub-agent
- **Verify:** A task chip/indicator appears in the chat showing the sub-agent's progress
- **Verify:** The sub-agent's preview text updates in real-time (throttled at 300ms)
- **Verify:** When complete, the summary is posted back to the parent thread

### 6.6 Workspace Agent Profiles

- Navigate to `/workspace` > Agents tab
- Create an agent profile as a markdown resource with YAML frontmatter:
  ```yaml
  ---
  name: Research Assistant
  description: Finds and summarizes information
  model: claude-sonnet-4-6
  tools: web-search, read-page
  color: "#4F46E5"
  ---
  You are a research assistant...
  ```
- **Verify:** Profile appears in the Agents tab
- **Verify:** Profile can be synced to apps

---

## Test Area 7: Settings and MCP Client

**App:** Any template
**Goal:** Verify settings UI and MCP tool integration.

### 7.1 Settings Panel

- Open the Settings panel (gear icon in sidebar)
- **Verify:** Sections visible: LLM, Agents, Browser, Background Agent (varies by template)

### 7.2 LLM Settings

- **Verify:** Shows current `ANTHROPIC_API_KEY` status (configured or not)
- **Verify:** If Builder is connected, shows Builder LLM proxy status
- **Verify:** Can update the API key via form

### 7.3 MCP Client Integration

- Create `mcp.config.json` in the workspace or app root:
  ```json
  {
    "servers": {
      "test-server": {
        "command": "echo",
        "args": ["test"]
      }
    }
  }
  ```
- Restart the app
- **Verify:** MCP server is detected and logged at startup
- **Verify:** MCP tools appear in the agent's tool registry with `mcp__test-server__` prefix
- **Edge case:** Config file has invalid JSON — verify graceful error
- **Edge case:** MCP server command doesn't exist — verify error logging

### 7.4 MCP Auto-Detection

- If `claude-in-chrome-mcp` binary is in PATH or `~/.claude-in-chrome/bin/`
- **Verify:** Auto-detected and registered without manual config
- Set `AGENT_NATIVE_DISABLE_MCP_AUTODETECT=1`
- **Verify:** Auto-detection is skipped

---

## Test Area 8: Cross-Cutting Concerns

### 8.1 Polling and Real-Time Sync

- Open the same app in two browser tabs
- Make a change in tab 1 (e.g., create a resource, update settings)
- **Verify:** Tab 2 reflects the change within 2-4 seconds (polling interval)
- **Verify:** No jitter — user's active edits in tab 2 are not overwritten

### 8.2 Agent Chat Context Awareness

- Navigate to a specific view (e.g., `/vault` in dispatch)
- Open agent chat and ask "What am I looking at?"
- **Verify:** The agent knows the current view (vault page) via the auto-injected `<current-screen>` context
- Navigate to a different view
- Ask again
- **Verify:** Context updates to reflect the new view

### 8.3 Mobile / Responsive

- Resize browser to mobile width
- **Verify:** Agent sidebar becomes overlay mode with backdrop dismiss
- **Verify:** Navigation remains usable
- **Verify:** All major pages render without horizontal scroll

### 8.4 Error States

- Disconnect the database (or stop the DB server)
- **Verify:** App shows meaningful error state, not a blank screen or cryptic error
- Kill the dev server and refresh the page
- **Verify:** App shows a connection error, not a white screen

### 8.5 XSS Hardening

- In any text field that renders markdown (agent chat, resource content, descriptions):
- Enter: `[click me](javascript:alert(1))`
- **Verify:** Link is sanitized — clicking does NOT execute JavaScript
- Enter: `![img](data:text/html,<script>alert(1)</script>)`
- **Verify:** Data URI is blocked
- Enter a code fence with a malicious language hint: ` ```<img src=x onerror=alert(1)> `
- **Verify:** Language hint is escaped, no script execution

### 8.6 Concurrent Agent Safety

- Start two agent chat conversations in parallel (different tabs or different apps)
- Have both perform write operations
- **Verify:** No data corruption, no lost writes
- **Verify:** Each conversation operates independently

---

## Parallelization Guide for Test Agents

These test areas are **independent** and can run in parallel across multiple sub-agents:

| Agent   | Test Areas                                     | Estimated Duration |
| ------- | ---------------------------------------------- | ------------------ |
| Agent A | Area 1 (Onboarding) + Area 2 (Upgrade Flow)    | 20-30 min          |
| Agent B | Area 3 (Organizations / Teams)                 | 20-30 min          |
| Agent C | Area 4 (Dispatch Template — full sweep)        | 40-60 min          |
| Agent D | Area 5 (Browser API) + Area 6 (Custom Agents)  | 20-30 min          |
| Agent E | Area 7 (Settings/MCP) + Area 8 (Cross-Cutting) | 20-30 min          |

**Dependencies:**

- Area 2 (Upgrade) should be tested on a fresh instance before any org setup
- Area 3 (Orgs) requires two browser profiles
- Area 5 (Browser API) requires `BUILDER_PRIVATE_KEY`
- Area 4.5 (Approvals) requires Area 4.2 (Vault) to have created secrets first — but within Agent C this is sequential naturally

**Each agent should:**

1. Take a screenshot before and after each major test step
2. Record failures with: URL, screenshot, console errors, network errors
3. Note any unexpected UI states (loading spinners that don't resolve, empty states that shouldn't be empty, etc.)
4. Test both happy path AND the listed edge cases
5. Check for console errors (`window.onerror`, React error boundaries) on every page load
