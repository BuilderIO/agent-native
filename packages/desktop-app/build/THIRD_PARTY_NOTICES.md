# Third-party notices

# libsodium

- Version: 1.0.21
- Source commit: `e18eee6532f5dc4b0f7ee99024e24bf4c8e12fc2`
- Source archive SHA-256: `5fe2dfa33a2e58bf778b8ddcfe4246bf1a21bce4d007ca36170e0c85758aa66a`
- Upstream: https://github.com/jedisct1/libsodium
- License: ISC (preserved verbatim in `LICENSE`)

The Private Vault XPC service links architecture-matched static slices built
from this exact source. It does not fall back to a system or dynamically loaded
libsodium.

## License text

```text
/*
 * ISC License
 *
 * Copyright (c) 2013-2026
 * Frank Denis <j at pureftpd dot org>
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */
```

# BIP39 English word list notice

`english.inc` is a mechanical C-include rendering of the immutable English
word list shipped by `@scure/bip39` 2.2.0. Each source word becomes one quoted
C string; spelling and order are unchanged.

- Upstream: https://github.com/paulmillr/scure-bip39
- Package: `@scure/bip39@2.2.0`
- npm integrity: `sha512-T/Bj/YvYMNkIPq6EENO6/rcs2e7qTNuyoUXf0KBFDmp0ZDu0H2X4Lq6yC3i0c8PcWkov5EbW+yQZZbdMmk154A==`
- Upstream packaged `wordlists/english.js` SHA-256: `961d1c711e071b4a5bb698461cce45614cc487d9a45e99bb975a174f0ea2dbc4`
- Vendored `english.inc` SHA-256: `4dd7af699f430f200ae6511aa12f9ec6513c650bb063fe1662545fa5fbb8432d`
- License: MIT; see `LICENSE`

The build checks the complete vendored-list hash. Native tests compare a
runtime-only mnemonic against the independently pinned package oracle, so the
encoder and the oracle cannot quietly drift apart.

## BIP39 word list license text

```text
The MIT License (MIT)

Copyright (c) 2022 Patricio Palladino, Paul Miller (paulmillr.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the “Software”), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
