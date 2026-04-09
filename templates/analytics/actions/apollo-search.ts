import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  searchPeople,
  enrichPerson,
  searchOrganizations,
  enrichOrganization,
} from "../server/lib/apollo";

export default defineAction({
  description:
    "Search and enrich contacts/companies via Apollo.io. Pass email, domain, company, name, or title.",
  schema: z.object({
    email: z.string().optional().describe("Enrich a person by email"),
    domain: z.string().optional().describe("Enrich an organization by domain"),
    company: z.string().optional().describe("Search by company name"),
    name: z.string().optional().describe("Search by person name"),
    title: z.string().optional().describe("Search by job title"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    if (args.email) {
      const person = await enrichPerson(args.email);
      return { person };
    } else if (args.domain) {
      const org = await enrichOrganization(args.domain);
      return { organization: org };
    } else if (args.company && !args.name && !args.title) {
      const result = await searchOrganizations(args.company);
      return { organizations: result.organizations, total: result.total };
    } else {
      const result = await searchPeople({
        q_person_name: args.name,
        q_organization_name: args.company,
        person_titles: args.title ? [args.title] : undefined,
      });
      return { people: result.people, total: result.total };
    }
  },
});
