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
