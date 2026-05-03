# Tracked Events Catalog

Events tracked by application instrumentation and stored in the configured application events table. The default BigQuery table is `analytics.events_partitioned`; deployments can override it with `ANALYTICS_BIGQUERY_EVENTS_TABLE`.

## Event Categories (`event` column)

| Event         | Description                                   |
| ------------- | --------------------------------------------- |
| `signup`      | User completes signup                         |
| `pageView`    | User views a page in the app                  |
| `impression`  | User sees a UI element (content, modal, etc.) |
| `interaction` | User interacts with a UI element              |

## Common Event Names (`name` column)

### Signup & Onboarding

- `signup` — New user registration
- `onboarding: cli auth` — User visits CLI auth page
- `authorize cli` — User authorizes CLI/plugin access

### Agent Chat / AI

- `agent chat message submitted` — User sends an agent chat message
- `agent chat message received` — AI responds
- `agent chat code applied` — AI-generated code applied to project

### Content Editing

- `content saved` — Content entry saved
- `content published` — Content entry published
- `content created` — New content entry created

### Traffic

- `pageView` or `pageview` events with `url` showing which app pages are visited, when the configured event source records page traffic

## Data Properties (in the `data` JSON blob)

Every event includes these base properties by default (from `track.function.ts`):

### User Identity

- `userId` — Firebase UID
- `userEmail` — User email
- `organizationId` — Current space ID
- `rootOrganizationId` — Parent org ID
- `rootOrgName` — Parent org name
- `kind` — Org kind (`cms`, `shopify`)
- `organizationType` — `space` or `root`
- `userLoggedIn` — Boolean
- `accountType` — `shopify` or `cms`

### Session & Visitor

- `sessionId` — App session ID
- `visitorId` — Persistent visitor cookie
- `sessionUrl` — FullStory session URL

### Attribution

- `utmSource`, `utmMedium`, `utmCampaign` — UTM params
- `referrer` — Current referrer
- `initialReferrer` — First-touch referrer
- `attributionBucket` — Parsed referrer medium
- `initialAttributionBucket` — First-touch parsed medium

### Technical

- `browser`, `browserVersion` — Browser info
- `os`, `osVersion` — OS info
- `deviceType`, `deviceVendor` — Device info
- `userAgent` — Raw user agent string
- `app` — Always `"app"`
- `host` — Hostname
- `url` — Full URL
- `appEnvironment` — `web`, `vscode`, or `electron`
- `isVsCode` — Boolean

### Context

- `contentId` — Content entry ID (if editing)
- `model` — Model ID (if editing)
- `modelName` — Model name (if editing)
- `isEnterpriseCompany` — Boolean
- `featureFlags` — Active feature flags object
- `abTests` — A/B test flags object

### Build Info

- `buildGitHash` — Git commit hash of the build
- `buildTimestamp` — Build timestamp
