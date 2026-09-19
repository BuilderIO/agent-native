# @agent-native/embedding

Embed Agent-Native apps, pickers, and agents inside React or plain browser
apps.

```tsx
import { EmbeddedApp } from "@agent-native/embedding";

<EmbeddedApp
  url="https://assets.agent-native.com/picker"
  onLoad={(ref) => {
    ref.postMessage("configure", { accept: ["image/*"] });
  }}
  onMessage={(name, payload) => {
    if (name === "chooseImage") {
      console.log(payload);
    }
  }}
/>;
```

Inside the embedded app:

```ts
import { sendEmbeddedAppMessage } from "@agent-native/embedding/bridge";

sendEmbeddedAppMessage("chooseImage", {
  url: "https://cdn.example.com/image.png",
});
```

Agent helpers:

```ts
import { getA2AUrl, getMcpUrl, sendMessage } from "@agent-native/embedding";

console.log(getMcpUrl("https://assets.agent-native.com"));
console.log(getA2AUrl("https://assets.agent-native.com"));

for await (const chunk of sendMessage(
  "https://assets.agent-native.com",
  "Generate a blog hero",
)) {
  process.stdout.write(chunk);
}
```
