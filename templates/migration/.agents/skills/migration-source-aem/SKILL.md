---
name: migration-source-aem
description: >-
  AEM source-adapter guidance for Migration Workbench. Use when the source is an
  AEM site, package, API, repository, crawl, or enterprise description.
---

# AEM Migration Source

## Rule

Model AEM input as evidence from one or more modes: crawl, API, package, code,
or enterprise. Record gaps explicitly instead of pretending the inventory is
complete.

## Modes

- `crawl`: live URLs, sitemap, screenshots, SEO metadata, redirects.
- `api`: AEM GraphQL Content Fragments and DAM metadata.
- `package`: Vault/JCR content packages, pages, nodes, and assets.
- `code`: HTL components, dialogs, templates, policies, Sling models.
- `enterprise`: combine modes and emit confidence notes for missing mappings.

## How

- Use path, URL, and description together when available.
- Capture customer-specific AEM assumptions as plan inputs before generating the
  migration plan: modes, Content Fragment policy, Experience Fragment policy,
  component policy, jQuery/clientlib policy, and verification gates.
- Keep credentials out of artifacts and chat. Ask for configured secrets or
  authenticated connectors when protected AEM APIs are needed.
- Separate content modeling, component mapping, asset migration, redirects, and
  runtime behavior into verifier-backed tasks.

## Related Skills

`migration`, `security`, `migration-target-builder`
