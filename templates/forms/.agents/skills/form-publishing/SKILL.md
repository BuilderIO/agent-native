---
name: form-publishing
description: >-
  Form lifecycle management: draft, published, closed. Use when publishing
  forms, understanding public URLs, configuring captcha, or managing form
  branding.
---

# Form Publishing

## Form Lifecycle

Forms move through three statuses:

| Status      | Meaning                              | Public access |
| ----------- | ------------------------------------ | ------------- |
| `draft`     | Work in progress, not publicly available | No         |
| `published` | Live and accepting responses         | Yes           |
| `closed`    | No longer accepting responses        | Shows closed message |

## Publishing a Form

```bash
# Create as draft (default)
pnpm action create-form --title "Survey" --fields '[...]'

# Publish when ready
pnpm action update-form --id <form-id> --status published

# Close when done collecting responses
pnpm action update-form --id <form-id> --status closed
```

## Public URLs

Published forms are accessible at:

```
/f/<slug>
```

The slug is auto-generated from the title + a short unique suffix:
- Title: "Contact Form" -> Slug: `contact-form/a1b2c3`
- Full URL: `https://yourapp.com/f/contact-form/a1b2c3`

The slug updates automatically when the title changes.

## Captcha Protection

Public form submissions can be protected with Cloudflare Turnstile (opt-in). This prevents bot submissions without degrading the user experience.

## Branding

Public forms display a "Built with Agent Native" badge by default. This can be configured in the form settings.

## Form Settings

Each form has a `settings` JSON object:

```json
{
  "submitText": "Submit",
  "successMessage": "Thank you! Your response has been recorded.",
  "redirectUrl": null,
  "showProgressBar": false,
  "integrations": []
}
```

| Setting            | Type    | Description                                |
| ------------------ | ------- | ------------------------------------------ |
| `submitText`       | string  | Custom submit button text                  |
| `successMessage`   | string  | Message shown after successful submission  |
| `redirectUrl`      | string  | URL to redirect to after submission        |
| `showProgressBar`  | boolean | Show progress bar for multi-section forms  |
| `integrations`     | array   | Webhook/Slack/Discord notification configs |

## Integration Types

Forms can notify external services on submission:

| Type            | Description                     |
| --------------- | ------------------------------- |
| `webhook`       | POST JSON to any URL            |
| `slack`         | Send to a Slack channel         |
| `discord`       | Send to a Discord webhook       |
| `google-sheets` | Append row to a Google Sheet    |

## Related Skills

- **form-building** — Creating and structuring forms
- **form-responses** — Viewing data after forms are published
