---
slug: how-to-write-a-bug-report
use_case: bug-reports-with-console-logs
job_id: job-bug-report
title: "How do you write a bug report an engineer can act on?"
meta_description: "A good bug report answers four questions without a follow-up. Here's a copy-and-paste template, how to capture console errors, and when a recording beats text."
topic: coding-agents
apps: [clips]
audience: technical
published: 2026-10-14
author: "Agent-Native Team"
app_cta_url: "https://clips.agent-native.com"
cta_label: "Record a clip"
screenshot_alt: "The Clips library with recordings, and the recorder panel open with screen, camera, and microphone options and Library, Meetings, Dictate, and Settings tabs"
cta_band_heading: "Record your next bug"
cta_band_subhead: "Capture the video, the console errors, and the failed requests behind one link."
related_resources:
  - label: "Agent-Native Clips"
    url: "https://www.agent-native.com/apps/clips/"
  - label: "Clips documentation"
    url: "https://www.agent-native.com/docs/template-clips"
related: []
internal:
  target_terms: "how to write a bug report (US 200/mo, KD 2); bug report template (400, KD 0); bug report format (200); software bug report (150); bug report form (150); bug report example(s) and sample (270 combined)"
  verify: "Redaction wording against the live Clips page. Whether storage-before-share is still required."
---

A bug report an engineer can act on says what you did, what you expected, and what happened instead, plus where it happened. When the browser threw errors or a request failed, include those too. The template below covers all of it.

Most bad reports fail in one place: the engineer has to ask a question before they can start. This guide is about writing the report so they don't have to.

## What should a bug report include?

| Field | What to write |
| --- | --- |
| Title | What broke and where, in one line. "Save button stays disabled after editing a field," not "Bug on settings page." |
| Steps to reproduce | The exact actions, in order, starting from a known state. |
| Expected result | What you thought would happen. |
| Actual result | What happened instead, including any error message on screen. |
| Environment | Browser and version, device, account type, and the page URL. |
| Evidence | Console errors, failed requests with their status codes, and a screenshot or recording. |

## What's a bug report template you can copy?

```
Title: [What broke] on [where]

Steps to reproduce:
1.
2.
3.

Expected result:

Actual result:

Environment:
- Browser and version:
- Device:
- Account or plan:
- Page URL:

Evidence:
- Console errors:
- Failed requests (URL and status):
- Screenshot or recording:
```

## How do you capture the console and network details?

In Chrome, open DevTools and reproduce the bug while you watch two tabs. The Console tab shows errors, so copy the error text. The Network tab shows requests, so note any that failed, with the URL and status code. If the page reloads, turn on "Preserve log" first, or the evidence disappears.

Clips does this for you. With its Chrome extension, it captures console errors and failed network requests alongside a screen recording. The capture is redacted, and it never includes headers, bodies, or cookies.

## When should you record the bug instead of writing it?

| Your situation | Option | What to check |
| --- | --- | --- |
| The bug is one line and the cause is obvious | A written report using the template | Fast, but the reader can't see what you saw. |
| The bug depends on sequence or state | A written report with a screen recording attached | The recording shows the order of actions. Check who can open the link before you share it. |
| A coding agent will investigate | A recording through a tool that gives agents a readable link, such as Clips | Clips gives the agent a transcript and timestamped images. Check that your agent can open the link and read images. |

Agent-Native publishes Clips, so weigh the last row accordingly. The first two work fine when the bug is simple or your team already has a process.

<!-- screenshot -->

<!-- try-it -->

## What should you check before you share it?

Logs and recordings can include customer data. Look at what's on screen and in the console before you share. Clips recordings use public links by default unless your organization changes that, so use private or organization access when the content is sensitive. Clips also needs somewhere to store recordings: connect Builder or your own storage, or it offers the recording as a download instead of a link. Your agent needs to be able to open the link and read images to use a recording. Clips is labeled alpha, so expect rough edges.

## Frequently asked questions

### What's the difference between expected and actual result?

Expected is what you thought would happen. Actual is what did happen. The gap between the two is the bug, so write both even when it feels obvious.

### How many steps to reproduce should I include?

Enough that someone who has never seen the bug can follow them from a known starting point, like a fresh login. If the bug needs specific data, say so.

### Should I include console errors?

Yes, if there are any. Copy the error text itself rather than a screenshot of it, so the engineer can search for it.

### Can an AI agent use a bug report?

Yes. A coding agent can work from a written report and the logs you paste. With a Clips recording, it can also read the transcript and timestamped images through one link, as long as it can open the link and read images.

### Is Clips free?

Yes. Clips is free and open source. It's labeled alpha, so expect rough edges.
