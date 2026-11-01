# @agent-native/scheduling

## 0.2.49

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [39cb8ce]
  - @agent-native/toolkit@0.222.2

## 0.2.48

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [86af196]
- Updated dependencies [c96a41d]
- Updated dependencies
  - @agent-native/toolkit@0.222.1

## 0.2.47

### Patch Changes

- Release all public npm packages with a patch version bump.
- 4123c9c: Require Core 0.222.0 or newer to match the Core peer requirement of Scheduling's Toolkit dependency.
- Updated dependencies [ede5c57]
- Updated dependencies [7e08199]
- Updated dependencies [c038e00]
- Updated dependencies [51e8de9]
- Updated dependencies
- Updated dependencies [7e08199]
- Updated dependencies [f8c2ba6]
- Updated dependencies [78fa714]
- Updated dependencies [0bf6393]
- Updated dependencies [8adaead]
- Updated dependencies [a54e178]
  - @agent-native/toolkit@0.222.0

## 0.2.46

### Patch Changes

- Release all public npm packages with a patch version bump.
- 2e8f454: Compile with `noImplicitOverride` and `noFallthroughCasesInSwitch`, and, where the code already passes them, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Optional fields that legitimately hold `undefined` are now typed `T | undefined`. No runtime behavior changes.
- Updated dependencies [94dab1c]
- Updated dependencies [0ab7e59]
- Updated dependencies [f717042]
- Updated dependencies [0ab7e59]
- Updated dependencies [9a61c1d]
- Updated dependencies [0ab7e59]
- Updated dependencies [0ab7e59]
- Updated dependencies [99c97eb]
- Updated dependencies [0ab7e59]
- Updated dependencies [0ab7e59]
- Updated dependencies [9c559ff]
- Updated dependencies [9fd95b5]
- Updated dependencies [2938b17]
- Updated dependencies [0ab7e59]
- Updated dependencies [0c8b261]
- Updated dependencies [cc341a4]
- Updated dependencies [180ecbe]
- Updated dependencies [0ab7e59]
- Updated dependencies [723fac2]
- Updated dependencies [0ab7e59]
- Updated dependencies [c2a6e7e]
- Updated dependencies [656b02e]
- Updated dependencies [1cd201c]
- Updated dependencies [c2a6e7e]
- Updated dependencies [bdfea6d]
- Updated dependencies [4173583]
- Updated dependencies [4173583]
- Updated dependencies [369ceab]
- Updated dependencies [d569c61]
- Updated dependencies [e086032]
- Updated dependencies [ee67a21]
- Updated dependencies [ef8111a]
- Updated dependencies [0ab7e59]
- Updated dependencies
- Updated dependencies [7199312]
- Updated dependencies [12a91c6]
- Updated dependencies [8254996]
- Updated dependencies [0ab7e59]
- Updated dependencies [f20824d]
- Updated dependencies [ef46f92]
- Updated dependencies [b14bed7]
- Updated dependencies [f83c054]
- Updated dependencies [0ab7e59]
- Updated dependencies [a9c0fa9]
- Updated dependencies [eaa780a]
- Updated dependencies [d9cfcd4]
- Updated dependencies [82efd47]
- Updated dependencies [0ab7e59]
- Updated dependencies [2e8f454]
- Updated dependencies [90395b3]
- Updated dependencies [7ee0542]
  - @agent-native/toolkit@0.221.0

## 0.2.45

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [ddd3bd1]
- Updated dependencies [4ea7d64]
- Updated dependencies
- Updated dependencies [0c211bc]
- Updated dependencies [b73b8ef]
  - @agent-native/toolkit@0.220.0

## 0.2.44

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [838e1ae]
- Updated dependencies
- Updated dependencies [86429da]
- Updated dependencies [7b293b2]
  - @agent-native/toolkit@0.219.0

## 0.2.43

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [84e4b2e]
- Updated dependencies
- Updated dependencies [84e4b2e]
- Updated dependencies [fc038a0]
  - @agent-native/toolkit@0.218.0

