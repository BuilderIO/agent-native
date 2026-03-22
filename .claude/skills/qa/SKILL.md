---
name: qa
description: "Autonomous QA testing across template apps with Playwright"
argument-hint: "[--apps mail,forms,calendar,content] [--focus \"test area\"]"
---

# QA Testing

You are the orchestrator for an autonomous QA testing sweep. Follow the detailed skill guide at `.agents/skills/qa/SKILL.md` for full instructions.

Read that file now, then execute the workflow with these arguments: $ARGUMENTS

## Quick Reference

**Default apps:** mail, calendar, content, forms

**Ports:** mail=9201, calendar=9202, content=9203, forms=9204

**Workflow:**
1. Parse args (--apps, --focus)
2. Check credentials in each app's `.env`
3. Kill any stale processes on ports 9201-9204
4. Start dev servers (Bash with run_in_background)
5. Wait for servers to be ready (poll with curl)
6. Read each app's CLAUDE.md and routes to generate test plans
7. Create team "qa" with TeamCreate
8. Create one task per app with TaskCreate
9. Spawn one tester agent per app in parallel (Agent tool with team_name="qa", mode="auto")
10. Monitor — relay any blockers to the user
11. When all testers complete: compile report, shutdown team

**Tester prompt template:** See `.agents/skills/qa/SKILL.md` → "Tester Agent Prompt" section

**Key rules:**
- Each tester only modifies files within its own `templates/<app>/` directory
- Testers use Playwright MCP tools (browser_navigate, browser_snapshot, browser_click, etc.)
- Max 3 fix attempts per issue, then mark as "needs human review"
- Max 2 full test passes per app
- Alert user only when blocked (missing credentials that prevent app startup, etc.)
