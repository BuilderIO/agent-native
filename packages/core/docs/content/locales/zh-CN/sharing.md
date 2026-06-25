---
title: "共享和隐私"
description: "Google Docs 风格的共享，内置于框架中。每个用户创建的资源（文档、仪表板、设计、演示文稿、剪辑、录音、表单）都会获得相同的默认私有模型以及一致的共享 UI。"
---

# 共享和隐私

用户在代理原生应用程序中创建的每个资源（文档、仪表板、设计、演示文稿、视频编辑、屏幕录制、会议记录、表单、预订链接）**默认情况下对创建者来说是私有的**。仅当创建者明确共享它或将其可见性更改为 `org` 或 `public` 时，其他人才能看到它。

它的外观和工作方式与 Google 文档类似。相同的共享按钮、相同的对话框、相同的三层可见性模型、相同的每用户/每组织授权 - 跨每个模板，无需针对每个应用进行重新设计。

## 为什么选择一种模型 {#why}

大多数应用程序框架都会共享每个功能的项目。结果：每个类似文档的界面最终都会有自己的共享对话框、自己的权限模式、自己的访问检查错误。在代理原生中，共享是一个**框架原语**。架构列、访问检查帮助程序、共享弹出窗口和代理可调用共享 actions 均随核心一起提供。新模板通过添加两栏和一行注册来获得完整的分享故事。

这也意味着代理永远不必为每个应用程序学习新的共享模型。告诉代理在任何模板中“与作为编辑者的 Alice 共享此内容”，并且会触发相同的 `share-resource` 操作。

## 三个可见性级别 {#visibility}

粗略的可见性取决于资源本身；细粒度的赠款位于同伴共享表中。

| 可见度    | 谁可以看到它                                                              |
| --------- | ------------------------------------------------------------------------- |
| `private` | 所有者+明确授予的人员。 **每个新资源的默认值。**                          |
| `org`     | 所有者+显式授权+同一组织中的任何人（只读）。                              |
| `public`  | 所有者+明确授予+任何知道链接的人（只读）。不会出现在其他人的列表/搜索中。 |

`public` 是一个故意安静的级别：可以通过直接链接访问公共资源，但它**不会**显示在其他用户的侧边栏、列表或搜索中。这使得“共享 URL 的公开”与“跨用户发现的公开”分开。真正想要跨用户发现的画廊和模板目录明确选择加入。

```an-diagram title="视野，向外扩大" summary="资源的粗略可见性奠定了基础；伴随表中的显式共享授予会在顶部添加指定人员。"
{
  "html": "<div class=\"share-tiers\"><div class=\"diagram-card\"><span class=\"diagram-pill\">private</span><small class=\"diagram-muted\">owner + explicit grants only &middot; <strong>default</strong></small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">org</span><small class=\"diagram-muted\">+ anyone in the same org (read-only)</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill warn\">public</span><small class=\"diagram-muted\">+ anyone with the link (read-only) &middot; hidden from others' lists/search</small></div></div>",
  "css": ".share-tiers{display:flex;flex-direction:column;align-items:stretch;gap:8px}.share-tiers .diagram-card{display:flex;flex-direction:column;gap:4px;padding:12px 16px}.share-tiers .diagram-arrow{text-align:center;font-size:20px;line-height:1}"
}
```

## 股份授予中的角色 {#roles}

当您与特定用户或组织共享时，您可以选择一个角色：

- **查看者** — 只读。
- **编辑器** — 读取 + 写入。
- **管理员** — 读取+写入+管理共享（可以添加/删除其他人）。

`admin` 是否会更改 NOT 的所有权 - 每个资源仍然只有一个所有者，这与共享授予不同。

## 涵盖内容 {#covered}

每个存储用户创作作品的模板都使用此模型。具体来说：

