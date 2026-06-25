---
title: "剪辑"
description: "异步屏幕录制、日历同步会议记录和一键通语音听写 - 将 Clips 链接粘贴到座席中，他们就可以阅读文字记录、视觉效果和摘要。"
search: "Clips 浏览器日志 开发人员日志 控制台日志 网络日志 获取 XHR Chrome 扩展程序 诊断记录器 桌面应用"
---

# 剪辑

一款捕获一切的应用程序：屏幕录制、日历中的会议记录以及按住 Fn 的语音听写。代理会转录、标题、总结和索引所有内容 - 然后让您询问“找到我们讨论推出计划的剪辑”并搜索您曾经制作的每个转录。

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:14px;padding:18px;min-height:520px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>工程 Clips</h1><span class='wf-pill accent'>Library</span><span class='wf-pill'>Meetings</span><span class='wf-pill'>Dictation</span><div style='flex:1'></div><button>Import</button><button class='primary'>Record</button></div><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:12px'><div class='wf-card' style='height:120px;display:flex;flex-direction:column;justify-content:end'><strong>OKR 评审</strong><small>35 min</small></div><div class='wf-card' style='height:120px;display:flex;flex-direction:column;justify-content:end'><strong>入门流程</strong><small>12 min</small></div><div class='wf-card' style='height:120px;display:flex;flex-direction:column;justify-content:end'><strong>Bug 复现</strong><small>4 min</small></div></div><div class='wf-card' style='display:flex;gap:10px;align-items:center'><span class='wf-pill accent'>代理可读</span><span>转写 + 帧已可用于分享链接</span><div style='flex:1'></div><button>分享</button></div><div class='wf-card' style='flex:1;display:flex;flex-direction:column;gap:8px'><strong>转录搜索</strong><div class='wf-box'>匹配章节 03:12 · 发布风险和负责人交接</div><div class='wf-box'>会议摘要和行动项</div></div></div>"
}
```

沿着将 Loom + Granola + Wispr Flow 集成到一个应用程序中的思路来思考 — 但代理在每个界面上都是一流的编辑器，并且录音、会议和听写都是您的，而不是 SaaS 供应商的。 Clips 还使共享录音可供代理读取：将普通的 Clips 共享链接粘贴到代理中，它可以“听到”文本形式的文字记录，并“看到”带有时间戳的屏幕帧作为图像 - 无需原始视频。帧查看适用于任何具有图像功能的代理（ChatGPT、Claude 代码、光标、Codex）；纯文本网络聊天仍然可以获得完整的文字记录，并且可以拍摄您上传的帧。

```an-diagram title="捕获、转录、重用" summary="三种捕获类型集中在一个库中；代理进行抄写、标题和总结，然后每个抄本都可以搜索和共享。"
{
  "html": "<div class=\"diagram-clips\"><div class=\"diagram-col\"><div class=\"diagram-node\">屏幕录制</div><div class=\"diagram-node\">日历会议</div><div class=\"diagram-node\">按住 Fn 听写</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>一个库<br><small class=\"diagram-muted\">recordings + transcripts (SQL)</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Agent</span><small class=\"diagram-muted\">标题 · 摘要 · 章节</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill\">搜索</div><div class=\"diagram-pill\">分享</div><div class=\"diagram-pill\">代理可读 links</div></div></div>",
  "css": ".diagram-clips{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-clips .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-clips .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-clips .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 你可以用它做什么

- **使用内置录音机、网络摄像头覆盖、音频捕获和暂停/修剪来录制屏幕**。
- **从日历中捕获会议。** 连接 Google Calendar，在侧边栏中查看即将举行的会议，并在任何一个会议上进行记录。您将在结束时获得实时记录以及 AI 摘要、项目符号注释和行动项目。
- **一键通听写。** 按住机器上的 Fn，说话，清理后的文本就会放入您正在使用的任何应用程序中。每个听写都保存在可搜索的历史记录中，原始版本和人工智能清理的版本并排保存。
- **为每个录音获取自动生成的标题、摘要和章节标记** - 客服人员会填写这些内容并使其保持最新状态。
- **搜索每一份记录** — 屏幕录像、会议和听写都在一个库中。 “找到我们讨论推出计划的剪辑。”
- **共享剪辑**以及每个剪辑的权限（公共、团队、私人）。链接跟踪和线索评论也有效。
- **在 Slack 中预览公共剪辑**，并在播放后使用 Loom 风格的可播放展开
  工作区安装您的 Clips Slack 应用。
- **使用 Chrome 扩展程序捕获浏览器日志。**浏览器记录可以
  附加经过编辑的控制台日志和 fetch/XHR 元数据，这对
  产品错误和仅限浏览器的重现。
- **将剪辑链接粘贴到代理中**，以便他们可以发现代理可读的上下文：元数据、转录片段、推荐帧和带时间戳的帧图像，而无需接收原始视频文件。
- **智能图书馆视图。**按项目分组、按演讲者过滤、根据内容自动标记。
- **通过聊天编辑文字记录。**“修复 1:42 处错误转录的单词。” “为博客文章引用三个引号。”代理编辑文字记录并实时更新 UI。

## 浏览器日志和开发人员诊断

当您需要录制内容以及浏览器日志时，请使用 Clips Chrome 扩展程序
您正在调试的选项卡。该扩展程序启动活动标签记录并且可以
保存编辑后的控制台日志、JavaScript 异常和 fetch/XHR 网络
元数据，例如方法、编辑的 URL、状态、持续时间和失败文本。它
不保存请求正文、响应正文或标头。

常规浏览器记录器页面可以保存记录器页面的诊断信息
本身。 Chrome 扩展程序是活动选项卡开发人员日志的路径，
仅浏览器重现。在剪辑 UI 中，使用 Chrome 选项查看浏览器日志并
桌面应用程序提供最无缝的日常捕捉路径。

Agent-Native Clips Chrome 扩展程序列表为
`https://chromewebstore.google.com/detail/baoipacpchggcdigagnajakiidcgcffn`.
如果您托管自己的 Clips 服务器，请隐藏 Chrome 扩展选项，直到
您的网上应用店列表已上线。设置`VITE_CLIPS_CHROME_EXTENSION_ENABLED=1`
批准后在桌面应用程序下载提示旁边显示扩展。设置
`VITE_CLIPS_CHROME_EXTENSION_URL` 仅当您需要覆盖默认值时
列出 URL。

## 客服人员可读的剪辑

将普通的公共 Clips 共享链接粘贴到代理中。分享页面有广告
一个紧凑的代理上下文 URL，并且该上下文指向转录本和框架
APIs，因此仅接受文本或静态图像的模型仍然可以理解内容
发生在录音中。

任何可以将图像 URL 提取到其视野中的代理 - ChatGPT、Claude 代码，
光标、Codex 和 MCP 连接的代理 — 读取脚本并查看
帧。一些纯文本网络聊天会读取文字记录，但不会提取帧图像
独自一人；在那里，上传关键帧或以支持图像的方式打开剪辑
代理。

| 端点                                              | 代理可以获得什么                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| `/api/agent-context.json?id=<recordingId>`        | 剪辑元数据、转录状态、章节、CTA、推荐帧以及指向转录/帧 API 的链接     |
| `/api/agent-transcript.json?id=<recordingId>`     | 带有 `startMs`、`endMs`、可读时间戳、文本和可选源标签的时间戳转录片段 |
| `/api/agent-frame.jpg?id=<recordingId>&atMs=<ms>` | 以原始视频时间戳从视频中提取的 JPEG 帧                                |

端点遵循与共享页面相同的公共/密码/过期规则。
受密码保护的剪辑需要密码一次；成功响应返回
短暂的标记化链接，因此下游代理不需要明文
密码。

Slack 预览使用相同的共享边界。 `/api/slack/unfurl` Webhook
仅返回可播放的 Slack `video` 块，用于准备就绪的公共剪辑，而无需
密码、过期命中、存档标记或垃圾标记。其他剪辑仍然得到
正常共享页面标题/缩略图元数据并需要打开剪辑。

```an-api title="代理上下文入口点"
{
  "method": "GET",
  "path": "/api/agent-context.json",
  "summary": "共享剪辑的紧凑、代理可读的描述",
  "description": "Returns clip metadata, transcript status, chapters, CTAs, recommended frames, and links to the transcript and frame APIs. Advertised by the public share page so a text- or image-only agent can understand a recording without ingesting raw video.",
  "auth": "Same public / password / expiry rules as the share page",
  "params": [
    { "name": "id", "in": "query", "type": "string", "required": true, "description": "Recording id" }
  ],
  "responses": [
    { "status": "200", "description": "Clip metadata plus transcript and frame API links" }
  ]
}
```

```an-api title="带时间戳的文字记录"
{
  "method": "GET",
  "path": "/api/agent-transcript.json",
  "summary": "共享剪辑的带时间戳的转录片段",
  "params": [
    { "name": "id", "in": "query", "type": "string", "required": true, "description": "Recording id" }
  ],
  "responses": [
    { "status": "200", "description": "Segments with startMs, endMs, readable timestamps, text, and optional source labels" }
  ]
}
```

```an-api title="具有时间戳的帧"
{
  "method": "GET",
  "path": "/api/agent-frame.jpg",
  "summary": "在原始视频时间戳处从视频中提取的 JPEG 帧",
  "params": [
    { "name": "id", "in": "query", "type": "string", "required": true, "description": "Recording id" },
    { "name": "atMs", "in": "query", "type": "integer", "required": true, "description": "Original-video timestamp in milliseconds" }
  ],
  "responses": [
    { "status": "200", "description": "image/jpeg frame" }
  ]
}
```

## 开始使用

现场演示：[clips.agent-native.com](https://clips.agent-native.com)。

1. **打开库。**浏览屏幕录音、会议录音、听写，
   来自一个位置的文件夹和空间。
2. **录制或导入。**捕获屏幕录制，从日历开始
   会议，或使用一键通听写。
3. **让代理清理它。**生成标题、摘要、章节、操作
   项目，或清理后的转录文本。
4. **搜索和重复使用。**询问您的剪辑、引言、行动项目或决定
   需要，然后以正确的可见性分享结果。

### 有用的提示

- “总结此剪辑以进行产品更新。”
- “查找我们讨论推出计划的会议。”
- “从此记录中提取三个客户报价。”
- “根据上次销售拜访创建行动项目。”
- “清理这个听写并将其变成 Linear 票证。”

## 对于开发者

本文档的其余部分适用于任何派生 Clips 模板或扩展它的人。

### 快速入门

```bash
npx @agent-native/core@latest create my-clips --standalone --template clips
cd my-clips
pnpm install
pnpm dev
```

Clips 是一个带有本机记录器的较大模板（它附带了用于本地捕获的桌面伴侣）。上传录音之前需要执行三个设置步骤：

1. **视频存储（必需）。** 通过入门向导连接存储后端。最简单的路径是Builder.io（测试期间免费，一键式）。对于自托管存储，请设置 `S3_ENDPOINT`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY` 以及可选的 `S3_REGION` 和 `S3_PUBLIC_BASE_URL`。 Cloudflare R2 和 DigitalOcean Spaces 使用带有 `R2_*` 前缀的相同环境变量。
2. **Google Calendar（可选）。** 要同步即将召开的会议，请从“设置”连接 Google Calendar 帐户。 dev中的OAuth回调URL是`http://localhost:8094/_agent-native/google/callback`。在 [Google Cloud Console](https://console.cloud.google.com/) 中设置 Google OAuth 客户端，并启用 Gmail 和 Google Calendar API。
3. **屏幕捕获权限。** 在 macOS 上，在系统设置 → 隐私和安全 → 屏幕录制中向浏览器（或桌面配套应用程序）授予屏幕录制权限。浏览器记录可以保存经过编辑的控制台并从记录器页面获取/XHR 诊断信息。 Chrome 扩展程序列表可用后，启用 `VITE_CLIPS_CHROME_EXTENSION_ENABLED=1`，以便用户可以选择活动选项卡浏览器日志的扩展程序或桌面应用程序以获得最流畅的本机捕获路径。
4. **Slack 预览（可选）。** 使用 `links:read`、`links:write` 和 `links.embed:write` 创建 Slack 应用程序；订阅`link_shared`；在 **App Unfurl Domains** 下添加您的 Clips 共享域；将请求URL设置为`https://your-clips.example.com/api/slack/unfurl`；并添加 OAuth 重定向 URL `https://your-clips.example.com/api/slack/oauth/callback`。配置 `SLACK_CLIENT_ID`、`SLACK_CLIENT_SECRET` 和 `SLACK_SIGNING_SECRET`，然后从剪辑设置连接工作区。

### 托管您自己的 Clips 服务器

[clips.agent-native.com](https://clips.agent-native.com) 上托管的 Clips 应用
只是 Clips 模板的部署副本。要运行您自己的服务器，脚手架
模板，像任何其他代理本机应用程序一样部署它，然后指向桌面
部署中的托盘应用程序。

1. **创建应用程序。**

   ```bash
   npx @agent-native/core@latest 创建 my-clips --standalone --template 剪辑
   cd my-clips
   pnpm安装
   ```

2. **配置生产状态。**设置一个持久化的`DATABASE_URL`，正常
   来自 [Deployment](/docs/deployment) 的生产授权/秘密变量，以及
   视频存储提供商。 Builder.io Connect是最简单的存储路径；对于
   自托管存储，使用 `S3_*` 或 `R2_*` 变量进行 S3 兼容
   桶。

3. **部署 Web 应用程序。**对于普通节点部署：

   ```bash
   pnpm构建
   节点.output/server/index.mjs
   ```

   您还可以使用 [Deployment](/docs/deployment) 中的任何 Nitro 目标，例如
   作为 Netlify、Vercel、Cloudflare Pages、AWS Lambda 或 Deno Deploy。确保
   例如，`BETTER_AUTH_URL` 是公共 Clips 来源
   `https://clips.example.com`.

4. **连接桌面托盘应用。**打开 Clips Desktop 设置并进行设置
   **将服务器 URL** 剪辑到部署的公共基础 URL，例如
   `https://clips.example.com`。如果应用程序安装在工作空间路径下，
   包含该路径，例如 `https://example.com/clips`。单击**连接**，
   然后使用该 Clips 服务器上的帐户登录。

5. **发布后启用 Chrome 扩展程序。**保留
   `VITE_CLIPS_CHROME_EXTENSION_ENABLED` 在 Chrome 网上应用店上市之前未设置
   已获批准。然后将其设置为 `1` 以显示浏览器日志选项旁边
   桌面应用程序提示。默认列表URL是
   `https://chromewebstore.google.com/detail/baoipacpchggcdigagnajakiidcgcffn`;
   仅当您的部署使用时才设置 `VITE_CLIPS_CHROME_EXTENSION_URL`
   不同的扩展名列表。

6. **连接可选集成。** Google Calendar 为“会议”选项卡提供支持，
   `GEMINI_API_KEY` 或 Builder.io Connect 支持转录清理和标题，
   `GROQ_API_KEY` 可以提供语音转文本回退，而 Slack OAuth
   “设置”中的连接可以展开可玩的 Slack。

对于本地开发，请使用 `pnpm dev` 运行 Web 应用程序并指向桌面
`http://localhost:8094` 上的托盘应用程序。

### 主要功能

**一个库，三种捕获类型。**屏幕录制、日历会议和一键通听写共享一个可搜索库。

**文字记录和 AI 管道。** 录音获取带有时间戳的文字记录片段、生成的标题、摘要和章节标记。

**非破坏性编辑。**修剪、分割、填充词删除、静音删除和拼接保留在 `edits_json` 中，因此原始媒体保持完整。

**客服人员可读的共享链接。**公共共享链接公开文字记录和框架 API，以便客服人员无需摄取原始视频即可理解录音。

**Slack 可玩展开。**公共共享链接可以渲染 Slack `video` 块
指向现有的 `/embed/:id` 玩家。这是一个工作区 Slack 应用
安装，不是全局爬虫行为：正常的 Open Graph/Twitter 元数据是
未安装应用程序时的后备。

### 数据模型

所有数据通过 Drizzle ORM 存储在 SQL 中。架构：`templates/clips/server/db/schema.ts`。录音、会议、听写、日历帐户和词汇都带有标准 `ownableColumns` 并具有匹配的框架共享表，因此它们属于每用户/每组织共享模型。

```an-schema title="Clips 核心数据模型" summary="recordings is the source of truth for media; transcripts, meetings, and dictations compose with it rather than duplicating video. (Engagement and org tables omitted for clarity — see the full table below.)"
{
  "entities": [
    {
      "id": "recordings",
      "name": "recordings",
      "note": "Core resource; source of truth for media. ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "title", "type": "text" },
        { "name": "video_url", "type": "text", "note": "plus format / size / duration / thumbnails" },
        { "name": "status", "type": "text" },
        { "name": "edits_json", "type": "text", "note": "非破坏性编辑" },
        { "name": "chapters_json", "type": "text", "nullable": true },
        { "name": "password", "type": "text", "nullable": true, "note": "隐私：密码/有效期" }
      ]
    },
    {
      "id": "recording_transcripts",
      "name": "recording_transcripts",
      "note": "拆分以便库和转录视图可以快速渲染",
      "fields": [
        { "name": "recording_id", "type": "text", "fk": "recordings.id" },
        { "name": "segments_json", "type": "text", "note": "{ startMs, endMs, text }" },
        { "name": "full_text", "type": "text" },
        { "name": "language", "type": "text" },
        { "name": "status", "type": "text" }
      ]
    },
    {
      "id": "clips_meetings",
      "name": "clips_meetings",
      "note": "Calendar-sourced or ad-hoc; owns a recording",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "recording_id", "type": "text", "fk": "recordings.id", "nullable": true },
        { "name": "summary_md", "type": "text", "nullable": true },
        { "name": "bullets_json", "type": "text", "nullable": true },
        { "name": "action_items_json", "type": "text", "nullable": true }
      ]
    },
    {
      "id": "clips_dictations",
      "name": "clips_dictations",
      "note": "Push-to-talk dictation history; ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "full_text", "type": "text", "note": "原料" },
        { "name": "cleaned_text", "type": "text", "nullable": true },
        { "name": "source", "type": "text", "note": "fn-按住等" },
        { "name": "target_app", "type": "text", "nullable": true }
      ]
    }
  ],
  "relations": [
    { "from": "recordings", "to": "recording_transcripts", "kind": "1-1", "label": "transcript" },
    { "from": "recordings", "to": "clips_meetings", "kind": "1-1", "label": "captured by" }
  ]
}
```

| 表                                              | 它包含什么                                                                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `recordings`                                    | 核心资源 - 标题、视频 URL/格式/大小、持续时间、缩略图、状态、无损 `edits_json`、`chapters_json`、隐私（密码、过期）和播放器切换     |
| `recording_transcripts`                         | 每次录制的文字记录：`segments_json` (`{startMs,endMs,text}`)、`full_text`、语言和状态                                               |
| `recording_tags`                                | 录音上的自由格式标签                                                                                                                |
| `recording_ctas`                                | 覆盖在录音上的号召性用语按钮（标签、网址、颜色、位置）                                                                              |
| `recording_comments`                            | 带有表情符号反应图和已解决标志的线程化、带时间戳的评论                                                                              |
| `recording_reactions`                           | 表情符号 reactions 固定到视频时间戳（允许匿名观看者）                                                                               |
| `recording_viewers` / `recording_events`        | 观看分析：每个观看者的观看时间和完成情况，以及精细事件（观看开始、观看进度、搜索、暂停、CTA 点击、反应）                            |
| `clips_meetings`                                | 日历来源或临时会议 - 计划/实际跨度、平台、用户注释、AI `summary_md`、`bullets_json`、`action_items_json` 及其 `recording_id` 的链接 |
| `meeting_participants` / `meeting_action_items` | 与会者和提取的会议行动项目                                                                                                          |
| `calendar_accounts` / `calendar_events`         | 连接的日历帐户（OAuth 代币存在于 `app_secrets` 中，仅在此处引用）和同步的事件快照                                                   |
| `clips_dictations`                              | 一键通听写历史记录 - 原始 `full_text`、可选 `cleaned_text`、源（`fn-hold` 等）和目标应用                                            |
| `clips_vocabulary`                              | 个人词汇更正（术语→首选替换）会影响未来的听写                                                                                       |
| `spaces` / `space_members` / `folders`          | 库组织 - 空间（主题范围容器）、其成员和可嵌套文件夹                                                                                 |
| `organization_settings`                         | 每个组织的 Clips sidecar：品牌颜色、徽标、默认可见性                                                                                |

录音和文字记录是故意分开的表，因此库和文字记录视图都可以快速渲染。会议由录音组成，而不是复制媒体：会议拥有其捕获的录音，但 `recordings` 行仍然是视频和每段文字记录的真实来源。

UI 中的路由位于 `templates/clips/app/routes/` 下 - 经过身份验证的应用程序位于 `_app.*` 下（库、空间、文件夹、会议、听写、见解、垃圾箱、设置），公共界面位于 `r.$recordingId`、`share.$shareId`、`embed.$shareId` 和 `invite.$token`。

### 密钥actions

每个代理可调用操作都是 `templates/clips/actions/` 中的 TypeScript 文件，自动安装在 `POST /_agent-native/actions/:name` 上，并可作为 `pnpm action <name>` 从 CLI 运行。有~80个actions；有用的分组：

- **录制生命周期** — `create-recording`、`finalize-recording`、`update-recording`、`set-thumbnail`、`archive-recording` / `restore-recording` / `trash-recording` / `delete-recording-permanent`、`move-recording`、`tag-recording`。
- **成绩单和 AI** — `request-transcript`、`cleanup-transcript`、`regenerate-title` / `regenerate-summary` / `regenerate-chapters`、`set-chapters`、`generate-workflow`。 （`cleanup-transcript` 和 `finalize-meeting` 是服务器端媒体管道调用；大多数其他 AI 功能委托给代理聊天。）
- **编辑** — 非破坏性 `trim-recording`、`split-recording`、`remove-filler-words`、`remove-silences` 以及 `stitch-recordings`、`undo-edit`、`clear-edits`。编辑累积在`edits_json`；客户端通过 ffmpeg.wasm 连接/导出。
- **会议** — `create-meeting`、`start-meeting-recording` / `stop-meeting-recording`、`finalize-meeting`、`update-meeting`、`get-meeting`、`list-meetings`，以及日历接线 `connect-calendar` / `disconnect-calendar` / `sync-calendars` / `list-calendar-accounts`。
- **听写** - `create-dictation`、`cleanup-dictation`、`update-dictation`、`list-dictations` 和 `add-vocabulary-term` / `list-vocabulary` 用于个人词汇偏差。
- **图书馆组织** — `create-space` / `rename-space` / `delete-space`、`add-space-member` / `remove-space-member`、`create-folder` / `rename-folder` / `delete-folder`、`add-recording-to-space`。
- **分享、评论和参与** — 框架共享 actions 加上 `create-cta` / `update-cta` / `delete-cta`、`add-comment` / `reply-to-comment` / `resolve-comment` / `react-to-comment` / `delete-comment`、`react-to-recording`、 `list-viewers`。
- **组织和成员** — `create-organization`、`set-organization-branding`、`invite-member` / `accept-invite` / `decline-invite` / `get-invite`、`remove-member`、`update-member-role`、`list-organization-state`、`list-notifications`。
- **搜索、见解和导出** - `search-recordings`（匹配标题、描述、转录文本和评论，带时间戳）、`get-recording-insights`、`get-organization-insights`、`export-insights-csv`、`export-to-brain`。
- **上下文和导航** — `view-screen`（当前剪辑、播放头、选定的转录范围）和 `navigate`；突变后的`refresh-list`。

### 自定义它

Clips 是一个完整的、可克隆的模板——分叉它并要求代理扩展它。一些例子：

- “添加一个填充词删除按钮，从记录中删除 ums 和 uhs 并重新拼接视频。”
- “每当会议结束时，自动将我的站立笔记发布到 Slack #eng。” （先通过[Messaging](/docs/messaging)连接Slack。）
- “添加一个热键，将最后一次听写作为新票放入 Linear 中。”
- “按项目对库进行分组 - 从每个转录本的第一个单词中检测项目。”
- “添加一个‘从此剪辑生成博客文章’按钮，该按钮可以从文字记录中起草一篇文章并将其另存为草稿。”
- “让观看者在共享剪辑上留下带时间戳的 reactions。”

代理根据需要编辑路由、组件、转录管道和架构。请参阅 [Templates](/docs/cloneable-saas) 了解完整克隆、自定义、部署流程，如果这是您的第一个代理本机模板，请参阅 [Getting Started](/docs/getting-started)。

## 下一步是什么

- [**Templates**](/docs/cloneable-saas) — 克隆自有模型
- [**Context Awareness**](/docs/context-awareness) — 代理如何知道当前剪辑和播放头
- [**Agent Teams**](/docs/agent-teams) — 将转录清理委托给专业子代理
