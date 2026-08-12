# Clips → Context Agent: Retrieval + Automation Spec

> Standalone spec for building a context agent that consumes finished Clips
> meetings (Granola/Wispr-Flow-style call recordings) and, separately, sets up
> recurring workflows against Clips. Self-contained — no other document or
> conversation needed. All claims are file:line-verified against
> `agent-native` at commit `31fdef96c`; treat any absent-vs-partial distinction
> literally, since several things below look like they should exist and do not.
>
> This spec does not touch or depend on Clips' desktop meeting-detection code
> (how a call gets recorded in the first place). It starts from "a meeting
> finished recording and has a transcript" and covers only retrieval and
> automation from there.

---

## 0. What Clips is, in one paragraph

Clips (`templates/clips` in the `agent-native` monorepo) is an Agent-Native
template — Loom-style screen recording + Granola-style meeting notetaker +
Wispr-Flow-style dictation. Every operation is a `defineAction` that is
simultaneously an agent tool and an HTTP endpoint at
`/_agent-native/actions/<name>`. Production instance:
`https://clips.agent-native.com`.

---

## 1. Direct answer: what calls do I make?

The minimum viable loop, **today, with zero changes to Clips**, is three HTTP
calls plus a poll:

```
1. GET  /_agent-native/actions/list-meetings?view=past&recordedOnly=true&limit=20
2. GET  /_agent-native/actions/get-meeting?id=<meetingId>          [poll until transcriptStatus=="ready"]
3. POST /_agent-native/actions/create-recording-agent-link          [optional — credential-free handoff]
```

All three carry `Authorization: Bearer <org service token>` (minting: §4).
Call 2's response contains the **complete, untruncated** transcript plus the
AI summary, bullets, action items, and participants. That is the whole
payload — nothing else to fetch.

---

## 2. The trigger — what "the call is done" means

**There is no meeting-lifecycle event today.** Verified: `finalize-meeting.ts`
emits nothing (`grep -n "emit(" templates/clips/actions/finalize-meeting.ts`
returns zero results). Clips registers exactly four events in
`templates/clips/server/plugins/db.ts` — `clip.created` (`:1709`),
`clip.shared` (`:1722`), `clip.viewed` (`:1733`), `calendar-synced` (`:1743`)
— none meeting-scoped. `clip.created` is not a substitute: its payload
(`{ clipId, title?, createdBy?, duration?, url? }`) has no `meetingId`, and it
fires before any transcript exists.

| Option | Cost | Latency | Notes |
|---|---|---|---|
| **A. Poll** `list-meetings` | zero Clips changes | your poll interval | **Use this for v1** |
| **B. Add a `meeting.finalized` event** | ~20 lines in Clips | immediate | Unlocks automations (§7) with no further code |
| **C. Extend the post-finalize dispatch** | ~40 lines, edits Clips internals | immediate | Only if you need the durable retry ledger brain-export has |

### Option B, fully specified (hand to whoever owns the Clips repo)

**B1** — register the event in `templates/clips/server/plugins/db.ts`, next to
the existing four (after `:1754`):

```ts
registerEvent({
  name: "meeting.finalized",
  description:
    "A meeting's transcript was summarized and its notes, bullets, and action items are ready.",
  payloadSchema: z.object({
    meetingId: z.string(),
    recordingId: z.string().nullable().optional(),
    ownerEmail: z.string().nullable().optional(),
    finalizedAt: z.string(),
  }) as any,
});
```

**B2** — import the emitter in `templates/clips/actions/finalize-meeting.ts`
(matching `finalize-recording.ts:18`):

```ts
import { emit } from "@agent-native/core/event-bus";
```

**B3** — emit before the return at `finalize-meeting.ts:287`. Both locals
already exist in that file (`meeting.recordingId`, `meeting.ownerEmail`):

```ts
try {
  emit(
    "meeting.finalized",
    {
      meetingId: args.meetingId,
      recordingId: meeting.recordingId,
      ownerEmail: meeting.ownerEmail,
      finalizedAt: new Date().toISOString(),
    },
    { owner: meeting.ownerEmail },
  );
} catch (err) {
  console.warn("[finalize-meeting] meeting.finalized emit failed:", err);
}
```

**B4** — the third argument is not optional in practice. `{ owner: ownerEmail }`
is what `automationMatchesEventOwner`
(`packages/core/src/triggers/dispatcher.ts:260-263`) matches against an
automation's creator. Omit it and events are silently dropped — organization
scope grants *visibility*, not broadcast.

---

## 3. The ordered retrieval sequence

### Step 1 — find the meeting that just ended

`list-meetings` (`templates/clips/actions/list-meetings.ts:54`, `GET`).

