# Schema Markup Templates

JSON-LD structured data templates for blog posts. Every post gets BlogPosting schema. Add FAQPage or HowTo when the post type warrants it.

## BlogPosting Schema (Required for All Posts)

Generate for every post. Populate fields from `post.md` frontmatter and `metadata.yaml`.

```json
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": "{{title}}",
  "description": "{{meta_description}}",
  "url": "https://www.builder.io/blog/{{slug}}",
  "datePublished": "{{date_published}}",
  "dateModified": "{{date_modified}}",
  "wordCount": {{word_count}},
  "author": {
    "@type": "Person",
    "name": "{{author_name}}",
    "url": "{{author_url}}",
    "sameAs": [
      "{{github_url}}",
      "{{twitter_url}}",
      "{{linkedin_url}}"
    ]
  },
  "publisher": {
    "@type": "Organization",
    "name": "Builder.io",
    "url": "https://www.builder.io",
    "logo": {
      "@type": "ImageObject",
      "url": "https://www.builder.io/logo.png"
    }
  },
  "mainEntityOfPage": {
    "@type": "WebPage",
    "@id": "https://www.builder.io/blog/{{slug}}"
  },
  "image": "{{featured_image_url}}",
  "keywords": "{{primary_keyword}}, {{secondary_keywords}}"
}
```

### Field Notes

| Field | Source | Notes |
|-------|--------|-------|
| `headline` | `post.md` frontmatter `title` | Must match the title tag (without ` \| Builder.io` suffix) |
| `description` | Phase 8 meta description | 120-155 characters |
| `datePublished` | Publication date | ISO 8601 format: `YYYY-MM-DD` |
| `dateModified` | Same as `datePublished` for new posts | Update when post is revised |
| `wordCount` | `post.md` frontmatter `word_count` | Excluding code blocks and frontmatter |
| `author.sameAs` | Author's external profiles | Include all verifiable profiles. Omit any that don't exist |
| `image` | Featured image URL | Leave empty if no featured image yet (images are manually added) |
| `keywords` | Phase 2 keyword data | Comma-separated: primary keyword first, then secondaries |

## FAQPage Schema (For Posts with FAQ Sections)

