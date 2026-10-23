# QR Codes

An Agent-Native headless app that generates PNG and SVG QR code images for
URLs or text. It uses the configured file provider for public HTTPS artifacts
and keeps generated history scoped to the authenticated user.

## Provenance and license

This sanitized template is maintained in the Agent-Native Framework repository
and is distributed under the MIT license included here. It contains no personal
or customer data, credentials, or product branding. The QR action and app
profile are versioned together.

## Local use

Install dependencies, connect a file storage provider, then run
`pnpm action generate-qr-code --content https://example.com`. The returned
artifact URL is public to anyone who has it.