Schema:
```
view: "upcoming" | "past" | "all" | "trash"   (default "upcoming")
limit: 1..500                                  (default 100)
offset: 0..                                    (default 0)
recordedOnly: boolean                          (default false)
includeLiveCalendar: boolean                   (default true)
upcomingWithinMin: 1..43200
includeStartedWithinMin: 0..60
excludePersonalSoloEvents: boolean
excludeDeclinedEvents: boolean
```

Returns `{ meetings, calendarErrors }`. Each meeting is the full
`clips_meetings` row plus a derived `summaryPreview`.

**Use `view=past&recordedOnly=true`.** `recordedOnly` adds
`isNotNull(meetings.recordingId)` and suppresses the live-calendar merge
entirely, so every id you get back is a **persisted** row — no virtual
calendar projections. This matters for step 2. Sort by `actualEnd`.

### Step 2 — pull the content

`get-meeting` (`templates/clips/actions/get-meeting.ts:47`, `GET`). Schema:
`{ id: string }`. That is the entire input.

**⚠️ `get-meeting` is not a pure read.** On a *virtual* calendar id it calls
`materializeCalendarMeetingFromVirtualId`, which **writes a meeting row**. A
polling loop on a virtual id writes on every iteration. Ids sourced from
`view=past&recordedOnly=true` in step 1 are always persisted, so this is safe
as long as you only ever poll ids from that query.

Returns:
```
{
  meeting: { ...clips_meetings row,
             bullets: {text}[],
             actionItemsParsed: {assigneeEmail?, text, dueDate?}[] },
  participants: meeting_participants[],   // full rows
  actionItems:  meeting_action_items[],   // full rows
  recording:    recordings row | null,
  transcript:   recording_transcripts row | null,
  role: access.role
}
```

**Critical: `transcript.fullText` is the complete, unbounded DB row.** Do
**not** use `get-recording-player-data` for this — it routes the transcript
through `boundTranscriptForAgent` and caps it at **12,000 characters** when
the caller is `tool`/`mcp`/`a2a`. A context agent using that action instead of
`get-meeting` will silently receive truncated transcripts.

Gate on `meeting.transcriptStatus` (`idle | pending | ready | failed`):
- `pending` → `finalize-meeting` in flight (stale after 2 min). Re-poll.
- `failed` → retry with `finalize-meeting { meetingId, force: true }`.
- `ready` → summary, bullets, action items, participants, and full transcript
  are all in this one response.

**Failure mode you must handle:** `get-meeting` returns `{ meeting: null }`
for *missing*, *inaccessible*, and *trashed* alike — three separate code
paths, no throw. Your pipeline cannot distinguish "no such meeting" from "you
can't see it." Treat `meeting === null` as unknown-cause failure, never as "no
meeting."

**No speaker attribution anywhere.** Transcript segments carry
`{ startMs, endMs, text, source?: "mic" | "system" }` — no `speaker` or
`participantEmail` field, and `meeting_participants` is never joined onto
segments. Do not design around per-speaker lines.

### Step 3 — credential-free handoff (optional)

`create-recording-agent-link`
(`templates/clips/actions/create-recording-agent-link.ts:34`, `POST`,
`readOnly: true`). Schema: `{ recordingId: string, agentLabel?: string,
ttlSeconds?: int }`. Default TTL 2 hours, cap 7 days.

Returns `{ recordingId, url, contextUrl, expiresAt, ttlSeconds }`, where
`contextUrl` serves a JSON envelope
(`{ type: "agent-native.clip.context", ..., transcript: {...},
recommendedFrames: [...], ... }`) with an **unbounded** transcript.

**The hard limit: this is recording-scoped, not meeting-scoped.** There is no
`create-meeting-agent-link`. The envelope carries transcript + frames +
chapters + CTAs, and **never** carries `summaryMd`, `bullets`, `actionItems`,
or `participants`. If you need those in a shareable link, forward them
inline from the `get-meeting` response — do not expect this endpoint to
carry them.

---

## 4. Auth — which credential, where it comes from

**Use an org service token.** Long-lived, org-owned, not tied to a person.

```http
POST https://clips.agent-native.com/_agent-native/actions/create-org-service-token
content-type: application/json
authorization: Bearer <a connect token from the device flow — see below>

{"name":"context-agent","ttlDays":365}
```

Returns `{ token, id, serviceName, serviceEmail, orgId, ttlDays, note }` — the
token value is returned exactly once and never stored. Org owner/admin only.
CLI equivalent:
`npx @agent-native/core@latest connect <appUrl> --service-token context-agent --ttl-days 365`.

**⚠️ First thing that breaks on self-hosted/localhost Clips.** Minting throws
a 500 ("Could not determine the app URL") unless it can resolve an app URL or
`A2A_SECRET` is set. Set `APP_URL` or `A2A_SECRET` on the Clips deployment
before minting.

