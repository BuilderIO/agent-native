---
title: "幻灯片"
description: "根据提示生成套牌、进行可视化编辑并全屏呈现。 Google Slides、Pitch 和 PowerPoint 的开源替代品。"
---

# 幻灯片

根据提示生成完整的演示文稿、直观地编辑幻灯片并全屏演示。向代理询问“一份包含 10 张幻灯片的咖啡订阅服务宣传资料”，并在几秒钟内观看它一张一张幻灯片地传输到编辑器中。 Google Slides、Pitch 和 PowerPoint 的开源替代品。

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:flex;flex-direction:column;gap:12px;padding:16px;min-height:530px;box-sizing:border-box'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>第三季度董事会更新</h1><span class='wf-pill accent'>标题幻灯片</span><div style='flex:1'></div><button>Preview</button><button>Present</button><button class='primary'>分享</button></div><main style='display:grid;grid-template-columns:1fr 220px;gap:12px;flex:1;min-height:0'><section class='wf-card' style='display:flex;align-items:center;justify-content:center;text-align:center;padding:36px'><div><strong style='font-size:28px'>第三季度董事会更新</strong><br/><small>Maya Chen · 首席执行官</small><div style='height:46px'></div><span class='wf-pill'>产品动能</span></div></section><section style='display:flex;flex-direction:column;gap:10px'><div class='wf-card'><strong>幻灯片大纲</strong><div class='wf-box'>1 标题</div><div class='wf-box'>2 议程</div><div class='wf-box'>3 指标</div><div class='wf-box'>4 已发布</div></div><div class='wf-card' style='flex:1'><strong>演讲者备注</strong><p class='wf-muted' style='margin:8px 0 0'>以发布进展和留存故事开场。</p></div></section></main><div style='display:grid;grid-template-columns:repeat(5,1fr);gap:8px'><div class='wf-box'>1 标题</div><div class='wf-box'>2 议程</div><div class='wf-box'>3 指标</div><div class='wf-box'>4 已发布</div><div class='wf-box'>5 风险</div></div></div>"
}
```

当您打开幻灯片时，幻灯片画布、大纲、注释和幻灯片保留在一个编辑器界面中，而代理仍然可以通过 actions 创建、修改和导航幻灯片。

```an-diagram title="提示到甲板" summary="请求一副牌，代理会通过您可以从 CLI 调用的相同操作一次滑入一张幻灯片。"
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-node\">提示<br><small class=\"diagram-muted\">\"10-slide pitch deck\"</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Agent</span><small class=\"diagram-muted\">选择布局</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-pill\">create-deck</div><div class=\"diagram-pill\">add-slide &#215; n</div><small class=\"diagram-muted\">并行、流式传输</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>decks (SQL)</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-box\">编辑器实时渲染</div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:6px;align-items:center}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}"
}
```

## 你可以用它做什么

- **根据提示生成演示文稿。**“为咖啡订阅服务生成 10 张幻灯片的宣传演示文稿，受众是投资者。”
- **直观地编辑幻灯片** — 双击文本进行编辑，单击气泡菜单的块，使用斜线菜单的 `/` 插入块。
- **使用人工智能生成图像。**英雄图像、产品模型、插图 - 最好委托给资产，Builder 管理的图像生成准备好在部署后启用，并直接提供程序密钥作为今天的后备。
- **搜索库存照片和公司徽标。**“查找 stripe.com 的徽标并将其添加到幻灯片 2。”
- **呈现全屏**，带有键盘导航、自动隐藏控件和演讲者备注。
- **评论、协作和分享。**多人可以实时编辑同一个牌组。生成公共只读URL或与特定队友共享。
- **从 PDF 导入。**将 PDF 变成入门套牌 - 代理对其进行解析并布置内容。
- **从其他格式导入。**导入 PPTX、DOCX、Google Docs、GitHub 存储库或任何 URL 作为起点。导出到 PPTX、Google 幻灯片或 HTML。
- **应用设计系统。**品牌标记、自定义说明和默认调色板保存为设计系统并应用于新牌组。
- **恢复早期版本。**每个套牌更改都会有快照；列出或恢复任何先前版本。

## 开始使用

现场演示：[slides.agent-native.com](https://slides.agent-native.com)。

当您打开应用程序时：

1. 点击**新牌组**。
2. 询问代理：“为咖啡订阅服务生成 10 张幻灯片的推介材料，受众是投资者。”
3. 观看幻灯片流入。点击任何幻灯片进行编辑，或不断要求客服人员进行优化。

### 有用的提示

- “为咖啡订阅服务生成 10 张幻灯片的推介材料，受众是投资者。”
- “在幻灯片 3 之后添加定价幻灯片。”
- “放大此幻灯片上的标题并将强调色更改为绿色。”
- “为当前幻灯片生成主图像 - 黑暗、简约、电影。”
- “找到 stripe.com 的徽标并将其添加到幻灯片 2 中。”
- “将此套牌中所有地方的‘客户’一词替换为‘会员’。”
- “将此 PDF 概括为 6 张幻灯片。” （附上PDF）

选择幻灯片上的文本，然后按 Cmd+I 使代理聚焦于该选择 — 它将仅对您选择的内容进行操作。

## 对于开发者

本文档的其余部分适用于任何分叉幻灯片模板或扩展它的人。

### 快速入门

从 CLI 创建新的幻灯片应用：

```bash
npx @agent-native/core@latest create my-slides --standalone --template slides
cd my-slides
pnpm install
pnpm dev
```

### 主要功能 {#key-features}

**提示牌组生成。**请求牌组，代理流会滑入编辑器，使用您可以自己运行的相同创建和编辑 actions。

**可编辑的幻灯片画布。**内联文本编辑、斜线插入、代码编辑、拖放排序、撤消/重做、注释和演示模式全部位于幻灯片表面。

**导入和导出。**引入 PPTX、DOCX、Google Docs、PDF、URL 和 GitHub 存储库；导出到 PPTX、Google 幻灯片、HTML 或共享链接。

**设计系统和媒体。**保存的品牌系统、图像生成、库存搜索和徽标查找使套牌更接近预期的视觉方向。

**协作和历史记录。**内置实时 Yjs 编辑、线程评论、共享角色和套牌版本快照。

### 与代理合作

代理聊天位于侧边栏中。它可以创建幻灯片、编辑单个幻灯片、生成图像、搜索徽标以及导航 UI - 所有这些都使用您从 CLI 运行的相同 actions。

#### 代理看到的内容

当牌组打开时，代理会自动看到：

- 当前的`deckId`和`slideIndex`。
- 开放式幻灯片的完整列表。
- 当前所选幻灯片的 HTML 内容。

这会作为 `current-screen` 块注入到每条消息中，因此代理永远不必猜测“这张幻灯片”的含义。数据来自 `navigation` 应用程序状态密钥，UI 将其写入每次导航。参见`templates/slides/actions/view-screen.ts`。

#### 选择文本进行集中编辑

选择幻灯片上的文本，然后按 Cmd+I 以使代理聚焦于预加载的选择。代理将仅根据您选择的内容采取行动。

#### 聊天中的内联幻灯片预览

代理可以使用框架的嵌入栅栏将实时幻灯片预览直接嵌入到聊天回复中。它通过 `app/routes/slide.tsx` 渲染无边框 iframe，因此您无需离开对话即可看到结果。

### 数据模型

所有牌组数据通过 Drizzle ORM 存储在 SQL 中。架构：`templates/slides/server/db/schema.ts`。

```an-schema title="幻灯片数据模型" summary="A deck owns its slides as JSON in decks.data; comments, versions, shares, and design systems hang off it."
{
  "entities": [
    {
      "id": "decks",
      "name": "decks",
      "note": "Slides live as JSON in data; carries ownableColumns",
      "fields": [
        { "name": "id", "type": "text", "pk": true, "note": "e.g. deck-1712345-abc" },
        { "name": "title", "type": "text" },
        { "name": "data", "type": "text", "note": "JSON: { title, slides: [{ id, content, layout }] }" },
        { "name": "created_at", "type": "text" },
        { "name": "updated_at", "type": "text" }
      ]
    },
    {
      "id": "slide_comments",
      "name": "slide_comments",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "deck_id", "type": "text", "fk": "decks.id" },
        { "name": "slide_id", "type": "text", "note": "滑动评论继续存在" },
        { "name": "thread_id", "type": "text", "note": "螺纹加工" },
        { "name": "parent_id", "type": "text", "nullable": true },
        { "name": "content", "type": "text" },
        { "name": "quoted_text", "type": "text", "nullable": true },
        { "name": "author_email", "type": "text" },
        { "name": "author_name", "type": "text" },
        { "name": "resolved", "type": "boolean" }
      ]
    },
    {
      "id": "deck_versions",
      "name": "deck_versions",
      "note": "用于恢复的时间点快照",
      "fields": [
        { "name": "deck_id", "type": "text", "fk": "decks.id" },
        { "name": "title", "type": "text" },
        { "name": "data", "type": "text", "note": "全副牌 JSON" },
        { "name": "change_label", "type": "text", "nullable": true }
      ]
    },
    {
      "id": "design_systems",
      "name": "design_systems",
      "note": "Reusable brand tokens; ownableColumns",
      "fields": [
        { "name": "data", "type": "text", "note": "colors / typography / spacing" },
        { "name": "assets", "type": "text", "nullable": true },
        { "name": "custom_instructions", "type": "text", "nullable": true },
        { "name": "is_default", "type": "boolean" }
      ]
    },
    {
      "id": "deck_share_links",
      "name": "deck_share_links",
      "note": "持久的公共共享链接快照",
      "fields": [
        { "name": "token", "type": "text", "pk": true },
        { "name": "title", "type": "text" },
        { "name": "slides", "type": "text", "note": "JSON 幻灯片快照" },
        { "name": "aspect_ratio", "type": "text", "nullable": true },
        { "name": "created_at", "type": "text" }
      ]
    }
  ],
  "relations": [
    { "from": "decks", "to": "slide_comments", "kind": "1-n", "label": "comments" },
    { "from": "decks", "to": "deck_versions", "kind": "1-n", "label": "snapshots" }
  ]
}
```

框架共享表（`deck_shares`、`design_system_shares`）将主体映射到每个资源的查看者/编辑者/管理员角色。

#### 套牌

| 列           | 类型 | 注释                                                      |
| ------------ | ---- | --------------------------------------------------------- |
| `id`         | 文本 | 主键，例如`deck-1712345-abc`                              |
| `title`      | 文字 | 牌组标题                                                  |
| `data`       | 文本 | JSON 斑点：`{ title, slides: [{ id, content, layout }] }` |
| `created_at` | 文本 | 时间戳                                                    |
| `updated_at` | 文字 | 时间戳                                                    |

每个牌组还带有标准的 `ownableColumns`（所有者、可见性、共享代币），因此它可以插入框架的共享模型中。

#### 幻灯片评论

| 列                            | 注释                   |
| ----------------------------- | ---------------------- |
| `id`                          | 主键                   |
| `deck_id`                     | 家长平台               |
| `slide_id`                    | 滑动评论生效           |
| `thread_id`, `parent_id`      | 线程                   |
| `content`, `quoted_text`      | 评论正文和可选文本摘录 |
| `author_email`, `author_name` | 作者                   |
| `resolved`                    | 布尔标志               |

#### 甲板股

框架提供的共享表（通过 `createSharesTable` 创建）将主体（用户或组织）映射到每个牌组的角色（查看者、编辑者、管理员）。

#### 甲板版本

牌组的时间点快照 - `deck_id`、`title`、`data`（全牌组 JSON）和可选的 `change_label`。由`list-deck-versions` / `restore-deck-version`使用。

#### 设计系统

可重复使用的品牌标记 - `data`（颜色/版式/间距）、`assets`、`custom_instructions` 和 `is_default` 标志。使用 `ownableColumns`，因此设计系统可以按用户或按组织共享。

#### design_system_shares

设计系统的框架共享表，将主体映射到角色（查看者、编辑者、管理员）。

#### deck_share_links

由 `token` 键入的持久公共共享链接快照。每行存储一个 `title`、一个 JSON、`slides` 阵列快照、一个可选的 `aspect_ratio` 和 `created_at`。此处保留共享链接意味着它们可以在服务器重新启动后继续存在并跨无服务器实例工作。

#### 幻灯片结构

`decks.data` 内的每张幻灯片为：

```json
{
  "id": "slide-1",
  "layout": "title",
  "content": "<div class=\"fmd-slide\" style=\"...\">...</div>"
}
```

`content` 是原始的 HTML — 渲染器 (`app/components/deck/SlideRenderer.tsx`) 提供黑色背景和固定纵横比，而 HTML 提供内部的所有内容。还支持丰富的嵌入：通过 `ExcalidrawSlide.tsx` 的 Excalidraw 图和通过 `MermaidRenderer.tsx` 的 Mermaid 图表。

### 自定义 {#customizing}

幻灯片模板是完全可分叉的。扩展时要注意的关键地方：

#### Actions — `templates/slides/actions/`

每个代理可调用操作都以 TypeScript 文件形式存在于此处。您会经常接触的一些：

- `create-deck.ts` — 从头开始或批量替换新牌组。
- `add-slide.ts` — 附加一张幻灯片；更喜欢用它来进行流式生成。
- `update-slide.ts` — 外科手术式查找/替换或全部内容交换。
- `view-screen.ts` — 用户所看到内容的快照。
- `generate-image.ts`、`edit-image.ts`、`image-search.ts`、`logo-lookup.ts` — 图像工具。
- `extract-pdf.ts` — PDF 摄取。

每个操作都会自动安装在 `POST /_agent-native/actions/:name` 上，并且可以从 CLI 作为 `pnpm action <name>` 进行调用。在此处添加新文件以赋予代理新功能。

#### 路线 — `templates/slides/app/routes/`

- `_index.tsx` — 套牌列表。
- `deck.$id.tsx` — 编辑。
- `deck.$id_.present.tsx` — 演示模式。
- `share.$token.tsx` — 公共只读共享页面。
- `slide.tsx` — 在聊天预览中使用单幻灯片嵌入。
- `settings.tsx` — 模板设置。
- `team.tsx` — 组织和团队管理。

#### 编辑器组件 - `templates/slides/app/components/editor/`

大多数 UI 自定义都发生在这里：`SlideEditor.tsx`、`EditorToolbar.tsx`、`EditorSidebar.tsx`、气泡菜单、斜线菜单以及用于图像生成、搜索和历史记录的面板。

#### Skills — `templates/slides/.agents/skills/`

当代理需要修改代码时解释模式的代理skills：

- `create-deck/` — 如何使用幻灯片创建新的幻灯片。
- `slide-editing/` — 如何编辑单个幻灯片。
- `deck-management/` — 如何存储和访问套牌。
- `slide-images/` - 图像生成和搜索工作流程。

#### AGENTS.md

`templates/slides/AGENTS.md` 是代理在每次对话中读取的短路由器。它指向`.agents/skills/`下的skills，并列出了核心规则、应用程序状态契约和技能指数。 `.agents/skills/create-deck/SKILL.md` 中每个布局的精确幻灯片 HTML 模板 - 每当您添加或更改幻灯片布局模式时更新该技能。

#### API路线

对于 actions 不适合的情况（文件上传、流式传输），模板会公开一小组 REST 端点：`GET/POST /api/decks`、`GET/PUT/DELETE /api/decks/:id`。参见`templates/slides/server/routes/api/`。
