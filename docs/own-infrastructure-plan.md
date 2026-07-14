# Serving RambleOn with your own AI and storage endpoints

Goal: RambleOn is operated as **your** product. Users get storage, transcription,
and AI features from endpoints you control — no Builder.io account, no user
data flowing to third parties you didn't choose. Builder stays available as a
fallback/dev convenience, not as the product's backbone.

Status: plan. Rewritten 2026-07-14 (an earlier version of this document was
lost — it lived outside the repo). Findings below are verified against the
code as of `safe/main3`.

## Where Builder is wired in today (verified touchpoints)

| Concern | Current path | Code seam |
| --- | --- | --- |
| Video object storage + CDN | Uploads relay tray/browser → app server → Builder object storage; playback via `cdn.builder.io` | `server/lib/video-storage.ts` — provider loop; **non-Builder providers already win over Builder** |
| Backup speech-to-text | Builder Gemini transcription, Groq as secondary | `actions/request-transcript.ts` fallback path; gate currently buggy (task #12: reports "no provider" while Builder works) |
| Transcript cleanup / AI titles / meeting notes | Builder Gemini through the core model gateway (credits-metered) or BYOK | `cleanup-transcript`, post-finalize dispatch |
| Agent chat | Anthropic/OpenAI — BYOK or Builder-managed keys | core agent gateway; sidebar API Keys & Connections |
| Credits & setup UX | `get-builder-credit-status`, AI setup leads with Builder Connect | settings/onboarding surfaces |
| Background video compression | Dark-launched media worker + Builder compress-media | `server/lib/media-worker.ts`, `CLIPS_MEDIA_WORKER_*` env, signed callback route |

Two structural facts make replacement tractable:

1. **The app server is the only thing that talks to storage/AI.** Clients
   (web, tray, extension) never hold Builder credentials; they upload to the
   app server, which relays. Swapping the backend provider is invisible to
   every client.
2. **The provider resolution order already prefers your endpoints.** Any
   configured S3-compatible provider beats Builder without a code change.

## Replacement architecture

### 1. Storage — S3-compatible endpoint you host

- Run MinIO / Garage (or use R2/Hetzner if "your endpoint" may be rented) and
  fill in the existing **S3 settings** in the app. Nothing else changes:
  `video-storage.ts` picks it up ahead of Builder, uploads land on your
  endpoint, playback proxies/signs from there.
- Multi-tenant: per-workspace buckets or key prefixes; the S3 provider
  resolves per request context, so per-org credentials are the natural unit.
- Local/privacy mode falls out for free: a MinIO on the user's machine keeps
  every byte local.

### 2. Transcription — your own speech endpoint

- Host whisper (faster-whisper / whisper.cpp server) behind an
  OpenAI-compatible `/audio/transcriptions` endpoint.
- Wire it as a third fallback provider next to the Builder/Groq paths in
  `request-transcript.ts` (config: base URL + key in app settings/secrets).
- Fix task #12 in the same pass — the availability gate must probe the
  configured provider, not Builder-specific state.
- Note: primary transcription is already local (tray whisper / browser
  speech); this endpoint only serves uploads and retry/fallback.

### 3. Cleanup, titles, meeting notes — your model gateway

- These call Gemini through the core model gateway. Point them at your own
  OpenAI-compatible gateway (LiteLLM/portkey style) via BYOK settings, or
  terminate at your infra with provider keys you hold.
- Most other AI already flows through the agent chat by design
  (`delegate-to-agent`), so the agent-chat key config is the single lever for
  the rest.

### 4. Compression — the media worker is already "own endpoint" shaped

- Upstream's dark-launched media worker is exactly this pattern: an external
  worker URL + signing secret + callback route. Implement the worker on your
  infra and set `CLIPS_MEDIA_WORKER_URL` / `_SECRET` / `_ENABLED`. No Builder
  involvement in the contract.

### 5. Setup/UX changes

- Onboarding: lead with "RambleOn Cloud" (your endpoints) instead of
  Builder Connect; keep Builder and raw BYOK as advanced options.
- Replace `get-builder-credit-status` surfaces with your own quota/plan
  status (same UI slots).
- Add the storage transparency line in Settings ("Videos are stored on …") —
  today the app never tells the user where bytes go.

## Suggested order

1. S3 settings → your MinIO (hours; zero code). Proves storage independence.
2. Task #12 gate fix + pluggable transcription fallback endpoint (small PR).
3. Model gateway BYOK for cleanup/titles (config-mostly).
4. Media worker deployment (when compression matters).
5. Onboarding/credit-surface rebrand (last — pure UX).

## Open questions

- Billing/quota model for your users (per-seat? storage-metered?) — decides
  whether the credit-status surfaces are replaced or deleted.
- Egress/CDN strategy for shared clips if storage is self-hosted (plain
  reverse proxy vs. real CDN).
- Whether desktop builds should pin a default server URL per distribution
  (RambleOn-branded builds pointing at your hosted instance).
