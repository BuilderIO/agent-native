---
title: "共用和隱私"
description: "Google Docs 風格的共用，內建於框架中。每個使用者建立的資源（檔案、儀表板、設計、簡報、剪輯、錄音、表單）都會獲得相同的預設私人模型以及一致的共用 UI。"
---

# 共用和隱私

使用者在 Agent-Native 應用程式中建立的每個資源（檔案、儀表板、設計、簡報、影片編輯、螢幕錄製、會議紀錄、表單、預訂連結）**預設情況下對建立者來說是私人的**。僅當建立者明確共用它或將其可見性更改為 `org` 或 `public` 時，其他人才能看到它。

它的外觀和工作方式與 Google 檔案類似。相同的共用按鈕、相同的對話框、相同的三層可見性模型、相同的每使用者/每組織授權 - 跨每個範本，無需針對每個應用進行重新設計。

## 為什麼選取一種模型 {#why}

大多數應用程式框架都會共用每個功能的專案。結果：每個類似檔案的介面最終都會有自己的共用對話框、自己的權限模式、自己的存取檢查錯誤。在 Agent-Native 中，共用是一個**框架原語**。架構列、存取檢查幫助程式、共用快顯視窗和代理可呼叫共用 actions 均隨核心一起提供。新範本透過新增兩欄和一行註冊來獲得完整的分享故事。

這也意味著代理永遠不必為每個應用程式學習新的共用模型。告訴代理在任何範本中“與作為編輯者的 Alice 共用此內容”，並且會觸發相同的 `share-resource` 操作。

## 三個可見性層級 {#visibility}

粗略的可見性取決於資源本身；細粒度的贈款位於同伴共用表中。

| 可見度    | 誰可以看到它                                                              |
| --------- | ------------------------------------------------------------------------- |
| `private` | 所有者+明確授予的人員。 **每個新資源的預設值。**                          |
| `org`     | 所有者+顯式授權+同一組織中的任何人（唯讀）。                              |
| `public`  | 所有者+明確授予+任何知道連結的人（唯讀）。不會出現在其他人的清單/搜尋中。 |

`public` 是一個故意安靜的層級：可以透過直接連結存取公開資源，但它**不會**顯示在其他使用者的側邊欄、清單或搜尋中。這使得“共用 URL 的公開”與“跨使用者發現的公開”分開。真正想要跨使用者發現的畫廊和範本目錄明確選取加入。

```an-diagram title="視野，向外擴大" summary="資源的粗略可見性奠定了基礎；伴隨表中的顯式共用授予會在頂部新增指定人員。"
{
  "html": "<div class=\"share-tiers\"><div class=\"diagram-card\"><span class=\"diagram-pill\">private</span><small class=\"diagram-muted\">owner + explicit grants only &middot; <strong>default</strong></small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill accent\">org</span><small class=\"diagram-muted\">+ anyone in the same org (read-only)</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div><div class=\"diagram-card\"><span class=\"diagram-pill warn\">public</span><small class=\"diagram-muted\">+ anyone with the link (read-only) &middot; hidden from others' lists/search</small></div></div>",
  "css": ".share-tiers{display:flex;flex-direction:column;align-items:stretch;gap:8px}.share-tiers .diagram-card{display:flex;flex-direction:column;gap:4px;padding:12px 16px}.share-tiers .diagram-arrow{text-align:center;font-size:20px;line-height:1}"
}
```

## 股份授予中的角色 {#roles}

當您與特定使用者或組織共用時，您可以選取一個角色：

- **檢視者** — 唯讀。
- **編輯器** — 讀取 + 寫入。
- **管理員** — 讀取+寫入+管理共用（可以新增/刪除其他人）。

`admin` 是否會更改 NOT 的所有權 - 每個資源仍然只有一個所有者，這與共用授予不同。

## 涵蓋內容 {#covered}

每個儲存使用者創作作品的範本都使用此模型。具體來說：