## 0.2.42

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [6c3f3cb]
- Updated dependencies [4c43f86]
- Updated dependencies
- Updated dependencies [9e4119f]
  - @agent-native/toolkit@0.217.0

## 0.2.41

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [31a1f1e]
  - @agent-native/toolkit@0.216.0

## 0.2.40

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [f8f4b9e]
- Updated dependencies [0b58010]
- Updated dependencies
- Updated dependencies [4fd6b35]
- Updated dependencies [11a11d9]
- Updated dependencies [aa79d54]
  - @agent-native/toolkit@0.215.0

## 0.2.39

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [05d1481]
  - @agent-native/toolkit@0.214.0

## 0.2.38

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.213.1

## 0.2.37

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [b58658d]
  - @agent-native/toolkit@0.213.0

## 0.2.36

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.212.1

## 0.2.35

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [71749d3]
- Updated dependencies [9d61445]
- Updated dependencies [96e2cf6]
- Updated dependencies
- Updated dependencies [ae5a212]
- Updated dependencies [71749d3]
- Updated dependencies [71749d3]
- Updated dependencies [9fcbe67]
- Updated dependencies [66ae94a]
  - @agent-native/toolkit@0.212.0

## 0.2.34

### Patch Changes

- f60152f: Require approval for `needsApproval` actions on every surface. HTTP action routes and generated Workers entries now run an approval-gated call only for the signed-in app UI (or its MCP directory widget); a bearer token, MCP OAuth token, org service token, A2A peer, or other HTTP caller gets `409 approval_required`, and an unproven browser call gets `403 ui_capability_required`. The app's client now presents its UI capability with every write from a signed-in session, so the 403 and one retry are only the fallback for an expired or rejected capability. `revoke-org-service-token` and the credential, membership, and app-access actions in core, Dispatch, and Scheduling now ask for approval on every call, with "always allow" off.
- Release all public npm packages with a patch version bump.
- 811b614: Build the full docs bundle with forward-slash paths on Windows too, so a Windows build writes the same `llms-full.txt`.
- Updated dependencies [4fdf78c]
- Updated dependencies [ab1a9e8]
- Updated dependencies [67514ae]
- Updated dependencies [b451cb2]
- Updated dependencies
  - @agent-native/toolkit@0.211.0

## 0.2.33

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.210.2

## 0.2.32

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [de17c2f]
- Updated dependencies [3a73a99]
- Updated dependencies
  - @agent-native/toolkit@0.210.1

## 0.2.31

### Patch Changes

- Release all public npm packages with a patch version bump.
- 0cfbd4d: Include the MIT license text in the published package.
- Updated dependencies [6c7c90e]
- Updated dependencies [7028ea5]
- Updated dependencies [7ade653]
- Updated dependencies [4c34d33]
- Updated dependencies
- Updated dependencies [108b9d9]
- Updated dependencies [ca67d21]
- Updated dependencies [79545c9]
- Updated dependencies [ff3a8dd]
- Updated dependencies [0cfbd4d]
- Updated dependencies [ed34578]
- Updated dependencies [7337569]
- Updated dependencies [7028ea5]
- Updated dependencies [41e43db]
  - @agent-native/toolkit@0.210.0

## 0.2.30

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [ce4eca0]
- Updated dependencies
- Updated dependencies [95aa388]
- Updated dependencies [36fc751]
- Updated dependencies [f99e655]
- Updated dependencies [f99e655]
- Updated dependencies [95aa388]
  - @agent-native/toolkit@0.209.2

## 0.2.29

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [e90b90a]
- Updated dependencies [5b201d1]
- Updated dependencies [ce01559]
- Updated dependencies
- Updated dependencies [c139e35]
- Updated dependencies [c139e35]
- Updated dependencies [e5a64ae]
- Updated dependencies [e6e1f56]
- Updated dependencies [73da788]
  - @agent-native/toolkit@0.209.1

