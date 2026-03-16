#!/usr/bin/env tsx
/**
 * Search and enrich contacts/companies via Apollo.io.
 *
 * Usage:
 *   pnpm script apollo-search --email=user@example.com
 *   pnpm script apollo-search --company=Acme
 *   pnpm script apollo-search --domain=acme.com
 *   pnpm script apollo-search --name="John Smith" --company=Acme
 *   pnpm script apollo-search --title=CTO --company=Acme
 */
import { parseArgs, output } from "./helpers";
import {
  searchPeople,
  enrichPerson,
  searchOrganizations,
  enrichOrganization,
} from "../server/lib/apollo";

const args = parseArgs();

if (args.email) {
  const person = await enrichPerson(args.email);
  if (person) {
    output({ person });
  } else {
    output({ error: `No person found for email: ${args.email}` });
  }
} else if (args.domain) {
  const org = await enrichOrganization(args.domain);
  if (org) {
    output({ organization: org });
  } else {
    output({ error: `No organization found for domain: ${args.domain}` });
  }
} else if (args.company && !args.name && !args.title) {
  const result = await searchOrganizations(args.company);
  output({ organizations: result.organizations, total: result.total });
} else {
  const result = await searchPeople({
    q_person_name: args.name,
    q_organization_name: args.company,
    person_titles: args.title ? [args.title] : undefined,
  });
  output({ people: result.people, total: result.total });
}