**Getting the bootstrap credential (headless device flow), if you don't
already have session access:**
1. `POST /mcp/connect/device/start` — no auth, no body →
   `{ device_code, user_code, verification_uri_complete, interval, expires_in }`.
2. A human opens `verification_uri_complete` and approves.
3. `POST /mcp/connect/device/poll` with `{"device_code":"<code>"}` →
   `{ status: "pending"|"approved"|"expired"|"consumed"|"not_found", token?, ... }`.

**⚠️ Unverified — check this first, it gates everything above.** The service
token's identity is a synthetic `svc-<name>@service.<orgId>` email that is
**never inserted into `org_members`**. Whether `get-meeting` returns
non-null data for a service-token caller depends on org-visibility rules, not
personal ownership, and no one has run a live request to confirm this against
a real meeting. **Do a 30-second curl test against a real deployed meeting
before building anything on top of this token.**

**Two things that will NOT work, so don't try:**
- `/api/public-meeting` (an alternate meeting-scoped JSON route) does **not**
  accept an org service token — it resolves anonymous. Use
  `/_agent-native/actions/get-meeting` instead.
- A2A `actions/invoke` is dead against every Clips action today (see §6) —
  don't reach for it as a shortcut past the HTTP path above.

---

## 5. The literal HTTP request/response shape

Default mount rule: method defaults to `POST` unless the action declares
`http: { method: "GET" }`; path defaults to
`/_agent-native/actions/<kebab-case-action-filename>`.

```http
GET https://clips.agent-native.com/_agent-native/actions/get-meeting?id=mtg_abc123 HTTP/1.1
authorization: Bearer <token>
```

```http
POST https://clips.agent-native.com/_agent-native/actions/create-recording-agent-link HTTP/1.1
content-type: application/json
authorization: Bearer <token>

{"recordingId":"rec_abc123","agentLabel":"context-agent","ttlSeconds":604800}
```

Arrays over GET serialize as `key[]=a&key[]=b`. Do **not** send
`X-Agent-Native-Frontend: 1` — it changes caller identity to `"frontend"` with
no auth benefit and exposes you to an unrelated stale-build check.

Responses: action return value as JSON on success; `400` on zod validation
failure; `405` on wrong method; `500` (detail withheld) on uncategorized
errors.

**There is no action-discovery endpoint.** No OpenAPI document exists.
Clips' `/.well-known/agent-card.json` publishes `"skills": []`. **Hardcode
the action names from this document** rather than trying to discover them.

---

## 6. Why not MCP or A2A `actions/invoke`

Short version: they don't work against Clips today, and building around that
gap is out of scope for a context agent — use the HTTP path in §5.

- **MCP** (`POST /mcp` or `POST /_agent-native/mcp`) advertises only a compact
  builtin catalog by default: `list_apps`, `open_app`, `ask_app`,
  `ask_app_status`, `create_embed_session`, `tool-search`. Clips' server
  plugin passes no `mcp` option, so **`get-meeting` is not callable over MCP**.
  The only reliably callable Clips tool over MCP is `ask_app` (natural
  language in, natural language out).
- **A2A `actions/invoke`** requires an action to declare
  `publicAgent: { expose: true, readOnly: true, requiresAuth: true }`.
  **Zero Clips actions declare this** (verified by grep). Consequence:
  Clips' A2A agent card publishes `skills: []`, and `actions/invoke` returns
  `status: "failed"` for every action name you try.
- **A2A `message/send`** (natural language) does work and runs the full
  Clips agent loop — useful for "chat with the Clips agent," not for
  structured retrieval. `Authorization: Bearer <HS256 JWT>` signed with
  `A2A_SECRET`, 15-minute default TTL.

If you later want direct, schema-typed cross-agent calls instead of the HTTP
path in §5, someone with write access to Clips needs to add `publicAgent` to
`get-meeting`/`list-meetings` and add an `mcp:` catalog option to
`templates/clips/server/plugins/agent-chat.ts`. That is a Clips-repo change,
not something the context agent can do from its side.

---

## 7. Recurring workflows against Clips

**Automations are rows in Clips' SQL resource store, not repo files** —
despite the `jobs/<name>.md` naming convention, they're written and read
through the framework, not `git`. Format: YAML frontmatter + a
natural-language body, run through a full agent loop on trigger. There is no
way to bind a job directly to one action with fixed arguments — it always
goes through the agent.

**How to create one, from outside Clips:** tell the Clips agent to, via
`ask_app` (MCP) or A2A `message/send` (natural language). The underlying tool
is `manage-automations` (`action`: `list-events | list | define | update |
delete | fire-test | run-now`), but it is agent-only — there is no
`/_agent-native/actions/manage-automations` HTTP route. **Call
`action=list-events` before `action=define`** — the tool description says so
explicitly.

