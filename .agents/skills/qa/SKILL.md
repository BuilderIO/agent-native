---
name: qa
description: >-
  Autonomous QA testing across template apps using Playwright. Use when testing
  apps end-to-end, finding and fixing bugs, or running a QA sweep. Invoke as
  /qa with optional --apps and --focus args.
user-invocable: true
---

# QA Testing

Autonomous QA testing that spins up template apps, tests them with Playwright in parallel, fixes issues, retests, and reports findings. Only alerts the user when blocked.

## Usage

```
/qa                                            # test mail, calendar, content, forms
/qa --apps mail,forms                          # test specific apps
/qa --focus "test form submission and compose"  # prioritize specific flows
```

**Args:**

- `--apps` — comma-separated app names (default: `mail,calendar,content,forms`)
- `--focus` — natural language guidance for what to prioritize

## Orchestrator Steps

You (the agent running this skill) are the orchestrator. Follow these steps in order.

### Step 1: Parse Args

Parse the user's invocation to determine:

- **apps**: which apps to test (default: mail, calendar, content, forms)
- **focus**: optional test priority guidance

### Step 2: Check Credential Readiness

For each app, check if required credentials exist:

| App      | Check                                          | Can test without? |
|----------|-------------------------------------------------|-------------------|
| forms    | No credentials needed                          | Yes               |
| content  | No credentials needed (Notion is opt-in)       | Yes               |
| calendar | `templates/calendar/.env` has GOOGLE_CLIENT_ID | Partially — local events work, Google sync won't |
| mail     | `templates/mail/.env` has GOOGLE_CLIENT_ID     | Partially — UI renders, Gmail features won't |

Read each app's `.env` file (if it exists) to check. If credentials are missing:

- Still test the app — many features work without external APIs
- Include in the tester's instructions: "No Google credentials found. Test local features. Flag any feature that crashes without credentials as 'needs credentials' rather than a bug."
- Only alert the user (via SendMessage to team lead or AskUserQuestion) if the app **cannot start at all**

### Step 3: Start Dev Servers

Start each app's dev server on a dedicated port using `run_in_background`:

| App      | Port | Command |
|----------|------|---------|
| mail     | 9201 | `cd templates/mail && PORT=9201 pnpm dev` |
| calendar | 9202 | `cd templates/calendar && PORT=9202 pnpm dev` |
| content  | 9203 | `cd templates/content && PORT=9203 pnpm dev` |
| forms    | 9204 | `cd templates/forms && PORT=9204 pnpm dev` |

Start all servers in parallel (multiple Bash calls with `run_in_background: true`).

Then verify each server is ready by polling with curl:

```bash
for i in {1..30}; do curl -s -o /dev/null -w "%{http_code}" http://localhost:9201 && break; sleep 1; done
```

If a server fails to start within 30 seconds, skip that app and note it in the report.

### Step 4: Generate Test Plans

For each app, read these files to understand what to test:

1. `templates/<app>/client/routes/` or `templates/<app>/client/routes.ts` — discover all pages
2. `templates/<app>/CLAUDE.md` — features, API routes, data model
3. `templates/<app>/server/routes/api/` — API endpoints

Combine with any `--focus` guidance to produce a test plan. The test plan is a numbered list of user-facing flows to verify. Example:

```
1. Home page loads without errors
2. Create a new item via the UI
3. Edit an existing item
4. Delete an item
5. Check all navigation links work
6. Verify no console errors on any page
7. Verify no failed network requests
```

### Step 5: Create Team and Spawn Testers

Create a team and spawn one tester agent per app, all in parallel:

```
TeamCreate: name="qa", description="QA testing sweep"
```

Create one task per app:

```
TaskCreate: subject="QA test <app> on port <port>", description="<test plan>"
```

Then spawn tester agents in parallel using the Agent tool. Each agent gets:

- `name`: `qa-<app>` (e.g., `qa-mail`)
- `team_name`: `qa`
- `mode`: `auto`
- The full tester prompt (see Tester Agent Prompt below)

### Step 6: Monitor and Alert

After spawning testers, wait for their idle notifications and task updates.

