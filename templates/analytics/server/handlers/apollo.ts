import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { requireCredential } from "../lib/credentials";
import {
  searchPeople,
  enrichPerson,
  searchOrganizations,
  enrichOrganization,
} from "../lib/apollo";

export const handleApolloSearch = defineEventHandler(async (event) => {
  const missing = await requireCredential(event, "APOLLO_API_KEY", "Apollo");
  if (missing) return missing;
  try {
    const { email, domain, company, name, title } = getQuery(event);

    if (email) {
      const person = await enrichPerson(email as string);
      return { person };
    } else if (domain) {
      const org = await enrichOrganization(domain as string);
      return { organization: org };
    } else if (company && !name && !title) {
      const result = await searchOrganizations(company as string);
      return { organizations: result.organizations, total: result.total };
    } else {
      const result = await searchPeople({
        q_person_name: name as string | undefined,
        q_organization_name: company as string | undefined,
        person_titles: title ? [title as string] : undefined,
      });
      return { people: result.people, total: result.total };
    }
  } catch (err: any) {
    console.error("Apollo search error:", err.message);
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});
