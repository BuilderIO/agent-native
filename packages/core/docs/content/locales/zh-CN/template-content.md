---
title: "内容"
description: "MDX 的开源 Obsidian：编辑本地 Markdown/MDX 文件，生成丰富的交互式自定义块，并使用 AI 代理进行编写。"
---

# 内容

内容是 MDX 的开源 Obsidian：本地文件友好文档
代理可以在其中读取、写入、重新组织和发布页面的工作空间
你。打开文档，要求“重写此段落以使其更加简洁”或“创建一个
名为第四季度规划的页面，其中包含目标、指标和风险的子页面” - 相同
无论你自己做还是要求，都会有结果。

```an-wireframe
{
  "surface": "desktop",
  "html": "<div style='display:grid;grid-template-columns:210px 1fr;gap:14px;padding:16px;min-height:500px;box-sizing:border-box'><aside class='wf-card' style='display:flex;flex-direction:column;gap:10px'><strong>Content</strong><span class='wf-pill accent'>第三季度路线图</span><span class='wf-pill'>Goals</span><span class='wf-pill'>Metrics</span><span class='wf-pill'>Risks</span><hr/><span class='wf-pill'>工程 wiki</span><span class='wf-pill'>阅读清单</span><span class='wf-pill'>每周同步</span></aside><main style='display:flex;flex-direction:column;gap:12px;min-width:0;padding:8px 20px'><div style='display:flex;align-items:center;gap:10px'><h1 style='margin:0'>第三季度路线图</h1><div style='flex:1'></div><button>分享</button><button class='primary'>Publish</button></div><div class='wf-card' style='flex:1;display:flex;flex-direction:column;gap:12px;padding:22px'><h2 style='margin:0'>发布目标</h2><p style='margin:0'>发布 onboarding 流程，缩短设置时间，并记录负责人交接。</p><div class='wf-box'>概览 · 负责人、时间窗口、状态</div><div class='wf-box'>主要目标</div><div class='wf-box'>工作流表</div></div></main></div>"
}
```

当您打开应用程序时，您将在编辑器旁边看到一个页面树。代理始终知道您正在查看哪个页面以及您选择了哪些文本，因此文档编辑可以保持在当前页面。

