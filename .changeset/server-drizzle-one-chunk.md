---
"@agent-native/core": patch
---

Keep `drizzle-orm` in one server chunk on Netlify, Vercel, Node and Amplify builds. Split across chunks that import each other in a cycle, its query builders crashed some apps at module load with "Class extends value undefined is not a constructor or null".