## 0.2.28

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [fadfb1b]
- Updated dependencies [7407dca]
- Updated dependencies [980bd9f]
- Updated dependencies [7407dca]
- Updated dependencies
- Updated dependencies [d6a3ea3]
  - @agent-native/toolkit@0.209.0

## 0.2.27

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [9cb95d8]
- Updated dependencies [afe2ee7]
- Updated dependencies
- Updated dependencies [4434457]
- Updated dependencies [0fb4de3]
- Updated dependencies [cde733c]
  - @agent-native/toolkit@0.208.0

## 0.2.26

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [77c15ee]
- Updated dependencies [e913bfb]
- Updated dependencies [1c4a192]
- Updated dependencies [4452c7f]
  - @agent-native/toolkit@0.207.1

## 0.2.25

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [3d09f9f]
- Updated dependencies [128f43e]
- Updated dependencies [dfcc0de]
- Updated dependencies [eae7aa3]
- Updated dependencies [43d0aa8]
- Updated dependencies [a9c8414]
- Updated dependencies [19cd58b]
- Updated dependencies [aa34418]
- Updated dependencies [18384b3]
- Updated dependencies [ccddd3a]
- Updated dependencies [2f52659]
- Updated dependencies [5debd13]
- Updated dependencies
- Updated dependencies [e818cf9]
- Updated dependencies [e818cf9]
- Updated dependencies [ecfe037]
- Updated dependencies [d7da131]
- Updated dependencies [d44b119]
- Updated dependencies [cdc66e3]
- Updated dependencies [f8930b5]
- Updated dependencies [d7da131]
- Updated dependencies [d4854b8]
- Updated dependencies [3451273]
- Updated dependencies [70bf54c]
  - @agent-native/toolkit@0.207.0

## 0.2.24

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [e88f35c]
- Updated dependencies [80e66f8]
- Updated dependencies [58b7507]
- Updated dependencies [58b7507]
- Updated dependencies [0889356]
- Updated dependencies [3f0fe0f]
- Updated dependencies [e174642]
- Updated dependencies [d6f1e18]
- Updated dependencies
- Updated dependencies [792ba44]
- Updated dependencies [8f0ffa5]
- Updated dependencies [d6f1e18]
- Updated dependencies [d6f1e18]
- Updated dependencies [be0d784]
- Updated dependencies [68deb1e]
- Updated dependencies [af7acb9]
- Updated dependencies [217260d]
- Updated dependencies [6e9fccf]
  - @agent-native/toolkit@0.206.0

## 0.2.23

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [b7e32e4]
- Updated dependencies [ab41d2b]
- Updated dependencies [de66ff4]
- Updated dependencies [947f911]
- Updated dependencies [4fe4088]
- Updated dependencies [cbc151c]
- Updated dependencies [3dc0aeb]
- Updated dependencies [9236359]
- Updated dependencies [1b1d976]
- Updated dependencies
- Updated dependencies [f325447]
- Updated dependencies [cc79bd1]
- Updated dependencies [8418b84]
- Updated dependencies [004f2a9]
- Updated dependencies [701c672]
- Updated dependencies [ae5aed6]
  - @agent-native/toolkit@0.205.0

## 0.2.22

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [c8bbbd4]
- Updated dependencies [4ba5ea5]
- Updated dependencies
- Updated dependencies [4c1d77f]
  - @agent-native/toolkit@0.204.0

## 0.2.21

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [b717c70]
- Updated dependencies
- Updated dependencies [2842af8]
  - @agent-native/toolkit@0.203.1

## 0.2.20

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [8944abb]
- Updated dependencies [6b0f888]
- Updated dependencies [d317d31]
- Updated dependencies
- Updated dependencies [6f748b3]
- Updated dependencies [de755c7]
  - @agent-native/toolkit@0.203.0