```an-diagram title="一份文档，多名编辑" summary="您和代理都通过相同的 Yjs 管道进行写入。 SQL 是规范存储；本地文件和 Notion 是可选的同步表面。"
{
  "html": "<div class=\"diagram-flow\"><div class=\"diagram-col\"><div class=\"diagram-node\">你输入<br><small class=\"diagram-muted\">slash 菜单、工具栏</small></div><div class=\"diagram-node\">代理编辑<br><small class=\"diagram-muted\">edit-document find/replace</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\"><span class=\"diagram-pill accent\">Yjs CRDT</span><small class=\"diagram-muted\">实时、无冲突合并</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\">documents (markdown)<br><small class=\"diagram-muted\">规范 SQL 存储</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&harr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">本地 .md / .mdx<br><small class=\"diagram-muted\">/local-files</small></div><div class=\"diagram-box\">Notion 页面<br><small class=\"diagram-muted\">拉取 · 推送</small></div></div></div>",
  "css": ".diagram-flow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-flow .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-flow .diagram-arrow{font-size:22px;line-height:1}.diagram-flow .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## 你可以用它做什么

- **编写包含标题、列表、表格、代码块、图像和链接的富文本**。斜线命令（`/`）插入块；选择文本会弹出格式工具栏。
- **在树中组织页面** — 无限嵌套、拖动重新排序、收藏您经常使用的页面。
- **搜索所有内容**，通过标题和内容进行全文搜索。
- **像 Obsidian 一样编辑本地 Markdown/MDX 文件。**使用 `/local-files` 视图
  将工作区导出到文件，在您自己的工具中编辑它们，预览
  更改，并将其导入回来。在本地文件模式下，内容直接写入
  选定的 `.md` 或 `.mdx` 文件。
- **生成丰富的交互式自定义块。**注册本地React组件，
  将它们插入为 MDX，并让代理创建或更新组件文件
  您的文档。
- **与 Notion 同步。** 将本地文档链接到 Notion 页面，并向任一方向拉取或推送内容。评论也可以双向同步。
- **实时协作。**多人（和代理）可以同时编辑同一份文档。
- **与团队成员共享文档**或将其公开 - 默认情况下为私有，具有查看者/编辑者/管理员角色。
- **向代理询问任何事情**：“重写此段落。” “在顶部添加 TL;DR。” “找到我上周的所有会议记录。” “让这个语气更加正式。”

## 开始使用

现场演示：[content.agent-native.com](https://content.agent-native.com)。

打开应用程序后，单击侧边栏中的 **+ 新页面**，为其指定标题，然后开始编写。要使用代理，请在侧边栏中输入：

- “创建一个名为 Onboarding 的页面，并在其下添加三个子页面。”
- “重写此段落以使其更加简洁。” （打开页面）
- “添加有关定价的部分，其中包含三个要点。”
- “将此文档总结为顶部的 TL;DR。”
- “从 Notion 中提取最新版本。” （链接 Notion 页面后）

选择文本并按 Cmd+I 以使代理聚焦于预加载的选择 — “使此内容更加有力”，然后对您突出显示的内容进行操作。

## 本地Markdown/MDX文件 {#local-files}

内容可以通过本地文件往返文档，无需克隆或运行
本地内容应用程序。感觉就像 MDX 的黑曜石：文件保持可检查
并且可编辑，同时该应用程序为您提供丰富的编辑器、代理 actions、共享和
自定义块。打开`/local-files`，在浏览器或Agent中选择一个文件夹
Native Desktop，并将当前文档树导出为Markdown/MDX
`content/`.

每个导出的文件都包含文档元数据的 frontmatter（`id`、`title`、
`parentId`、`position`、收藏夹/搜索/可见性标志和 `updatedAt`）加上
文档正文为Markdown。您可以在普通编辑器中编辑这些文件，
然后返回 `/local-files` 预览并将更改导入回内容中。

当您想要源代码管理中的内容、想要批处理时，此工作流程非常有用
使用本地工具编辑文档，或者希望为偏爱文件的团队提供非克隆路径
作为审查表面。托管应用程序仍然是共享的事实来源，
评论、权限和实时协作；本地文件夹是显式的
同步表面。

内容还可以在**本地文件模式**下运行，其中文件是内容的来源
真相而不是SQL文件。将 `agent-native.json` 添加到仓库，设置
`mode: "local-files"`，并配置`docs/`、`blog/`等根，
`content/` 和 `resources/`。然后标准内容编辑器填充其
来自本地 `.md`/`.mdx` 文件的左侧边栏，并将编辑写回
通过普通文件actions选择文件。将其用于回购优先文档，
由 MDX 驱动的博客、资源库或黑曜石风格的个人内容
组件；当您需要托管协作时切换回数据库模式并且
SQL 支持的共享。请参阅 [Local File Mode](/docs/local-file-mode)
独立存储库布局、配置、自定义 MDX 组件、本地
`extensions/`小部件、安全生产指南。

要将内容本地文件技能安装到现有存储库中：

```bash
npx @agent-native/core@latest skills add content --mode local-files --scope project
```

安装程序会复制您的编码代理的 `content` 技能并写入或
使用 `docs/`、`blog/`、`content/` 的内容根更新 `agent-native.json`
和`resources/`。当本地内容应用、Agent Native 桌面或受信任
本地网桥正在运行，代理应使用内容actions，例如
`list-documents`、`get-document`、`edit-document`、`update-document` 和
`share-local-file-document` 而不是原始文件系统写入。没有那个本地
bridge，已安装的技能仍然为代理提供了回购编辑合同
安全 Markdown/MDX 编辑。

## 对于开发者

本文档的其余部分适用于任何分叉内容模板或扩展它的人。

### 快速启动

使用内容模板搭建新工作区：

```bash
npx @agent-native/core@latest create my-workspace --standalone --template content
cd my-workspace
pnpm install
pnpm dev
```

打开 `http://localhost:8083` 并创建您的第一个页面。然后要求客服人员“创建一个名为 Onboarding 的页面，并在其下添加三个子页面”。

### 主要功能 {#key-features}

**嵌套页面。**文档形成一个可拖动的树，其中包含收藏夹、图标、排序和页面级共享。

**丰富的 MDX 编辑器。** Tiptap 支持标题、列表、表格、代码块、图像、链接、斜线命令、选择工具栏和本地 React 组件。

**实时协作。** Yjs 使多个编辑者和代理编辑保持同步，而不会相互干扰。

**搜索和评论。**全文搜索、锚定评论、版本历史记录和恢复流程内置于文档界面中。

**同步表面。**文档可以与 Notion 或本地 Markdown/MDX 文件夹同步，其中 SQL 充当协作缓存/历史记录层。

### 本地文件同步

