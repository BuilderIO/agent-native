# QR Codes Agent Guide

Generate QR code images from user-provided URLs or text. The app is a headless
Agent-Native template: callable actions are the product surface.

## Safety and data

- Generated PNG and SVG artifacts are public to anyone who has the returned
  HTTPS URL. Tell the user this when returning an image link.
- Do not save the encoded content or image URL in shared resources. History is
  saved only for an authenticated user and is scoped to that user's email.
- Image files are uploaded through the configured file provider with
  `recordAsset: false` and a random filename. Never put encoded content in a
  filename.
- Do not add third-party credentials, customer data, or Builder-specific
  branding to this template.

## Agent operations

Use `generate-qr-code` for PNG or SVG output. It accepts URLs or text up to
4096 characters, image sizes from 100 to 2048 pixels, margins from 0 to 16 QR
modules, and six-digit foreground/background colors.

Run local actions from this app directory with `pnpm action <name> [args]`.
