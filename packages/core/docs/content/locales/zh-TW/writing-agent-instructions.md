---
title: "撰寫代理說明和技能"
description: "如何為 Agent-Native 應用或範本編寫出色的代理指令：AGENTS.md、skills 和工具說明。"
---

# 撰寫代理說明和技能

代理在 Agent-Native 應用程式中的行為僅與您給出的說明一樣好。三個表面承載該指導：`AGENTS.md`（地圖）、skills（深入研究）和操作/工具描述（代理如何選取正確的工具）。寫下每一篇都是為了快速檢索，而不是為了散文。

```an-diagram title="三個創作表面 + 一個執行時表面" summary="AGENTS.md 和工具描述每回合都會載入；按需載入技能； application_state 由您的 UI 即時編寫。"
{
  "html": "<div class=\"diagram-surfaces\"><div class=\"diagram-card always\" data-rough><span class=\"diagram-pill accent\">每一輪</span><strong>AGENTS.md</strong><small class=\"diagram-muted\">地圖：用途、核心規則、狀態鍵、action + skills 索引</small></div><div class=\"diagram-card always\" data-rough><span class=\"diagram-pill accent\">每一輪</span><strong>工具描述</strong><small class=\"diagram-muted\">驅動工具選取 — 每個工具一句精確說明</small></div><div class=\"diagram-card ondemand\" data-rough><span class=\"diagram-pill\">按需</span><strong>技能</strong><small class=\"diagram-muted\">深度指南，在描述匹配時載入</small></div><div class=\"diagram-card runtime\" data-rough><span class=\"diagram-pill ok\">Live</span><strong>application_state</strong><small class=\"diagram-muted\">由你的 UI 寫入：導覽、選取、焦點</small></div></div>",
  "css": ".diagram-surfaces{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.diagram-surfaces .diagram-card{display:flex;flex-direction:column;gap:6px;padding:14px 16px}"
}
```

## 保持 AGENTS.md 小且可瀏覽 {#small-agents-md}

`AGENTS.md` 作為方向載入。它應該是讓代理正確行動的最小事物，所有內容都深入到 skills 中。瞄準這些部分而不是其他部分：

- **目的行** — 一句話介紹應用程式是什麼以及主要工作流程。
- **核心規則** - 必須始終保持的少數不變數（SQL 中的資料，操作透過 actions，AI 透過代理聊天，模式更改是附加的）。簡短、指令式的專案符號。
- **應用程式狀態鍵** — 代理讀取 `navigation`/選取/焦點鍵以了解使用者正在檢視的內容及其形狀。
- **操作表** — 操作名稱與目的的緊湊表。
- **技能 索引** — 存在的 skills 清單以及何時讀取每個 skills。

如果一個部分超出了螢幕，那麼它就屬於一項技能。 `AGENTS.md` 回答“這個應用程式是什麼以及我能做什麼”，而不是“我到底如何做困難的事情。”

```markdown
# 專案應用程式

One workspace for projects, tasks, and notes. Agent and UI share the same SQL
data and the same actions.

## 核心規則

- Data lives in 透過 Drizzle 使用 SQL. Use actions for all writes.
- All AI work goes through the agent chat; never call an LLM inline.
- Schema changes are additive only.

## 應用狀態

- `navigation.view`: `home` | `project`
- `navigation.projectId`: selected project on a project page

## 行動

| Action           | Purpose                     |
| ---------------- | --------------------------- |
| `list-projects`  | List accessible projects    |
| `create-project` | Create a project            |
| `update-project` | Rename or archive a project |

## 技能

- `project-imports` — read before importing legacy CSV exports.
- `sharing` — read before exposing a project to other users.
```

## 單來源AGENTS.md {#single-source}

保留一個規範指令檔案：`AGENTS.md`。如果用戶端需要 `CLAUDE.md`，請將其設為 `AGENTS.md` 的符號連結，而不是第二個副本。兩個手工維護的檔案發生了偏差，代理最終得出了相互矛盾的規則。真相的一個來源，在需要的地方連結。

## SKILL.md frontmatter 必須說 AND 時的內容 {#skill-frontmatter}

`description` 是代理在決定是否讀取技能時唯一看到的東西。它必須回答兩個問題：技能涵蓋什麼以及何時觸發它。僅描述主題的描述不會觸發。

```markdown
---
name: project-imports
description: >-
  How to import projects from the legacy CSV export. Use when the user uploads
  a project CSV or asks to migrate projects from the old system.
---
```

- 以功能開頭，然後新增明確的 **“何時使用…”** 子句。
- 稍微咄咄逼人——過度觸發會打敗永遠不會載入的技能。
- 將其控制在約 40 個字以內；它會載入到每次對話的脈絡中。

## 漸進式披露 {#progressive-disclosure}

將 `SKILL.md` 編寫為精益的必知層：規則、如何做、該做/不該做的清單以及指針。將長範例、詳盡的欄位引用、API 怪癖和邊緣情況表推送到 `references/` 檔案中，代理僅在需要時讀取它們。

```text
.agents/skills/project-imports/
├── SKILL.md            # 規則 + 快樂路徑 + do/don't
└── references/
    └── csv-format.md   # 全列規範、編碼、邊緣情況
```