受保护的 `/local-files` 路由使用浏览器文件系统访问 API，或
保护Agent Native桌面内的本机文件夹桥，以进行读写
用户选择的文件夹中的 Markdown/MDX 文件。链接文件夹后
导入后，选择的文件被视为权限：打开页面读取
文件，普通编辑器先保存写入文件。 SQL 然后更新为
现有文档UI、搜索和版本面板的缓存/历史层，不
作为真相的来源。右上角页面菜单公开本地源路径：
相对路径始终可用，绝对路径在真正的本地文件中可用
模式和 Agent Native 桌面，以及在 Finder 中显示可通过
桌面桥或服务器支持的本地文件模式。

批量同步路由调用：

- `export-content-source` — 读取可访问的文档树并返回
  确定性 `content/` 文件包。
- `import-content-source` - 验证文件，创建新的私人文档，
  更新调用者具有编辑访问权限的文档，保留版本
  历史记录，并拒绝无效的父周期。

源格式位于 `shared/content-source.ts`。将该文件保留为
文件名、frontmatter、解析和序列化的单一合约。

本地文件工作区还可以通过
配置的`components`文件夹。内容开发服务器导入 PascalCase
从这些文件导出，渲染匹配的 MDX 标签，例如 `<ImpactCounter />`
在编辑器内，并在本地组件下的斜线菜单中公开它们。
这是“Obsidian for MDX”层：自定义 MDX 块保留在本地
工作空间，但编辑器可以渲染它们，代理可以生成或更新
其来源，无需克隆内容应用程序。最小的工作区组件可以
是：

```tsx
// components/ImpactCounter.tsx
import { useState } from "react";

export function ImpactCounter({
  label = "points",
  start = 3,
}: {
  label?: string;
  start?: number;
}) {
  const [count, setCount] = useState(start);
  return (
    <button type="button" onClick={() => setCount(count + 1)}>
      Impact: {count} {label}
    </button>
  );
}

export const ImpactCounterInputs = {
  label: { type: "string", label: "Label", default: "points" },
  start: { type: "number", label: "Starting count", default: 3 },
};
```

在本地MDX中使用它作为`<ImpactCounter />`，或者从编辑器斜杠插入
本地组件下的菜单。导出输入元数据时，选择
编辑器中的组件显示一个角落编辑按钮，用于重写 MDX 属性
在本地文件中。

The browser **Local files** picker can read and write `.md` and `.mdx` files on
其自己的可执行 React 组件预览需要本地编译器。运行
本地内容或使用 Agent Native Desktop，以便选定的工作空间路径可以
已注册到本地内容开发服务器。 Vite 然后导入
`components/*.tsx`，热重载编辑现有组件文件，并重新加载
添加或删除文件时的组件注册表。代理可以使用
`list-local-component-files` 和 `write-local-component-file` 进行检查或
更新注册的组件文件，同时编辑器从同一源更新。

### 评论

对带有引用文本锚点、回复和解决状态的文档进行线程化评论。由 `document_comments` 桌子和 `app/components/editor/CommentsSidebar.tsx` 提供支持。 Actions：`list-comments`、`add-comment`。 Notion评论可以通过`sync-notion-comments`双向同步。

### 版本历史

每个重要更新都会对 `document_versions` 表中的一行进行快照。 UI 在 `app/components/editor/VersionHistoryPanel.tsx` 中呈现这些。

### 分享和可见性

默认情况下，文档是私有的。您可以更改对 `org` 或 `public` 的可见性，或授予每个用户和每个组织角色（`viewer`、`editor`、`admin`）。该框架的自动安装共享 actions 开箱即用：

- `share-resource --resourceType document --resourceId <id> --principalType user --principalId <email> --role editor`
- `unshare-resource` / `list-resource-shares` / `set-resource-visibility`

查看`sharing`技能。

### 团队

`/team` 上的专用团队页面（请参阅 `app/routes/_app.team.tsx`）使用框架的 `TeamPage` 组件来创建组织和管理成员。

### 与代理合作

由于代理会看到您当前的屏幕，因此大多数提示不需要您明确引用文档。当您打开一个页面时，“this”表示该页面。

对于小型编辑，代理使用 `edit-document --find ... --replace ...`，因此只有更改的文本流经 Yjs — 您将看到差异应用到位，而不是整个页面重新渲染。对于更大的重写，它使用 `update-document --content ...`。

如果您选择文本并按 Cmd+I（或将焦点放在代理面板上），则选择内容将与您的下一条消息一起作为上下文移动，因此“使此内容更加有力”会针对您突出显示的内容进行操作。

### 数据库和属性

