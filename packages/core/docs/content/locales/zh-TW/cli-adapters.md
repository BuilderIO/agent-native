---
title: "CLI 適配器"
description: "通過標準適配器介面（適配器指南中介紹的兩個適配器接縫之一）為代理提供對任何 CLI 工具（gh、ffmpeg、stripe）的結構化存取。"
---

# CLI 適配器

> **適合的位置：** CLI 適配器是
> 框架。規範指南是 [Adapters](/docs/sandbox-adapters)，
> 覆蓋此接縫和 `run-code` 沙箱接縫 - 包括共用
> 邊缘/無伺服器約束。本頁面是CLI端的快速參考。

CLI 適配器包裝單個指令行工具（`gh`、`ffmpeg`、`stripe`、`aws`），以便代理可以發現它，檢查它是否已安裝，並使用一致的 stdout/stderr/exit-code 結果執行它。如果沒有這個接縫，每個腳本都會重新發明如何調用 CLI 並解析其輸出。

```an-diagram title="CLI 適配器 → 註冊表 → 操作面" summary="ShellCliAdapter 包裝二進制檔案； CliRegistry 收集適配器以供發現； defineAction 在代理 + UI 操作介面上公開一個調用。"
{
  "html": "<div class=\"diagram-cli\"><div class=\"diagram-node\" data-rough>gh · ffmpeg · stripe<br><small class=\"diagram-muted\">command-line tools</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>ShellCliAdapter<br><small class=\"diagram-muted\">isAvailable · execute</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough>CliRegistry<br><small class=\"diagram-muted\">describe() for discovery</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill accent\">defineAction</div></div>",
  "css": ".diagram-cli{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-cli .diagram-arrow{font-size:22px;line-height:1}.diagram-cli .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## 介面 {#the-interface}

每個 CLI 適配器都實現 `CliAdapter`：

```ts
import type { CliAdapter, CliResult } from "@agent-native/core/adapters/cli";

interface CliAdapter {
  name: string; // "gh", "stripe", "ffmpeg"
  description: string; // What the agent sees during discovery
  isAvailable(): Promise<boolean>;
  execute(args: string[]): Promise<CliResult>;
}

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
```

## ShellCli適配器 {#shell-adapter}

對於大多數 CLI，您不需要自訂類 - `ShellCliAdapter` 使用合理的預設值包裝任何二進制檔案：

```ts
import { ShellCliAdapter } from "@agent-native/core/adapters/cli";

const gh = new ShellCliAdapter({
  command: "gh",
  description: "GitHub CLI — manage repos, PRs, issues, and releases",
});

const ffmpeg = new ShellCliAdapter({
  command: "ffmpeg",
  description: "Audio/video processing and transcoding",
  timeoutMs: 120_000, // 2 min for long encodes
  env: { STRIPE_API_KEY: process.env.STRIPE_SECRET_KEY! },
});
```

選項：`command`（必填）、`description`（必填）、`name`（預設為 `command`）、`env`（與 `process.env` 合並）、`cwd`（預設為 `process.cwd()`）和 `timeoutMs`（預設） `30000`）。

對於自訂驗證、輸出解析或前/後處理，請直接實現 `CliAdapter`，而不是使用 `ShellCliAdapter`。

## 註冊表 {#registry}

`CliRegistry` 收集適配器，以便代理可以發現執行時可用的內容：

```ts
import { CliRegistry, ShellCliAdapter } from "@agent-native/core/adapters/cli";

const cliRegistry = new CliRegistry();
cliRegistry.register(
  new ShellCliAdapter({ command: "gh", description: "GitHub CLI" }),
);

cliRegistry.list(); // all registered
await cliRegistry.listAvailable(); // only installed
await cliRegistry.describe(); // [{ name, description, available }] for discovery

const gh = cliRegistry.get("gh");
const result = await gh?.execute(["pr", "list", "--json", "title,url"]);
```

## 從actions使用 {#from-actions}

將 CLI 調用包裝在 `defineAction` 中以將其公開在操作介面上 - 當程式碼在伺服器操作介面內執行時需要 `defineAction`；否則直接在 `scripts/` 檔案中使用適配器。切勿在動作中調用 `process.exit`；相反，會拋出錯誤。

```ts
// actions/list-prs.ts
import { defineAction } from "@agent-native/core/action";
import { ShellCliAdapter } from "@agent-native/core/adapters/cli";
import { z } from "zod";

const gh = new ShellCliAdapter({ command: "gh", description: "GitHub CLI" });

export default defineAction({
  description: "List open pull requests via the GitHub CLI.",
  schema: z.object({}),
  async run() {
    if (!(await gh.isAvailable())) {
      throw new Error("GitHub CLI not installed. Run: brew install gh");
    }
    const result = await gh.execute([
      "pr",
      "list",
      "--json",
      "title,url,state",
      "--limit",
      "10",
    ]);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "gh pr list failed");
    }
    return JSON.parse(result.stdout);
  },
});
```

## 邊缘和無伺服器 {#edge-serverless}

CLI 適配器使用 `node:child_process`，它在邊缘/工作線程執行時（Cloudflare Workers、Netlify Edge Functions）上不存在。在標準 Node.js 環境中執行 CLI 適配器端點和工作。此約束與沙箱接縫共用 - 請參閱 [Adapters](/docs/sandbox-adapters#edge-serverless) 中的完整討論。

## 下一步是什么

- [**Adapters**](/docs/sandbox-adapters) — 兩個適配器接縫的規範指南。
- [**Actions**](/docs/actions) — 操作面 CLI 適配器通常被包裹在其中。