## 0.2.19

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [b22060c]
- Updated dependencies [a983e22]
- Updated dependencies [123cf36]
- Updated dependencies [a652cbc]
- Updated dependencies [ef0662e]
- Updated dependencies [ae80a65]
- Updated dependencies [a9879f8]
- Updated dependencies
- Updated dependencies [edc7f35]
- Updated dependencies [053539c]
- Updated dependencies [c8fa837]
- Updated dependencies [84e173d]
- Updated dependencies [fa322d4]
- Updated dependencies [dfff955]
  - @agent-native/toolkit@0.202.0

## 0.2.18

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [88908c5]
- Updated dependencies [cc3c820]
- Updated dependencies [a78f2a0]
- Updated dependencies [bdb9e68]
- Updated dependencies [bb72f96]
- Updated dependencies
- Updated dependencies [5d05eb6]
- Updated dependencies [cbfea3c]
- Updated dependencies [b88b078]
  - @agent-native/toolkit@0.201.1

## 0.2.17

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [2e9fa5f]
- Updated dependencies [1bbb9fa]
- Updated dependencies [43694e6]
- Updated dependencies [7c73c56]
- Updated dependencies [af93f72]
- Updated dependencies [af93f72]
- Updated dependencies [af93f72]
- Updated dependencies [af93f72]
- Updated dependencies [af93f72]
- Updated dependencies [af93f72]
- Updated dependencies
- Updated dependencies [2e9fa5f]
- Updated dependencies [c46307b]
- Updated dependencies [81a5946]
  - @agent-native/toolkit@0.201.0

## 0.2.16

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [4aa4088]
- Updated dependencies [bf2b2ae]
- Updated dependencies [73c2373]
- Updated dependencies [563e22a]
- Updated dependencies [73c2373]
- Updated dependencies [53f0c01]
- Updated dependencies [0c17540]
- Updated dependencies
- Updated dependencies [5113a23]
- Updated dependencies [9a09590]
- Updated dependencies [73c2373]
- Updated dependencies [73c2373]
- Updated dependencies [73c2373]
- Updated dependencies [73c2373]
- Updated dependencies [4bee69d]
- Updated dependencies [7ec9079]
- Updated dependencies [73c2373]
  - @agent-native/toolkit@0.200.0

## 0.2.15

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [452757b]
- Updated dependencies [6f27cff]
- Updated dependencies [a1e74f5]
- Updated dependencies [a80ad13]
- Updated dependencies [a1e74f5]
- Updated dependencies [ebface7]
- Updated dependencies
- Updated dependencies [5b643b7]
- Updated dependencies [c13429a]
  - @agent-native/toolkit@0.199.0

## 0.2.14

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [4e85ccd]
- Updated dependencies
  - @agent-native/toolkit@0.198.8

## 0.2.13

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [48586af]
- Updated dependencies
- Updated dependencies [b147194]
- Updated dependencies [3ba09b7]
  - @agent-native/toolkit@0.198.7

## 0.2.12

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [0670eb1]
- Updated dependencies [77540af]
- Updated dependencies [df12726]
- Updated dependencies
- Updated dependencies [4dfe557]
  - @agent-native/toolkit@0.198.6

## 0.2.11

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.198.5

## 0.2.10

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [85a87e6]
- Updated dependencies [cefc33b]
- Updated dependencies [7a25922]
- Updated dependencies [df67544]
- Updated dependencies [2fdd284]
- Updated dependencies [c82ae28]
- Updated dependencies
- Updated dependencies [c650ba5]
- Updated dependencies [9fa81ab]
- Updated dependencies [20d3bb8]
  - @agent-native/toolkit@0.198.4

## 0.2.9

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [ce1245c]
- Updated dependencies [e6de282]
- Updated dependencies [d2b14cf]
  - @agent-native/toolkit@0.198.3

## 0.2.8

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [63c4c02]
  - @agent-native/toolkit@0.198.2

## 0.2.7

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [0b127e9]
- Updated dependencies [4873d09]
- Updated dependencies [d09fdb0]
- Updated dependencies
- Updated dependencies [d25ddc1]
- Updated dependencies [affa25c]
- Updated dependencies [b1bbe7e]
- Updated dependencies [905b078]
- Updated dependencies [6a627af]
  - @agent-native/toolkit@0.198.1