文档可以托管内联数据库 - Notion 样式的表，其中每一行本身就是一个文档。代理可以通过 actions 创建数据库、添加项目、配置列定义以及设置属性值：`create-content-database`、`add-database-item`、`set-document-property`。属性定义（类型、可见性、选项、位置）位于 `document_property_definitions` 中；每行值位于 `document_property_values` 中。

### 额外的actions

除了数据模型中的 CRUD 表面之外，模板还提供了 `export-document` 用于将页面转换为 Markdown 或 HTML、`transcribe-media` 用于将脚本附加到页面，以及 `restore-document-version` 用于回滚到较早的快照。

### 数据模型

九个表，全部在`server/db/schema.ts`中定义：

- **`documents`** — 页面树。列：`id`、`parent_id`、`title`、`content`（降价）、`icon`、`position`、`is_favorite`、`visibility`、`owner_email`、`org_id`、`created_at`、 `updated_at`。
- **`document_versions`** — 版本历史记录的标题和内容的完整快照。使用`restore-document-version`回滚。
- **`document_comments`** — 带有 `thread_id`、`parent_id`、`quoted_text`、`resolved` 的线程注释以及用于双向 Notion 同步的可选 `notion_comment_id`。
- **`document_sync_links`** — 每个 Notion 链接文档一行跟踪远程页面 ID、上次同步时间、冲突状态、内容哈希和错误。
- **`document_property_definitions`** — 内联数据库的列定义：名称、类型、可见性、选项和位置。
- **`content_databases`** — 附加到 `document_id` 的内联数据库对象，带有标题和视图配置 JSON。
- **`content_database_items`** — 内联数据库中的行，每行将 `database_id` 链接到 `document_id`。
- **`document_property_values`** — 每个文档的属性值（`property_id` → `value_json`）。
- **`document_shares`** — 通过 `createSharesTable` 创建的每用户和每组织拨款。

```an-schema title="内容数据模型" summary="Nine tables in server/db/schema.ts. documents is the page tree; the rest hang off it for versions, comments, Notion sync, inline databases, and sharing."
{
  "entities": [
    {
      "id": "documents",
      "name": "documents",
      "note": "The page tree (ownable, markdown body)",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "parent_id", "type": "id", "fk": "documents.id", "nullable": true, "note": "infinite nesting" },
        { "name": "title", "type": "string" },
        { "name": "content", "type": "markdown" },
        { "name": "icon", "type": "string", "nullable": true },
        { "name": "position", "type": "int", "note": "sibling ordering" },
        { "name": "is_favorite", "type": "bool" },
        { "name": "visibility", "type": "enum", "note": "私人|组织|民众" },
        { "name": "owner_email", "type": "string" },
        { "name": "org_id", "type": "id", "nullable": true }
      ]
    },
    {
      "id": "document_versions",
      "name": "document_versions",
      "note": "版本历史记录的完整 title/content 快照",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "document_id", "type": "id", "fk": "documents.id" },
        { "name": "title", "type": "string" },
        { "name": "content", "type": "markdown" }
      ]
    },
    {
      "id": "document_comments",
      "name": "document_comments",
      "note": "带有引用文本锚的线索评论",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "document_id", "type": "id", "fk": "documents.id" },
        { "name": "thread_id", "type": "id" },
        { "name": "parent_id", "type": "id", "fk": "document_comments.id", "nullable": true },
        { "name": "quoted_text", "type": "string", "nullable": true },
        { "name": "resolved", "type": "bool" },
        { "name": "notion_comment_id", "type": "string", "nullable": true, "note": "双向概念同步" }
      ]
    },
    {
      "id": "document_sync_links",
      "name": "document_sync_links",
      "note": "每个概念链接文档一行",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "document_id", "type": "id", "fk": "documents.id" },
        { "name": "notion_page_id", "type": "string" },
        { "name": "conflict", "type": "bool" },
        { "name": "content_hash", "type": "string" }
      ]
    },
    {
      "id": "content_databases",
      "name": "content_databases",
      "note": "附加到文档的内联数据库对象",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "document_id", "type": "id", "fk": "documents.id" },
        { "name": "title", "type": "string" },
        { "name": "view_config", "type": "json" }
      ]
    },
    {
      "id": "content_database_items",
      "name": "content_database_items",
      "note": "Rows in an inline database (each row is a document)",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "database_id", "type": "id", "fk": "content_databases.id" },
        { "name": "document_id", "type": "id", "fk": "documents.id" }
      ]
    },
    {
      "id": "document_property_definitions",
      "name": "document_property_definitions",
      "note": "内联数据库的列定义",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "name", "type": "string" },
        { "name": "type", "type": "string" },
        { "name": "options", "type": "json", "nullable": true },
        { "name": "position", "type": "int" }
      ]
    },
    {
      "id": "document_property_values",
      "name": "document_property_values",
      "note": "每个文档的属性值",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "document_id", "type": "id", "fk": "documents.id" },
        { "name": "property_id", "type": "id", "fk": "document_property_definitions.id" },
        { "name": "value_json", "type": "json" }
      ]
    },
    {
      "id": "document_shares",
      "name": "document_shares",
      "note": "Per-user and per-org grants (createSharesTable)",
      "fields": [
        { "name": "id", "type": "id", "pk": true },
        { "name": "document_id", "type": "id", "fk": "documents.id" },
        { "name": "principal", "type": "string" },
        { "name": "role", "type": "enum", "note": "观众|编辑|行政" }
      ]
    }
  ],
  "relations": [
    { "from": "documents", "to": "documents", "kind": "1-n", "label": "has children" },
    { "from": "documents", "to": "document_versions", "kind": "1-n", "label": "has snapshots" },
    { "from": "documents", "to": "document_comments", "kind": "1-n", "label": "has comments" },
    { "from": "documents", "to": "document_sync_links", "kind": "1-1", "label": "概念链接" },
    { "from": "documents", "to": "content_databases", "kind": "1-n", "label": "hosts databases" },
    { "from": "content_databases", "to": "content_database_items", "kind": "1-n", "label": "has rows" },
    { "from": "document_property_definitions", "to": "document_property_values", "kind": "1-n", "label": "has values" },
    { "from": "documents", "to": "document_shares", "kind": "1-n", "label": "has share grants" }
  ]
}
```