- When a tester completes its task, note its findings
- When a tester reports being blocked (missing credentials, app won't start, needs user input), relay that to the user via AskUserQuestion
- When all testers are done, proceed to Step 7

### Step 7: Compile Report and Shutdown

Gather all tester reports from their task updates. Print a compiled summary:

```markdown
# QA Summary — <date>

## Apps Tested: N
## Total Issues Found: N
## Fixed: N
## Needs Review: N

### Mail App
[tester report]

### Forms App
[tester report]

...
```

Then shut down all teammates:

```
SendMessage to each tester: { type: "shutdown_request" }
```

---

## Tester Agent Prompt

Use this as the prompt when spawning each tester agent via the Agent tool. Fill in the `{{placeholders}}`:

---

**START OF TESTER PROMPT**

You are a QA tester for the **{{app_name}}** app running at `http://localhost:{{port}}`.

## Your Mission

Test the app thoroughly using Playwright MCP tools. Find bugs, fix them, retest. Report your findings.

## Team Context

You are on team "qa". Your name is "qa-{{app_name}}".

- Use TaskUpdate to mark your task as `in_progress` when you start
- Use TaskUpdate to mark your task as `completed` when done, with your report in the description
- If you are blocked and need user input, send a message to the team lead explaining what you need

## Credential Status

{{credential_status}}

## Test Plan

{{test_plan}}

## How to Test

Use these Playwright MCP tools:

1. **Navigate**: `browser_navigate` to `http://localhost:{{port}}<path>`
2. **See the page**: `browser_snapshot` — returns an accessibility tree showing all visible elements with `ref` attributes
3. **Click**: `browser_click` with `ref` from the snapshot
4. **Type**: `browser_type` with `ref` and `text`
5. **Fill forms**: `browser_fill_form` with `ref` and `values`
6. **Check console**: `browser_console_messages` — look for errors
7. **Check network**: `browser_network_requests` — look for failed requests (4xx, 5xx)
8. **Wait**: `browser_wait_for` when you need to wait for content to appear
9. **Screenshot**: `browser_take_screenshot` when you want to capture the visual state

### Testing Loop

For each test in your plan:

1. Navigate to the relevant page
2. Take a snapshot to see what's on screen
3. Check console messages for errors
4. Check network requests for failures
5. Interact with the page — click buttons, fill forms, navigate flows
6. If something is broken:
   a. Document: what page, what's wrong
   b. Read the relevant source files to understand the issue
   c. Fix the code
   d. Wait 2-3 seconds for Vite HMR to hot-reload
   e. Retest by taking a new snapshot
   f. If still broken after 3 attempts, mark as "needs human review" and move on
7. Move to the next test

After completing all tests, do **one more pass** on any pages where you found issues to verify fixes didn't break other things.

**Maximum 2 full passes.** Don't loop forever.

### Start by navigating to the home page

Always start by navigating to `http://localhost:{{port}}/` and taking a snapshot to verify the app is running.

If the app shows an error page or fails to load, check the dev server output and try to diagnose. If it's a missing dependency or config issue, report it and stop — don't spend time debugging infrastructure.

## Isolation Rules

**CRITICAL:** You may ONLY modify files within `templates/{{app_name}}/`. If a bug requires changes to `packages/core/` or any other template, report it as a finding but do NOT fix it.

After modifying any source file, run:
```bash
npx prettier --write <file>
```

## What Counts as a Bug

- Page crashes or shows error overlay
- Console errors (not warnings — errors only)
- Network requests returning 4xx or 5xx
- Buttons/links that don't work
- Forms that don't submit
- Data that doesn't save or display
- Layout severely broken (overlapping text, invisible elements)
- Features described in CLAUDE.md that don't work

What is NOT a bug:
- Minor styling preferences
- Missing features that aren't described in CLAUDE.md
- Warnings in console
- Slow loading (unless > 10 seconds)

## Report Format

When you're done, update your task (via TaskUpdate) with status `completed` and set the description to your report:

```markdown
## QA Report: {{app_name}}

### Summary: N found, N fixed, N needs review

#### Fixed
1. **Short description** — What file you changed and why

#### Needs Review
1. **Short description** — Why you couldn't fix it

#### Skipped (needs credentials)
1. **Feature name** — What credential is needed

#### Pages Tested
- /path (page name) — status (OK, N issues fixed, N needs review)
```

**END OF TESTER PROMPT**

---

## Troubleshooting

### Port already in use

Kill the process on the port before starting:

```bash
lsof -ti :9201 | xargs kill -9 2>/dev/null; true
```

### Dev server won't start

Common causes:

- Missing `node_modules` — run `pnpm install` from root first
- Missing `.env` file — some apps need one even if empty. Check `.env.example`
- Port conflict — kill stale processes (see above)
- Build error in core — run `pnpm --filter @agent-native/core build` first

### Playwright MCP not responding

The Playwright MCP server must be configured in Claude Code's MCP settings. If browser tools aren't available, the tester agent should report "Playwright MCP tools not available" and stop.

### HMR not picking up changes

After editing a file, wait 2-3 seconds. If the page doesn't update, try a hard refresh by navigating away and back. Vite HMR sometimes misses changes in server-side files — restart the dev server if needed.

### App shows "credentials not configured" when they are

This is a known issue. The tester should:

1. Check the `.env` file exists and has the right variable names
2. Check if the app reads from `.env` or `data/.env`
3. Check the server plugin that loads credentials
4. Try to fix the credential detection logic
5. If unfixable, report as "needs review" with details about what the app expects vs. what's configured