- **内容** — 文档
- **幻灯片** — 幻灯片
- **设计** — 设计和资产
- **视频** — 作品
- **剪辑** — 屏幕录制（Loom 风格）
- **表单** — 表单定义
- **日历** — 活动和预订链接
- **分析** - 仪表板（推出 - 请参阅分析模板的 `AGENTS.md`）
- **扩展** - 沙盒迷你应用程序（参见 [Extensions](/docs/extensions#sharing)）

其中每一个都使用相同的 `ownableColumns()` 模式助手、相同的 `share-resource` 操作和相同的 `<ShareButton>` UI。从一个模板移动到另一个模板，共享对话框看起来相同。

## 未涵盖的内容 {#not-covered}

一些区域故意位于共享系统之外：

- **个人数据应用程序**（邮件、宏）- 按设计限定用户范围。没有“共享我的收件箱”概念。
- **外部真实来源应用程序** - 访问控制位于上游系统中，而不是代理本机应用程序中。
- **匿名公共 URLs** — 向注销用户公开 URL 的表单发布 slugs 和预订链接 slugs 是一个单独的轴。它们与共享系统并存，而不是在其之上。

## 分享UI {#share-ui}

每个可共享资源的标题中都有一个共享按钮。单击它会打开一个锚定到按钮（不是模式）的弹出窗口，其中包含：

- 可见性选择器（`Private` / `Organization` / `Public link`）。
- “添加人员或团队”自动完成 - 搜索组织中的用户或粘贴电子邮件。
- 用于个人电子邮件授权的 Google 文档样式 `通知 people` 复选框。
- 包含角色选择器和删除控件的当前授权列表。
- 尊重当前可见性的复制链接按钮。

共享按钮是一次导入：

```tsx
import { ShareButton } from "@agent-native/core/client";

<ShareButton
  resourceType="deck"
  resourceId={deck.id}
  resourceTitle={deck.title}
/>;
```

对于列表，请在每行旁边放置一个 `<VisibilityBadge visibility={row.visibility} />`，以便用户可以一目了然地了解哪些是私有的，哪些是共享的。

## 与UI相同型号、代理商 {#agent-and-ui}

框架在每个模板中自动安装这些 actions - 代理将它们称为工具，UI 通过 `useActionQuery` / `useActionMutation` 调用它们：

| 行动                      | 它的作用                                                             |
| ------------------------- | -------------------------------------------------------------------- |
| `share-resource`          | 授予用户或组织特定角色的访问权限。可选的 `notify` 控制电子邮件通知。 |
| `unshare-resource`        | 撤销用户或组织的访问权限。                                           |
| `list-resource-shares`    | 显示当前可见性以及所有显式授权。                                     |
| `set-resource-visibility` | 更改为 `private`、`org` 或 `public`。                                |

告诉代理“与作为编辑的营销团队共享此设计”，它会针对 UI 使用的同一端点调用 `share-resource`。结果将显示在下一次渲染的共享对话框中。

## 将其构建到新模板中 {#building}

如果您正在创建模板（请参阅 [Creating Templates](/docs/creating-templates)），则共享接线会很短。您的架构中添加了两项内容：

```ts
import {
  table,
  text,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

export const decks = table("decks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  data: text("data").notNull(),
  ...ownableColumns(), // adds owner_email, org_id, visibility
});

export const deckShares = createSharesTable("deck_shares");
```

```an-schema title="资源+同伴分享表" summary="Coarse visibility lives on the resource; each fine-grained grant is a row in the shares table."
{
  "entities": [
    {
      "id": "deck",
      "name": "decks",
      "note": "...ownableColumns()",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "title", "type": "text", "nullable": false },
        { "name": "owner_email", "type": "text", "nullable": false, "note": "所有权的唯一事实来源。" },
        { "name": "org_id", "type": "text", "nullable": true },
        { "name": "visibility", "type": "enum", "nullable": false, "note": "私人|组织|民众" }
      ]
    },
    {
      "id": "deckShare",
      "name": "deck_shares",
      "note": "createSharesTable() — one row per grant",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "resource_id", "type": "text", "fk": "decks.id", "nullable": false },
        { "name": "principal_type", "type": "enum", "note": "用户 |组织" },
        { "name": "principal_id", "type": "text", "note": "email (user) or org id (org)" },
        { "name": "role", "type": "enum", "note": "观众|编辑|行政" },
        { "name": "created_by", "type": "text" },
        { "name": "created_at", "type": "text" }
      ]
    }
  ],
  "relations": [
    { "from": "deckShare", "to": "deck", "kind": "n-n", "label": "grants access to" }
  ]
}
```

`server/db/index.ts` 中的一次注册电话：

```ts
import { registerShareableResource } from "@agent-native/core/sharing";

registerShareableResource({
  type: "deck",
  resourceTable: schema.decks,
  sharesTable: schema.deckShares,
  displayName: "Deck",
  titleColumn: "title",
  getResourcePath: (deck) => `/deck/${deck.id}`,
  getDb,
});
```

之后，列表/读取查询通过 `accessFilter()` 传递，写入 actions 使用 `assertAccess()` 来强制执行角色。

### 可选的强化标志 {#hardening-flags}

`registerShareableResource` 接受执行代码或承载提升信任的资源的两个安全标志：

```ts
registerShareableResource({
  type: "extension",
  resourceTable: schema.extensions,
  sharesTable: schema.extensionShares,
  // ...
  allowPublic: false, // Reject set-resource-visibility → "public"
  requireOrgMemberForUserShares: true, // Reject user grants to non-org emails
});
```

`allowPublic: false` 阻止任何调用者（代理或 UI）将资源的可见性设置为 `public`。 `requireOrgMemberForUserShares: true` 拒绝个人用户向资源所有者组织外部的电子邮件地址授予权限。扩展设置了两者：扩展的 HTML 在调用 actions 和 DB 作为 _viewer_ 的 iframe 内运行，因此公共访问将是具有查看者凭据的任意代码。

```an-callout
{
  "tone": "risk",
  "body": "For resources that execute code or carry elevated trust (like extensions), set `allowPublic: false` and `requireOrgMemberForUserShares: true`. Otherwise a public share becomes arbitrary code running with the *viewer's* credentials."
}
```

当代理或其他非 UI 呼叫者创建共享时，`getResourcePath` 会向通知电子邮件提供直接后备链接。完整的模式（包括创建操作所有权标记和现有表的迁移配方）存在于 `sharing` 代理技能中 - 代理在构建共享感知功能时按需读取它。

## 安全保证 {#security}

共享依赖于框架更广泛的数据范围模型 - 对可拥有表的列表/读/写访问通过 `accessFilter()` / `resolveAccess()` / `assertAccess()`，并且 `org_id` 标记的资源在组织中不可见。有关完整管道、CI 防护和威胁面，请参阅 [Security → Data Scoping](/docs/security#data-scoping)。

## 另请参阅 {#see-also}

- [Security & Data Scoping](/docs/security) - 共享所依赖的访问过滤器和所有权模型。
- [Authentication](/docs/authentication) — 会话、组织以及身份如何流入请求上下文。
- [Extensions](/docs/extensions#sharing) — 在沙盒迷你应用表面中共享。
- [Creating Templates](/docs/creating-templates) — 将 `ownableColumns` 连接到新模板的架构中。