- **內容** — 檔案
- **幻燈片** — 幻燈片
- **設計** — 設計和資產
- **影片** — 作品
- **剪輯** — 螢幕錄製（Loom 風格）
- **表單** — 表單定義
- **行事曆** — 活動和預訂連結
- **分析** - 儀表板（推出 - 請參閱分析範本的 `AGENTS.md`）
- **擴充功能** - 沙盒迷你應用程式（參見 [Extensions](/docs/extensions#sharing)）

其中每一個都使用相同的 `ownableColumns()` 模式助手、相同的 `share-resource` 操作和相同的 `<ShareButton>` UI。從一個範本行動到另一個範本，共用對話框看起來相同。

## 未涵蓋的內容 {#not-covered}

一些區域故意位於共用系統之外：

- **個人資料應用程式**（郵件、宏）- 按設計限定使用者範圍。沒有“共用我的收件箱”概念。
- **外部真實來源應用程式** - 存取控制位於上游系統中，而不是 Agent-Native 應用程式中。
- **匿名公開 URLs** — 向登出使用者公開 URL 的表單發布 slugs 和預訂連結 slugs 是一個單獨的軸。它們與共用系統並存，而不是在其之上。

## 分享 UI {#share-ui}

每個可共用資源的標題中都有一個共用按鈕。點選它會開啟一個錨定到按鈕（不是模式）的快顯視窗，其中包含：

- 可見性選取器（`Private` / `Organization` / `Public link`）。
- “新增人員或團隊”自動完成 - 搜尋組織中的使用者或貼上電子郵件。
- 用於個人電子郵件授權的 Google 檔案樣式 `通知 people` 核取方塊。
- 包含角色選取器和刪除控制項的目前授權清單。
- 尊重目前可見性的複製連結按鈕。

共用按鈕是一次匯入：

```tsx
import { ShareButton } from "@agent-native/core/client";

<ShareButton
  resourceType="deck"
  resourceId={deck.id}
  resourceTitle={deck.title}
/>;
```

對於清單，請在每行旁邊放置一個 `<VisibilityBadge visibility={row.visibility} />`，以便使用者可以一目了然地了解哪些是私人的，哪些是共用的。

## 與 UI 相同型號、代理 {#agent-and-ui}

框架在每個範本中自動安裝這些 actions - 代理將它們稱為工具，UI 透過 `useActionQuery` / `useActionMutation` 呼叫它們：

| 行動                      | 它的作用                                                               |
| ------------------------- | ---------------------------------------------------------------------- |
| `share-resource`          | 授予使用者或組織特定角色的存取權限。可選的 `notify` 控制電子郵件通知。 |
| `unshare-resource`        | 撤銷使用者或組織的存取權限。                                           |
| `list-resource-shares`    | 顯示目前可見性以及所有顯式授權。                                       |
| `set-resource-visibility` | 更改為 `private`、`org` 或 `public`。                                  |

告訴代理“與作為編輯的行銷團隊共用此設計”，它會針對 UI 使用的同一端點呼叫 `share-resource`。結果將顯示在下一次渲染的共用對話框中。

## 將其建置到新範本中 {#building}

如果您正在建立範本（請參閱 [Creating Templates](/docs/creating-templates)），則共用接線會很短。您的架構中新增了兩項內容：

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

```an-schema title="資源+同伴分享表" summary="Coarse visibility lives on the resource; each fine-grained grant is a row in the shares table."
{
  "entities": [
    {
      "id": "deck",
      "name": "decks",
      "note": "...ownableColumns()",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "title", "type": "text", "nullable": false },
        { "name": "owner_email", "type": "text", "nullable": false, "note": "所有權的唯一事實來源。" },
        { "name": "org_id", "type": "text", "nullable": true },
        { "name": "visibility", "type": "enum", "nullable": false, "note": "私人|組織|民眾" }
      ]
    },
    {
      "id": "deckShare",
      "name": "deck_shares",
      "note": "createSharesTable() — one row per grant",
      "fields": [
        { "name": "id", "type": "text", "pk": true },
        { "name": "resource_id", "type": "text", "fk": "decks.id", "nullable": false },
        { "name": "principal_type", "type": "enum", "note": "使用者 |組織" },
        { "name": "principal_id", "type": "text", "note": "email (user) or org id (org)" },
        { "name": "role", "type": "enum", "note": "觀眾|編輯|行政" },
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

`server/db/index.ts` 中的一次註冊電話：

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

之後，清單/讀取查詢透過 `accessFilter()` 傳遞，寫入 actions 使用 `assertAccess()` 來強制執行角色。

### 可選的強化標誌 {#hardening-flags}

`registerShareableResource` 接受執行程式碼或承載提升信任的資源的兩個安全標誌：

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

`allowPublic: false` 阻止任何呼叫者（代理或 UI）將資源的可見性設定為 `public`。 `requireOrgMemberForUserShares: true` 拒絕個人使用者向資源所有者組織外部的電子郵件地址授予權限。擴充功能設定了兩者：擴充功能的 HTML 在呼叫 actions 和 DB 作為 _viewer_ 的 iframe 內執行，因此公開存取將是具有檢視者憑證的任意程式碼。

```an-callout
{
  "tone": "risk",
  "body": "For resources that execute code or carry elevated trust (like extensions), set `allowPublic: false` and `requireOrgMemberForUserShares: true`. Otherwise a public share becomes arbitrary code running with the *viewer's* credentials."
}
```

當代理或其他非 UI 呼叫者建立共用時，`getResourcePath` 會向通知電子郵件提供直接後備連結。完整的模式（包括建立操作所有權標記和現有表的遷移配方）存在於 `sharing` 代理技能中 - 代理在建置共用感知功能時按需讀取它。

## 安全保證 {#security}

共用依賴於框架更廣泛的資料範圍模型 - 對可擁有表的清單/讀/寫存取透過 `accessFilter()` / `resolveAccess()` / `assertAccess()`，並且 `org_id` 標記的資源在組織中不可見。有關完整管道、CI 防護和威脅面，請參閱 [Security → Data Scoping](/docs/security#data-scoping)。

## 另請參閱 {#see-also}

- [Security & Data Scoping](/docs/security) - 共用所依賴的存取過濾器和所有權模型。
- [Authentication](/docs/authentication) — 工作階段、組織以及身分如何流入請求脈絡。
- [Extensions](/docs/extensions#sharing) — 在沙盒迷你應用表面中共用。
- [Creating Templates](/docs/creating-templates) — 將 `ownableColumns` 連線到新範本的架構中。