内容以降价形式存储。编辑器在内存中与 Tiptap JSON 模型进行相互转换； SQL 行始终是降价的，因此 actions、搜索和 Notion 同步可以在单一规范格式上运行。

所有可拥有的表都包括通过 `ownableColumns()` 的 `owner_email` 和 `org_id`，因此从创建那一刻起，每一行的范围都仅限于登录用户（以及可选的活动组织）。

### 自定义它

改变行为时要注意的四个地方：

- **`actions/`** — 代理或 UI 可以执行的每个操作。使用`defineAction`添加一个像`actions/publish-to-wordpress.ts`这样的新文件，双方都可以免费获得。现有actions主要：`create-document.ts`、`edit-document.ts`、`update-document.ts`、`delete-document.ts`、`list-documents.ts`、`search-documents.ts`、`get-document.ts`、`pull-notion-page.ts`、`push-notion-page.ts`、`add-comment.ts`、`view-screen.ts`、 `navigate.ts`。
- **`app/routes/`** — 页面表面。 `_app.tsx` 是无路径布局，保持侧边栏和代理面板安装； `_app._index.tsx`为落地视图； `_app.page.$id.tsx`是编辑器路线； `_app.team.tsx`是团队设置页面。
- **`app/components/editor/`** — Tiptap 编辑器。在`extensions/`下添加新的节点类型，并在`DocumentEditor.tsx`中注册。气泡工具栏、斜杠菜单和悬停预览都是您可以编辑的组件文件。
- **`.agents/skills/`** — 代理在行动前阅读的指南。如果您添加新功能（例如，CMS 发布管道），请将 `SKILL.md` 放入新技能文件夹中，以便代理正确使用它。现有skills：`document-editing`、`notion-integration`、`real-time-sync`、`delegate-to-agent`、`storing-data`、`self-modifying-code`、`security`、`frontend-design`、`create-skill`、`capture-learnings`。
- **`AGENTS.md`** — 带有操作备忘单和常见任务表的顶级代理指南。每当您添加主要功能时更新它，以便代理无需探索即可发现它。
- **`server/db/schema.ts`** — 数据模型。此处添加列或表。内容模板没有 `db:push` 脚本；它依赖于在启动时运行的严格附加迁移。编辑 `server/db/schema.ts`，编写匹配的附加迁移，并在下次应用启动时应用更改 - 架构更新绝不能删除、重命名或破坏性地更改现有表或列（有关准则，请参阅 [Database](/docs/database#migrations)）。
- **`shared/notion-markdown.ts`** — 降价到 Notion 块的转换。如果您添加需要通过 Notion 往返的新块类型，请扩展此功能。

代理可以自行进行所有这些更改 - 要求它“向文档添加标签列并将其公开在侧边栏中”，它将更新架构、迁移、连接 UI 并编写操作。