## 0.2.6

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [20cd76f]
- Updated dependencies [bbe8cbf]
- Updated dependencies [8853f61]
- Updated dependencies [8853f61]
- Updated dependencies
- Updated dependencies [8853f61]
- Updated dependencies [afbee14]
- Updated dependencies [8853f61]
- Updated dependencies [8853f61]
- Updated dependencies [8853f61]
- Updated dependencies [8853f61]
- Updated dependencies [b6ffae6]
- Updated dependencies [8853f61]
  - @agent-native/toolkit@0.198.0

## 0.2.5

### Patch Changes

- Release all public npm packages with a patch version bump.
- b8845eb: Scope booking workflows and webhook deliveries to the booking owner and organization.
- b8845eb: Scope ownable reads and writes to their authorized user, organization, or share.
- Updated dependencies [f2e8ffe]
- Updated dependencies [023ee9b]
- Updated dependencies [47985fe]
- Updated dependencies
- Updated dependencies [fa62fdf]
  - @agent-native/toolkit@0.23.1

## 0.2.4

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [a20f0b4]
  - @agent-native/toolkit@0.23.0

## 0.2.3

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [880740b]
- Updated dependencies [55c9666]
- Updated dependencies [55c9666]
- Updated dependencies
  - @agent-native/toolkit@0.22.3

## 0.2.2

### Patch Changes

- Release all public npm packages with a patch version bump.
- ed3801e: Remove nonessential source comments.
- Updated dependencies [d462819]
- Updated dependencies [797b3e2]
- Updated dependencies [e76947b]
- Updated dependencies
- Updated dependencies [adc7497]
- Updated dependencies [797b3e2]
- Updated dependencies [ed3801e]
- Updated dependencies [e7b6fcc]
- Updated dependencies [e76947b]
- Updated dependencies [2397f94]
  - @agent-native/toolkit@0.22.2

## 0.2.1

### Patch Changes

- Release all public npm packages with a patch version bump.
- af54bfd: Keep Zoom-backed slots reserved until meeting cleanup succeeds.
- Updated dependencies [7e8a10a]
- Updated dependencies
  - @agent-native/toolkit@0.22.1

## 0.2.0

### Minor Changes

- da924dd: Improve public share previews and recover Calendar bookings safely after Zoom outcomes.

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [dbb10d5]
- Updated dependencies [39a89d0]
- Updated dependencies [39a89d0]
- Updated dependencies [39a89d0]
- Updated dependencies [39a89d0]
- Updated dependencies
- Updated dependencies [39a89d0]
- Updated dependencies [39a89d0]
- Updated dependencies [39a89d0]
  - @agent-native/toolkit@0.22.0

## 0.1.75

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [6ff4d47]
  - @agent-native/toolkit@0.21.3

## 0.1.74

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [2ba6541]
  - @agent-native/toolkit@0.21.2

## 0.1.73

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.21.1

## 0.1.72

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [21fdd86]
- Updated dependencies [4917d34]
- Updated dependencies
- Updated dependencies [ac01083]
- Updated dependencies [21fdd86]
- Updated dependencies [185e25d]
  - @agent-native/toolkit@0.21.0

## 0.1.71

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.20.9

## 0.1.70

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.20.8

## 0.1.69

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [2427195]
- Updated dependencies [d43305d]
- Updated dependencies
  - @agent-native/toolkit@0.20.7

## 0.1.68

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [e973e00]
  - @agent-native/toolkit@0.20.6

## 0.1.67

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [58b0779]
- Updated dependencies [3ecc476]
- Updated dependencies
- Updated dependencies [15ec2fb]
  - @agent-native/toolkit@0.20.5

## 0.1.66

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [5ede9f7]
- Updated dependencies
- Updated dependencies [ffafd84]
- Updated dependencies [424d0cd]
  - @agent-native/toolkit@0.20.4

