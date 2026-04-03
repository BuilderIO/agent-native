---
name: form-building
description: >-
  How to create and structure forms. Use when creating a new form, adding
  fields, modifying form structure, or understanding field types and their
  JSON schema.
---

# Form Building

## Creating a Form

Use the `create-form` script to create forms from natural language:

```bash
pnpm script create-form --title "Contact Form" --fields '[...]'
```

The script generates a unique ID, creates a URL slug, and stores the form in SQL as `draft` status.

## Field Types

| Type          | Description                    | Options needed | Example use           |
| ------------- | ------------------------------ | -------------- | --------------------- |
| `text`        | Single-line text input         | No             | Name, company         |
| `email`       | Email input with validation    | No             | Contact email         |
| `number`      | Numeric input                  | No             | Age, quantity         |
| `textarea`    | Multi-line text                | No             | Message, comments     |
| `select`      | Single-choice dropdown         | Yes            | Country, department   |
| `multiselect` | Multi-choice dropdown          | Yes            | Skills, interests     |
| `checkbox`    | Boolean toggle                 | No             | Consent, opt-in       |
| `radio`       | Single-choice radio buttons    | Yes            | Gender, preference    |
| `date`        | Date picker                    | No             | Birthday, deadline    |
| `rating`      | Star rating (1-5)              | No             | Satisfaction, quality |
| `scale`       | Numeric scale (e.g., 1-10)     | No             | NPS, likelihood       |

## Field JSON Schema

Each field is a JSON object:

```json
{
  "id": "field_name",
  "type": "text",
  "label": "Your Name",
  "placeholder": "Enter your name",
  "description": "Help text shown below the field",
  "required": true,
  "options": ["Option A", "Option B"],
  "validation": {
    "min": 1,
    "max": 100,
    "pattern": "^[a-zA-Z]+$",
    "message": "Custom error message"
  },
  "conditional": {
    "fieldId": "other_field_id",
    "operator": "equals",
    "value": "show_this_field"
  },
  "width": "full"
}
```

### Required properties
- `id` — unique identifier (snake_case recommended)
- `type` — one of the types above
- `label` — display label
- `required` — boolean

### Optional properties
- `placeholder` — input placeholder text
- `description` — help text below the field
- `options` — array of strings (required for select, multiselect, radio)
- `validation` — min/max/pattern/message for custom validation
- `conditional` — show field only when another field matches a condition
- `width` — `"full"` (default) or `"half"` for side-by-side layout

## Updating a Form

Use `update-form` to modify any form property:

```bash
# Change title
pnpm script update-form --id <id> --title "New Title"

# Update fields
pnpm script update-form --id <id> --fields '[...]'

# Change status
pnpm script update-form --id <id> --status published
```

## Common Form Templates

When a user asks for a common form type, use these field patterns:

**Contact form:**
```json
[
  {"id":"name","type":"text","label":"Name","required":true},
  {"id":"email","type":"email","label":"Email","required":true},
  {"id":"message","type":"textarea","label":"Message","required":true}
]
```

**Survey/feedback:**
```json
[
  {"id":"rating","type":"rating","label":"Overall satisfaction","required":true},
  {"id":"recommend","type":"scale","label":"How likely to recommend? (1-10)","required":true},
  {"id":"feedback","type":"textarea","label":"Additional feedback","required":false}
]
```

**Registration/signup:**
```json
[
  {"id":"first_name","type":"text","label":"First Name","required":true,"width":"half"},
  {"id":"last_name","type":"text","label":"Last Name","required":true,"width":"half"},
  {"id":"email","type":"email","label":"Email","required":true},
  {"id":"role","type":"select","label":"Role","options":["Student","Professional","Other"],"required":true}
]
```

## Workflow

1. `create-form` with title and fields
2. Preview in the GUI (agent + user iterate)
3. `update-form --status published` to go live
4. Share the public URL: `/f/<slug>`

## Related Skills

- **form-responses** — Viewing and analyzing submitted data
- **form-publishing** — Form lifecycle (draft -> published -> closed)
- **scripts** — All form operations go through scripts
