---
title: "语音输入"
description: "代理聊天编辑器中的语音听写 - Builder Gemini、BYOK 提供程序和浏览器 Web 语音后备。"
---

# 语音输入

每个代理本机应用程序的聊天编辑器中都有一个麦克风。单击它，说话，您的话就会被转录到提示中。在移动设备上很有用，对于长提示很有用，当您的手放在其他东西上时很有用。

框架会自动处理所有这些。 Builder连接的用户默认获得Builder托管的Gemini Flash-Lite；否则，用户可以携带自己的提供商密钥或退回到浏览器语音识别。

## 它是如何工作的 {#how-it-works}

作曲家的语音按钮在浏览器中录制音频，然后选择提供商：

1. **Builder Gemini Flash-Lite（连接 Builder 时默认）。**浏览器将音频 POST 到 `/_agent-native/transcribe-voice`，`/_agent-native/transcribe-voice` 使用 Gemini Flash-Lite 通过 Builder.io 进行代理。无需 Google API 密钥。
2. **BYOK 云提供商。** 用户可以从“设置”中选择 Google Gemini、Groq Whisper 或 OpenAI Whisper。该路由在共享部署凭据之前解析用户范围的加密机密。
3. **浏览器网络语音 API（后备）。** 如果没有可用的服务器提供商，作曲家可以使用浏览器的内置语音识别。适用于基于 Chromium 的浏览器（Chrome、Edge、Arc）和 Safari。不太准确；直播。

提供商选择存储在 `voice-transcription-prefs` 下的应用程序状态中，因此用户可以在侧边栏设置中强制使用 `"auto"`（默认 — 选择最佳的可用提供商）、`"builder-gemini"`、`"builder"`、`"gemini"`、`"groq"`、`"openai"` 或 `"browser"`。

```an-diagram title="语音转录提供商后备方案" summary="作曲家录制音频，然后按顺序遍历服务器提供程序，仅当没有可用的服务器提供程序时才转到浏览器 Web Speech API。"
{
  "html": "<div class=\"diagram-voice\"><div class=\"diagram-node\">麦克风按钮<br><small class=\"diagram-muted\">录制 webm/opus</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card col\"><div class=\"diagram-pill accent\">1 &middot; Builder Gemini</div><small class=\"diagram-muted\">连接 Builder 后默认使用</small><div class=\"diagram-pill\">2 &middot; BYOK cloud</div><small class=\"diagram-muted\">Gemini &middot; Groq &middot; OpenAI Whisper</small></div><div class=\"diagram-arrow diagram-warn\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-box diagram-warn\" data-rough>3 &middot; Browser Web Speech<br><small class=\"diagram-muted\">fallback on 400 &middot; streams live</small></div></div>",
  "css": ".diagram-voice{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-voice .col{display:flex;flex-direction:column;gap:6px;padding:14px}.diagram-voice .diagram-arrow{font-size:22px;line-height:1}"
}
```

该路由**仅限同源** - 跨站点 POST 被拒绝，因此攻击者无法从外部页面烧毁转录积分。

## 启用提供商 {#enabling-providers}

Builder 是最简单的路径：从“设置”连接 Builder.io，默认提供商变为 Builder Gemini Flash-Lite。对于 BYOK 提供商，请在“设置”→“API 密钥”中添加匹配的密钥。

### 每用户（推荐用于 SaaS）

用户通过代理侧边栏设置 UI 设置自己的密钥。它存储为用户范围的加密秘密（通过 `readAppSecret`）。每个用户为自己的转录付费；主机零成本。

### 共享（用于内部工具）

将 `GEMINI_API_KEY`、`GROQ_API_KEY` 或 `OPENAI_API_KEY` 设置为环境变量或在 `settings` 表中。每个用户的转录都会命中共享密钥。

```an-callout
{
  "tone": "info",
  "body": "**凭证解析顺序：**路由首先检查用户自己的加密密钥，然后检查共享部署密钥。拥有自己密钥的高级用户始终会覆盖共享密钥。如果两者都不存在，则路由将返回作曲家识别的 400，并默默地退回到浏览器 Web 语音。"
}
```

## 路线 {#route}

```an-api title="语音转录路线"
{
  "method": "POST",
  "path": "/_agent-native/transcribe-voice",
  "summary": "将录制的音频片段转录为提示文本",
  "auth": "Active session (Better Auth cookie). Same-origin only.",
  "description": "The composer POSTs the recorded clip here; the route resolves a provider and returns the transcribed text. You should not call this directly.",
  "params": [
    { "name": "audio", "in": "body", "type": "file", "required": true, "description": "The recorded clip, webm/opus by default. Max 25 MB." },
    { "name": "provider", "in": "body", "type": "string", "required": false, "description": "Optional override, e.g. gemini, groq, openai, builder." }
  ],
  "request": { "contentType": "multipart/form-data" },
  "responses": [
    { "status": "200", "description": "Transcription succeeded", "example": "{ \"text\": \"reply to Sara that I'll be there by 3\" }" },
    { "status": "400", "description": "No server provider configured — the composer recognizes this and falls back to Web Speech", "example": "{ \"error\": \"no_provider\" }" }
  ]
}
```

您不需要直接调用它——作曲家会这样做。如果您正在构建自定义输入界面，请首先重用 `@agent-native/core/client` 中的共享作曲家/语音客户端片段。将此路由视为需要发送多部分音频的自定义助手的低级传输边界。

## 自定义提供程序 {#customizing}

提供者字段是一个普通的应用程序状态密钥，因此代理可以根据请求更改它（`"use the browser speech recognizer instead"`）。如果您正在构建具有不同要求的模板（例如，本地 Whisper 部署），请在框架安装默认路由之前通过注册您自己的 `transcribe-voice` 路由来交换路由处理程序。

## 下一步是什么

- [**Drop-in Agent**](/docs/drop-in-agent) — 公开语音按钮的作曲家
- [**Onboarding**](/docs/onboarding) — 注册提供商密钥作为设置步骤
- [**Security & Data Scoping**](/docs/security) — 每个用户如何存储加密秘密
