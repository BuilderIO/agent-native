---
"@agent-native/core": patch
---

Inject the session-replay iframe bootstrap at the first `</head>` that is real
markup rather than the first one anywhere in the string. A preview document
that inlines a script whose source mentions `</head>` had the bootstrap spliced
into that script's body, which unterminated a string literal and let the
bootstrap's own `</script>` close the host script early — the whole inlined
bundle then failed to parse and the preview silently lost every interaction.