Two triggers: `schedule` (5-field cron, IANA timezone support) or `event`
(subscribes to a registered event name — see §2 for why `meeting.finalized`
doesn't exist yet).

**Two traps to encode in any workflow you define:**
- **Owner scoping.** An automation only fires for events emitted with
  `{ owner: <the automation creator's email> }`. Org-wide visibility does not
  mean org-wide broadcast.
- **Conditions fail closed.** A natural-language `condition` is classified by
  a fast model; on API failure it evaluates to `false` and the automation is
  silently skipped. Don't confuse "condition classifier had an outage" with
  "condition genuinely didn't match."

**The payoff, once `meeting.finalized` exists (§2, Option B):** you (or any
user) can create event-triggered and scheduled workflows against Clips
**purely through chat** — no further engineering. The automation
infrastructure is already fully built; only the event is missing.

**⚠️ Separate blocker for "chat about meetings" specifically.** Clips' agent
starts with a fixed 21-tool `INITIAL_TOOL_NAMES` set, and **neither
`get-meeting` nor `list-meetings` is in it.** This doesn't block the HTTP path
in §5, but it means asking the Clips agent conversationally about meetings
depends on it reaching those tools via `tool-search` — a discovery round-trip
on every meetings question, not a tool it already holds. If meetings should
be a first-class chat topic, someone needs to add those two names to
`templates/clips/server/plugins/agent-chat.ts` — a small Clips-repo change,
not something you can do from the context-agent side.

---

## 8. Worked end-to-end example

Assume `CLIPS=https://clips.agent-native.com` and `$TOK` is an org service
token from §4.

```bash
# T+0  — call ends, Clips finalizes the meeting on its own (no action needed from you)

# T+5s — poll for the freshly-ended meeting
curl -s -H "authorization: Bearer $TOK" \
  "$CLIPS/_agent-native/actions/list-meetings?view=past&recordedOnly=true&limit=20"
# -> { "meetings": [ { "id": "mtg_abc", "actualEnd": "2026-08-11T15:04:11Z",
#                      "recordingId": "rec_abc", "transcriptStatus": "pending", ... } ] }

# T+5s..T+120s — poll until ready
curl -s -H "authorization: Bearer $TOK" \
  "$CLIPS/_agent-native/actions/get-meeting?id=mtg_abc"
# "pending" -> re-poll
# "failed"  -> POST .../finalize-meeting {"meetingId":"mtg_abc","force":true}
# null      -> unknown-cause failure, do not treat as "no meeting"

# T+~90s — ready. ONE response holds everything you need:
# {
#   "meeting": { "summaryMd": "## Decisions\n...", "bullets":[...],
#                "actionItemsParsed":[{"assigneeEmail":"a@b.com","text":"...","dueDate":"..."}], ... },
#   "participants": [...], "actionItems": [...], "recording": {...},
#   "transcript": { "fullText": "<COMPLETE, UNTRUNCATED>", "segmentsJson": "[...]" },
#   "role": "owner"
# }

# T+95s — OPTIONAL: shareable link for a downstream reader
curl -s -X POST -H "authorization: Bearer $TOK" -H "content-type: application/json" \
  -d '{"recordingId":"rec_abc","agentLabel":"context-agent","ttlSeconds":604800}' \
  "$CLIPS/_agent-native/actions/create-recording-agent-link"
# Remember: this carries transcript + frames only. Forward summaryMd/bullets/
# actionItems inline from the get-meeting response above.
```

End state: the context agent holds the full transcript, timestamped
segments, AI summary, bullets, action items with assignees and due dates, the
participant roster, and optionally a 7-day scoped URL for frames.

---

## 9. Things that do not exist — do not design around them as if they do

- **No meeting-lifecycle event** (§2) — build `meeting.finalized` if you want
  push instead of poll.
- **No inbound webhook for "call finished"** on Clips' side.
- **No meeting-scoped agent-readable link** — only recording-scoped, and it
  never carries summary/bullets/action items.
- **No delete/retire propagation** if Clips ever adds an export pipeline you
  consume from — a trashed recording leaves any downstream copy live.
- **No speaker diarization** — segments are `mic`/`system` only.
- **No meeting text search** — `search-recordings` never indexes
  `clips_meetings` (summaries, notes, action items aren't full-text
  searchable through any action).
- **No action-discovery endpoint** — hardcode names from this document.

## 10. Before you build anything — the one blocking check

Run the 30-second curl test in §4's warning: mint an org service token, call
`get-meeting` against one real, known meeting, and confirm you get back a
non-null result with the transcript. If that returns `{ meeting: null }`,
stop and resolve the org-visibility question before writing any pipeline code
— everything in §3 and §8 depends on that token actually having read access.
