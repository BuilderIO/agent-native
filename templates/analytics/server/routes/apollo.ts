import { type RequestHandler } from "express";
import { requireEnvKey } from "@agent-native/core/server";
import {
  searchPeople,
  enrichPerson,
  searchOrganizations,
  enrichOrganization,
} from "../lib/apollo";

export const handleApolloSearch: RequestHandler = async (req, res) => {
  if (requireEnvKey(res, "APOLLO_API_KEY", "Apollo")) return;
  try {
    const email = req.query.email as string | undefined;
    const domain = req.query.domain as string | undefined;
    const company = req.query.company as string | undefined;
    const name = req.query.name as string | undefined;
    const title = req.query.title as string | undefined;

    if (email) {
      const person = await enrichPerson(email);
      res.json({ person });
    } else if (domain) {
      const org = await enrichOrganization(domain);
      res.json({ organization: org });
    } else if (company && !name && !title) {
      const result = await searchOrganizations(company);
      res.json({ organizations: result.organizations, total: result.total });
    } else {
      const result = await searchPeople({
        q_person_name: name,
        q_organization_name: company,
        person_titles: title ? [title] : undefined,
      });
      res.json({ people: result.people, total: result.total });
    }
  } catch (err: any) {
    console.error("Apollo search error:", err.message);
    res.status(500).json({ error: err.message });
  }
};
