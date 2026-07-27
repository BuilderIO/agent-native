# Forms

An open-source, agent-native alternative to Typeform and Google Forms. Describe
the form you want, refine it in the visual editor, and publish a public form that
stores submissions in your own SQL database.

**Live app: [forms.agent-native.com](https://forms.agent-native.com)**

Build forms conversationally or by hand — the agent updates the schema and the
preview updates from SQL-backed state. Route new submissions wherever you need
them.

## Features

- Build and edit forms conversationally, with a live preview.
- Visual builder for labels, validation, options, and field order.
- Shipped field types: text, email, number, long text, select, multi-select,
  checkbox, radio, date, rating, and scale.
- Submissions stored in SQL with a per-response detail view and dashboard.
- Route submissions to webhooks, Slack, Discord, or Google Sheets via Apps
  Script.
- Publish public form URLs with a thank-you message.

## Develop locally

Scaffold your own copy and run it:

```bash
npx @agent-native/core@latest create my-forms --standalone --template forms
cd my-forms
pnpm install
pnpm dev
```

Full docs: [agent-native.com/docs/template-forms](https://agent-native.com/docs/template-forms).

## Submission destinations

Open a form's **Integrations** tab and save a destination before publishing.
Slack uses an Incoming Webhook URL. Google Sheets uses a deployed Apps Script
web app URL ending in `/exec` (not a spreadsheet URL or `/dev` URL). The script
should parse the JSON body and append the values, for example:

```ts
function doPost(e) {
  const payload = JSON.parse(e.postData.contents);
  SpreadsheetApp.getActiveSpreadsheet()
    .getSheets()[0]
    .appendRow([payload.submittedAt, payload.formTitle, payload.responseId]);
  return ContentService.createTextOutput(JSON.stringify({ ok: true }));
}
```

Deploy it as a web app that executes as you and allows anyone with the URL to
access it, then paste the deployed `/exec` URL into Forms. The destination
receives the form metadata plus one property per field label; duplicate labels
are disambiguated with the field ID.