## 0.1.65

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [901376b]
- Updated dependencies [b35949b]
- Updated dependencies [116c315]
- Updated dependencies
  - @agent-native/toolkit@0.20.3

## 0.1.64

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [c9cb7de]
  - @agent-native/toolkit@0.20.2

## 0.1.63

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [9f08f5d]
- Updated dependencies [cd40555]
- Updated dependencies [1f43d89]
- Updated dependencies [25dc407]
- Updated dependencies [e32e1d5]
- Updated dependencies
- Updated dependencies [657bba1]
- Updated dependencies [25dc407]
- Updated dependencies [6ba23d3]
  - @agent-native/toolkit@0.20.1

## 0.1.62

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [210c7d0]
- Updated dependencies [743039f]
- Updated dependencies [bd3e96e]
- Updated dependencies [b83d472]
- Updated dependencies [875f793]
- Updated dependencies [97564cd]
- Updated dependencies [64e6346]
- Updated dependencies [64e6346]
- Updated dependencies [a30a54d]
- Updated dependencies [587297c]
- Updated dependencies
- Updated dependencies [210c7d0]
- Updated dependencies [7a9238c]
- Updated dependencies [ccad889]
  - @agent-native/toolkit@0.20.0

## 0.1.61

### Patch Changes

- Release all public npm packages with a patch version bump.
- b7c56a1: Harden security across CLI action runners and scheduling actions: safely tokenize and quote CLI arguments in fallback action routes to prevent shell command injection, require viewer access on routing form responses, and enforce access checks on event type ID queries.
- Updated dependencies [35eb1e6]
- Updated dependencies [4676e71]
- Updated dependencies
  - @agent-native/toolkit@0.19.7

## 0.1.60

### Patch Changes

- Release all public npm packages with a patch version bump.
- 8f0c972: Keep the event-type authorization test fixture in step with the shared shares
  table, which now records when a share notification was sent.
- Updated dependencies [e8b291e]
- Updated dependencies [4915b82]
- Updated dependencies
- Updated dependencies [3bde94f]
  - @agent-native/toolkit@0.19.6

## 0.1.59

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [58d9dc3]
  - @agent-native/toolkit@0.19.5

## 0.1.58

### Patch Changes

- Release all public npm packages with a patch version bump.
- cc2a915: Standardize framework persistence on PostgreSQL. Local development uses PGlite,
  hosted deployments use PostgreSQL, and the database client, schema, migrations,
  templates, docs, and tooling now target PostgreSQL directly.
- Updated dependencies [e29fee8]
- Updated dependencies [cef8c06]
- Updated dependencies
- Updated dependencies [73c36ce]
  - @agent-native/toolkit@0.19.4

## 0.1.57

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [760d108]
  - @agent-native/toolkit@0.19.3

## 0.1.56

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [0566ce9]
  - @agent-native/toolkit@0.19.2

## 0.1.55

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [e74593d]
- Updated dependencies
  - @agent-native/toolkit@0.19.1

## 0.1.54

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [349ce5c]
- Updated dependencies [353f95a]
- Updated dependencies [a1869cc]
- Updated dependencies [f0fb6c5]
- Updated dependencies [03711a6]
  - @agent-native/toolkit@0.19.0

## 0.1.53

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [844fa10]
- Updated dependencies [4af2889]
- Updated dependencies
- Updated dependencies [dcc9f89]
- Updated dependencies [163dd55]
- Updated dependencies [5b7a8ea]
  - @agent-native/toolkit@0.18.0

## 0.1.52

### Patch Changes

- 6621544: Generate `docs/llms-full.txt` in a locale-independent order. The bundle sorted its sections with `localeCompare`, so a full-ICU Node produced a different order than the small-ICU build that generated the committed file — leaving the tracked artifact modified after every `pnpm install`.
- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.17.6

## 0.1.51

### Patch Changes