Add when the post contains a dedicated FAQ section or when the outline flags PAA questions as a separate section. Each question-answer pair becomes an entry.

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "{{question_1}}",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "{{answer_1}}"
      }
    },
    {
      "@type": "Question",
      "name": "{{question_2}}",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "{{answer_2}}"
      }
    }
  ]
}
```

### When to Use

- Post has a dedicated "Frequently Asked Questions" or "FAQ" section
- Post addresses 2+ PAA (People Also Ask) questions as distinct subsections
- Post type is explainer or comparison with natural Q&A segments

### When NOT to Use

- Post uses question-based headings for AEO but the headings are structural, not FAQ-style
- Only one question is addressed (not worth the schema overhead)

### Field Notes

| Field | Source | Notes |
|-------|--------|-------|
| `name` | The question heading text | Use the exact heading text, with the `?` |
| `text` | The answer-first block (40-60 words) | Use the direct answer paragraph, not the full section. Strip markdown formatting |

## HowTo Schema (For Tutorial and How-To Posts)

Add when the post type is `tutorial` or `how-to` and the content follows a sequential step structure.

```json
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": "{{title}}",
  "description": "{{meta_description}}",
  "step": [
    {
      "@type": "HowToStep",
      "name": "{{step_1_name}}",
      "text": "{{step_1_description}}",
      "url": "https://www.builder.io/blog/{{slug}}#{{step_1_anchor}}"
    },
    {
      "@type": "HowToStep",
      "name": "{{step_2_name}}",
      "text": "{{step_2_description}}",
      "url": "https://www.builder.io/blog/{{slug}}#{{step_2_anchor}}"
    }
  ],
  "totalTime": "{{estimated_time}}"
}
```

### When to Use

- Post type is `tutorial` or `how-to`
- Content has 3+ sequential steps
- Steps are clearly delineated with headings or numbered sections

### When NOT to Use

- Post type is `explainer`, `comparison`, or `thought-leadership`
- Steps are not sequential (order doesn't matter)
- Post has fewer than 3 distinct steps

### Field Notes

| Field | Source | Notes |
|-------|--------|-------|
| `name` (step) | The step heading text | Strip the step number prefix if present ("Step 1: Install" becomes "Install") |
| `text` (step) | First 1-2 sentences of the step section | Summarize the action, not the full explanation |
| `url` (step) | Post URL + heading anchor | Lowercase, hyphens, no special characters |
| `totalTime` | Estimated completion time | ISO 8601 duration format: `PT15M` for 15 minutes, `PT1H` for 1 hour |

## Article Schema (For Hub Pillar Pages)

Use `Article` instead of `BlogPosting` when `page_type: pillar`. The `hasPart` property lists all cluster page URLs, signaling to search engines that the pillar is a comprehensive resource with constituent parts.

```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "{{title}}",
  "description": "{{meta_description}}",
  "url": "https://www.builder.io/blog/{{slug}}",
  "datePublished": "{{date_published}}",
  "dateModified": "{{date_modified}}",
  "wordCount": {{word_count}},
  "author": {
    "@type": "Person",
    "name": "{{author_name}}",
    "url": "{{author_url}}"
  },
  "publisher": {
    "@type": "Organization",
    "name": "Builder.io",
    "url": "https://www.builder.io",
    "logo": {
      "@type": "ImageObject",
      "url": "https://www.builder.io/logo.png"
    }
  },
  "mainEntityOfPage": {
    "@type": "WebPage",
    "@id": "https://www.builder.io/blog/{{slug}}"
  },
  "image": "{{featured_image_url}}",
  "keywords": "{{primary_keyword}}, {{secondary_keywords}}",
  "hasPart": [
    {
      "@type": "WebPage",
      "name": "{{cluster_1_title}}",
      "url": "https://www.builder.io/blog/{{cluster_1_slug}}"
    },
    {
      "@type": "WebPage",
      "name": "{{cluster_2_title}}",
      "url": "https://www.builder.io/blog/{{cluster_2_slug}}"
    }
  ]
}
```

### Field Notes

| Field | Source | Notes |
|-------|--------|-------|
| `hasPart` | `hub.yaml` clusters list | One entry per cluster page. Use the cluster's `topic` as `name` and derive URL from its `slug` |

### When to Use

- Post has `page_type: pillar` (set in `phases/01-topic-validation.yaml`)
- Replace BlogPosting with Article in the `@type` field
- Populate `hasPart` from `hub.yaml` cluster entries

## Cluster Page isPartOf Addition

When `page_type: cluster`, add an `isPartOf` property to the standard BlogPosting schema:

```json
{
  "@type": "BlogPosting",
  "headline": "...",
  "isPartOf": {
    "@type": "Article",
    "name": "{{pillar_title}}",
    "url": "https://www.builder.io/blog/{{pillar_slug}}"
  }
}
```

Read the pillar's `topic` and slug from `hub.yaml` to populate these fields.

## Combining Schemas

A single post can have multiple schemas. When combining, wrap them in a `@graph` array:

```json
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "BlogPosting", "..." : "..." },
    { "@type": "FAQPage", "..." : "..." }
  ]
}
```

Common combinations:
- **Tutorial post with FAQ:** BlogPosting + HowTo + FAQPage
- **Explainer with FAQ:** BlogPosting + FAQPage
- **Standard tutorial:** BlogPosting + HowTo
- **Comparison/thought-leadership:** BlogPosting only
- **Hub pillar with FAQ:** Article (with hasPart) + FAQPage
- **Hub cluster with FAQ:** BlogPosting (with isPartOf) + FAQPage

## Validation

After generating schema markup, validate using:
1. [Google Rich Results Test](https://search.google.com/test/rich-results) -- paste the JSON-LD and check for errors
2. [Schema.org Validator](https://validator.schema.org/) -- for structural correctness

Schema validation is a Post-Publish Checklist item (Phase 10). Phase 8 generates the markup; Phase 10 verifies it passes validation.
