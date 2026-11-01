---
"@agent-native/core": patch
---

Send tool-result images we host, like Design's screenshots, to the Builder gateway as image bytes instead of URLs. Claude models on Vertex refused URL images ("URL sources are not supported"), so a Design chat on Claude failed right after the agent took a screenshot to check its work, and every retry failed the same way. The saved chat keeps the URL; images we do not host are unchanged.