- Release all public npm packages with a patch version bump.
- 4776e61: Reduce CI lint warnings with safer type narrowing, callback binding, and explicit async intent.
- Updated dependencies [ac1ecfc]
- Updated dependencies
- Updated dependencies [5a12f71]
- Updated dependencies [d2b314b]
- Updated dependencies [5c96078]
  - @agent-native/toolkit@0.17.5

## 0.1.50

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.17.4

## 0.1.49

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [db91905]
- Updated dependencies
  - @agent-native/toolkit@0.17.3

## 0.1.48

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies [65a3b88]
- Updated dependencies
  - @agent-native/toolkit@0.17.2

## 0.1.47

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.17.1

## 0.1.46

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
- Updated dependencies [cf473dc]
  - @agent-native/toolkit@0.17.0

## 0.1.45

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.16.16

## 0.1.44

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.16.15

## 0.1.43

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.16.14

## 0.1.42

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.16.13

## 0.1.41

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.16.12

## 0.1.40

### Patch Changes

- Release all public npm packages with a patch version bump.
- Updated dependencies
  - @agent-native/toolkit@0.16.10

## 0.1.39

### Patch Changes

- Updated dependencies [9e21e1b]
- Updated dependencies [9e21e1b]
- Updated dependencies [9e21e1b]
  - @agent-native/toolkit@0.16.0

## 0.1.38

### Patch Changes

- Updated dependencies [f07ec04]
  - @agent-native/toolkit@0.15.0

## 0.1.37

### Patch Changes

- Updated dependencies [aa17e22]
  - @agent-native/toolkit@0.14.0

## 0.1.36

### Patch Changes

- Updated dependencies [106af0e]
  - @agent-native/toolkit@0.13.0

## 0.1.35

### Patch Changes

- f499dff: Add `@agent-native/core/vitest-config`, a base vitest config that caps a suite's
  worker pool so concurrent test runs no longer oversubscribe the CPU. Defaults to
  25% of cores; override with `VITEST_CONCURRENCY`. Every template and package
  config merges it in.
- Updated dependencies [f499dff]
  - @agent-native/toolkit@0.12.2

## 0.1.34

### Patch Changes

- Updated dependencies [c0e7d64]
- Updated dependencies [c0e7d64]
  - @agent-native/toolkit@0.12.0

## 0.1.33

### Patch Changes

- Updated dependencies [24a5a20]
  - @agent-native/toolkit@0.11.0

## 0.1.32

### Patch Changes

- Updated dependencies [f0da2e0]
- Updated dependencies [f0da2e0]
- Updated dependencies [f0da2e0]
- Updated dependencies [f0da2e0]
- Updated dependencies [f0da2e0]
- Updated dependencies [f0da2e0]
  - @agent-native/toolkit@0.10.0

## 0.1.31

### Patch Changes

- Updated dependencies [0341a7d]
  - @agent-native/toolkit@0.9.0

## 0.1.30

### Patch Changes

- 8453025: Add manifest-driven feature ejection with dry-run planning, committed provenance, import rewrites, drift inspection, hash-gated restore, protected-runtime guidance, and complete first-party coverage guards.
- Updated dependencies [8453025]
  - @agent-native/toolkit@0.8.0

## 0.1.29

### Patch Changes

- Updated dependencies [e53a34e]
  - @agent-native/toolkit@0.7.0

## 0.1.28

### Patch Changes

- Updated dependencies [01a3f27]
  - @agent-native/toolkit@0.6.0

## 0.1.27

### Patch Changes

- 079e19a: Adopt focused Core client entrypoints and ship package migration metadata where applicable.
- Updated dependencies [079e19a]
  - @agent-native/toolkit@0.5.1

## 0.1.26

### Patch Changes

- b6d7f87: Move portable rich-editor, context presentation, and visual design controls into Toolkit while preserving Core compatibility re-exports, and add accurate side-effect metadata to capability packages.
- Updated dependencies [b6d7f87]
  - @agent-native/toolkit@0.5.0

For the full list of releases, see the [changelog archive](./changelog/archive/CHANGELOG.md).
