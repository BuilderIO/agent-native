---
"@agent-native/core": patch
---

Show an agent integration as connected as soon as the user returns from its
OAuth authorization. The callback redirects the popup rather than the window
that opened it, and the shared QueryClient deliberately disables
`refetchOnWindowFocus`, so the integrations list kept rendering "Connect" for
an integration that was already connected until the page was reloaded. The
`["mcp-servers"]` query now revalidates on focus, visibility, and connection
completion for as long as the server will still accept that authorization,
which covers every OAuth connector in the catalog rather than one provider.

Rename the Builder Publish connector to "Builder.io Publish". Onboarding
connects a Builder.io *account* for model credits one screen before the
integrations picker, and a row labelled plain "Builder.io" with a "Connect"
button read as that account having failed to connect.