這使始終載入的表面保持較小，並允許深度縮放而不會使脈絡膨脹。完整技能格式請參見 [技能 Guide](/docs/skills-guide)。

## 編寫面向行動的表格 {#action-tables}

代理掃描表格的速度比掃描散文的速度快。優先使用名稱表而不是描述每個操作的段落。這同樣適用於狀態鍵、欄位型別和任何可枚舉集。表格可瀏覽、可比較，並且在新增操作時易於保持同步。

## 編寫清晰的工具說明 {#tool-descriptions}

操作描述是工具描述——它們驅動工具選取。讓每一個句子成為一個精確的、單一目的的句子：

- 說明它的作用和返回什麼，而不是它的實現方式。
- 描述其 `.describe()` 中的每個參數，以便代理正確填寫。
- 每個操作都有一個責任。如果描述需要“而且還……”，請將其拆分。
- 標記唯讀 actions（`readOnly: true` 或 `http: { method: "GET" }`），以便代理知道他們可以安全地自由呼叫。

```ts
defineAction({
  description: "Create a project. Returns the new project id and title.",
  schema: z.object({
    title: z.string().min(1).describe("Project title shown in the sidebar"),
  }),
  // ...
});
```

## 技能 vs actions {#skills-vs-actions}

技能 和 actions 是互補的。技能是代理閱讀的指南；一個
action 是代理可以執行的程式碼。

| 需要                                   | 使用             |
| -------------------------------------- | ---------------- |
| 代理需要遵循工作流程、政策、清單或準則 | **技能**         |
| 代理需要範例、參考資料或特定領域的規則 | **技能**         |
| 代理需要讀取或寫入應用資料             | **操作**         |
| 代理需要呼叫外部 API 或執行核准        | **操作**         |
| 代理以錯誤的方式呼叫正確的操作         | 提高**技能**     |
| 代理無法可靠地呼叫操作                 | 改進**操作**     |
| 代理選取了錯誤的工具                   | 改進**動作描述** |

大多數實際功能都會同時使用這兩種功能：技能解釋如何完成工作，並且
該操作提供型別化操作。例如，`invoice-review`技能
可以解釋審核政策和升級規則，同時`list-invoices`，
`flag-invoice` 和 `approve-invoice` actions 執行實際的讀寫操作。

## 烘焙反加工並在完成前進行驗證 {#anti-fabrication}

應用說明應將誠實和驗證作為預設行為：

- **切勿捏造。**如果未找到資料或操作失敗，請說出來並恢復 - 不要發明結果或聲稱成功。在報告之前透過操作或查詢讀取實際值。
- **在聲明完成之前進行驗證。**更改後，透過讀回確認（重新查詢行，透過 `view-screen` 重新讀取螢幕），而不是假設寫入有效。
- **恢復，不要放棄。** 對於可恢復的錯誤（失敗的查詢、短暫的擷取），重試或修復輸入而不是放棄工作。將其與反捏造規則分開——不要將“不要編造事情”與“在第一個錯誤處停止”混為一談。

將這些作為 `AGENTS.md` 中的核心規則，以便它們適用於每個回合。

## 代理看到的四個表面 {#four-surfaces}

您編寫的每一條指導都會落在四個表面之一上。知道使用哪個表面可以防止重複和錯位細節：

| 表面                    | 誰寫的                   | 載入時                   | 那裡屬於什麼                                    |
| ----------------------- | ------------------------ | ------------------------ | ----------------------------------------------- |
| `AGENTS.md`說明         | 您（開發者）             | 每個回合，作為方向       | 目的、核心規則、狀態鍵、動作索引、skills索引    |
| 技能 (`SKILL.md`)       | 您（開發者）             | 當代理認為技能相關時按需 | 特定模式的逐步操作方法，列出了該做/不該做的事情 |
| 操作描述（工具）        | 您（開發者）             | 每回合，如工具清單       | 操作的作用、返回內容、參數語義                  |
| `application_state`脈絡 | 您的 UI 程式碼（執行時） | 每回合，作為即時應用狀態 | 目前導覽、選取、聚焦物件、URL                   |

**快速診斷：**

- “即使開啟一條紀錄，代理也會不斷詢問要操作哪條紀錄” → 修復：將目前專案 ID 從 UI 寫入 `application_state`（`navigation` 金鑰）。這是 `application_state` 差距，而不是技能差距。
- “代理呼叫了錯誤的操作或誤用了參數”→修復：改進操作在參數上的`description`和`.describe()`。這是工具描述修復，而不是技能。

## 什麼去哪裡 {#what-goes-where}

- **AGENTS.md** — 適用於整個應用程式，每回合：目的、核心規則、狀態鍵、操作索引、skills 索引。
- **技能** — 針對特定模式的可重用操作方法，按需載入。適用於在該應用中工作的每個人。
- **記憶 (`memory/MEMORY.md`)** — 每個使用者的偏好和更正，而非編寫的指導。

## 下一步是什麼 {#whats-next}

- [技能 Guide](/docs/skills-guide) — 技能檔案格式、框架 skills 和應用程式支援的 skills。
- [Creating Templates](/docs/creating-templates) — `AGENTS.md` 和 skills 如何融入可交付範本。
- [The four-area checklist](/docs/key-concepts#four-area-checklist) - 每個特徵都必須滿足的四區域模型。
