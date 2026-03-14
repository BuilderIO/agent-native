---
name: apollo
description: >
  Enrich contacts and companies via Apollo.io for prospecting and sales intelligence.
  Use this skill when the user asks about contact details, company research, or finding decision-makers.
---

# Apollo.io Integration (Contact & Company Enrichment)

## Connection

- **Base URL**: `https://api.apollo.io`
- **Auth**: `x-api-key: $APOLLO_API_KEY`
- **Env vars**: `APOLLO_API_KEY`
- **Caching**: 10-minute in-memory cache, max 120 entries

## Server Lib & API Routes

- **File**: `server/lib/apollo.ts`

### Exported Functions

| Function | Description |
|---|---|
| `searchPeople(params)` | Search people by criteria |
| `enrichPerson(email)` | Enrich a contact by email (returns null on failure) |
| `searchOrganizations(query, params?)` | Search companies |
| `enrichOrganization(domain)` | Enrich company by domain (returns null on failure) |

### API Routes

| Route | Description |
|---|---|
| `GET /api/apollo/search` | Search contacts/companies |

## Script Usage

```bash
# Search by email
pnpm script apollo-search --email=user@example.com

# Search by company
pnpm script apollo-search --company=Deloitte

# Search by domain
pnpm script apollo-search --domain=example.com

# Find decision-makers
pnpm script apollo-search --company=Deloitte --title=CTO

# Search by name
pnpm script apollo-search --name="John Smith"
```

## Key Patterns & Gotchas

- `enrichPerson` and `enrichOrganization` swallow errors and return `null` on failure (try/catch)
- API uses POST for all searches and enrichment — POST responses are cached for 10 minutes
- API endpoints: `/v1/mixed_people/search`, `/v1/people/match`, `/v1/mixed_companies/search`, `/v1/organizations/enrich`
- Pagination info available via `response.pagination?.total_entries`
