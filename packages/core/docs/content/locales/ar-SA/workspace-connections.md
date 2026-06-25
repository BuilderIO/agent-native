---
title: "اتصالات مساحة العمل"
description: "البيانات الوصفية للموفر المشترك والمنح ومراجع بيانات الاعتماد لعمليات تكامل الاتصال مرة واحدة في كل مكان."
---

# اتصالات مساحة العمل

تعد اتصالات مساحة العمل بمثابة الإطار الأساسي لبيانات تعريف التكامل القابلة لإعادة الاستخدام. فهي تجعل "الاتصال مرة واحدة، ومنح التطبيقات، وإعادة استخدام بيانات الاعتماد" أمرًا ممكنًا دون التظاهر بأن كل مقدم خدمة عام بالكامل.

## البدء السريع {#quickstart}

### المفاهيم الأربعة

- **الاتصال** — حساب موفر مسمى (`team-slack`، `acme-hubspot`). معرف موفر السجلات، وتسمية الحساب، والحالة، والنطاقات، والتكوين الآمن. لا تقم مطلقًا بتخزين القيم السرية.
- **منح** — إذن لتطبيق معين لاستخدام الاتصال. لا يمكن للتطبيق الذي ليس لديه منحة رؤية بيانات اعتماد الاتصال.
- **credentialRef** — مؤشر إلى سر المخزن (`{ key: "SLACK_BOT_TOKEN", scope: "org" }`). يشير الاتصال إلى المكان الذي يعيش فيه الرمز المميز؛ القبو يحمل القيمة.
- **الاستعداد** — الحالة المدمجة التي يراها التطبيق: `connected` (تم منحه + وجود بيانات الاعتماد)، أو `needs_grant`، أو `needs_credentials`، أو `needs_attention`، أو `not_configured`.

```an-diagram title="اتصل مرة واحدة، وامنح التطبيقات، وأعد استخدام بيانات الاعتماد" summary="يحتوي الاتصال على بيانات تعريف الموفر (ليست أسرارًا أبدًا) وبيانات الاعتماد التي تشير إلى المخزن. تفتح المنح لكل تطبيق هذه الميزة. تقرأ التطبيقات حالة استعداد واحدة."
{
  "html": "<div class=\"diagram-conn\"><div class=\"diagram-panel col\" data-rough><span class=\"diagram-pill accent\">Connection</span><div class=\"diagram-box\" data-rough>named provider account<br><small class=\"diagram-muted\">provider, label, الحالة، النطاقات، الإعدادات &middot; never stores secret values</small></div><div class=\"diagram-muted\">credentialRef &rarr; pointer to a vault secret</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel col\" data-rough><span class=\"diagram-pill\">Grant</span><div class=\"diagram-box\" data-rough>per-app permission<br><small class=\"diagram-muted\">no grant = no credential access</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel col\" data-rough><span class=\"diagram-pill ok\">Readiness</span><small class=\"diagram-muted\">what the app sees</small><div class=\"sev-row\"><span class=\"diagram-pill ok\">connected</span><span class=\"diagram-pill warn\">needs_grant</span></div><div class=\"sev-row\"><span class=\"diagram-pill warn\">needs_credentials</span><span class=\"diagram-pill warn\">needs_attention</span></div><div class=\"sev-row\"><span class=\"diagram-pill\">not_configured</span></div></div></div>",
  "css": ".diagram-conn{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-conn .col{display:flex;flex-direction:column;gap:8px;padding:14px;min-width:220px}.diagram-conn .diagram-arrow{font-size:22px;line-height:1}.diagram-conn .sev-row{display:flex;gap:8px;flex-wrap:wrap}"
}
```

### مثال عملي: Slack

قم بتوصيل Slack مرة واحدة ومنحه إلى Brain and Analytics:

```ts
import {
  upsertWorkspaceConnection,
  upsertWorkspaceConnectionGrant,
} from "@agent-native/core/workspace-connections";

await upsertWorkspaceConnection({
  id: "acme-slack",
  provider: "slack",
  label: "Acme Slack",
  accountId: "T012345",
  accountLabel: "Acme",
  status: "connected",
  scopes: ["channels:history", "groups:history", "chat:write"],
  config: {
    teamDomain: "acme",
    channelHints: ["product", "dev-fusion", "customer-success"],
  },
  credentialRefs: [{ key: "SLACK_BOT_TOKEN", scope: "org" }],
});

await upsertWorkspaceConnectionGrant({
  connectionId: "acme-slack",
  appId: "brain",
});
await upsertWorkspaceConnectionGrant({
  connectionId: "acme-slack",
  appId: "analytics",
});
```

```an-schema title="نموذج الاتصال" summary="A connection records safe provider metadata and credentialRefs (pointers, not secrets). Each grant unlocks one app — one connection, many grants."
{
  "entities": [
    {
      "id": "conn",
      "name": "workspace_connections",
      "note": "حساب الموفر المسمى. لا تقم أبدًا بتخزين القيم السرية.",
      "fields": [
        { "name": "id", "type": "string", "pk": true, "note": "e.g. acme-slack" },
        { "name": "provider", "type": "string", "note": "معرف الموفر الثابت، على سبيل المثال. الركود" },
        { "name": "label", "type": "string" },
        { "name": "accountId", "type": "string", "nullable": true },
        { "name": "accountLabel", "type": "string", "nullable": true },
        { "name": "status", "type": "string", "note": "e.g. connected" },
        { "name": "scopes", "type": "string[]", "nullable": true },
        { "name": "config", "type": "json", "nullable": true, "note": "تكوين آمن وغير سري" },
        { "name": "credentialRefs", "type": "json", "nullable": true, "note": "pointers to vault keys, e.g. { key, scope }" }
      ]
    },
    {
      "id": "grant",
      "name": "workspace_connection_grants",
      "note": "إذن لكل تطبيق لاستخدام الاتصال.",
      "fields": [
        { "name": "connectionId", "type": "string", "fk": "conn.id" },
        { "name": "appId", "type": "string", "note": "على سبيل المثال. الدماغ والتحليلات" }
      ]
    }
  ],
  "relations": [
    { "from": "conn", "to": "grant", "kind": "1-n", "label": "grants apps" }
  ]
}
```

### ما تسميه التطبيقات

قبل أن تطلب من المستخدم لصق مفتاح جديد، تحقق من الاستعداد أولاً:

```ts
import { listWorkspaceConnectionProviderCatalogForApp } from "@agent-native/core/workspace-connections";

const catalog = await listWorkspaceConnectionProviderCatalogForApp({
  appId: "brain",
  templateUse: "brain",
  provider: "slack",
  includeConnections: "all",
});

const slack = catalog.providers[0];
if (slack.workspaceConnection.grantState === "needs_grant") {
  // Show "Grant Brain access" instead of asking for a second Slack token.
}
if (slack.readiness.status === "needs_credentials") {
  // Show the missing credential ref names, never a secret value.
}
```

## المرجع {#reference}

### كتالوج الموفر

استيراد الكتالوج من `@agent-native/core/connections`:

```ts
import {
  getWorkspaceConnectionProvider,
  listWorkspaceConnectionProvidersForTemplate,
  workspaceConnectionProviderSupports,
} from "@agent-native/core/connections";

const brainProviders = listWorkspaceConnectionProvidersForTemplate("brain");
const slack = getWorkspaceConnectionProvider("slack");

if (workspaceConnectionProviderSupports("slack", "messages")) {
  // Offer a Slack source, sync check, or onboarding step.
}
```

معرفات الموفر الأولية هي:

| المزود         | القدرات                                 | الاستخدامات الشائعة            |
| -------------- | --------------------------------------- | ------------------------------ |
| `slack`        | البحث والاستيراد والرسائل               | العقل، الإرسال، التحليلات      |
| `github`       | البحث والاستيراد والرمز والمستندات      | العقل، التحليلات، الإرسال      |
| `notion`       | بحث، استيراد، مستندات                   | العقل، المحتوى، الإرسال        |
| `gmail`        | البحث والاستيراد والرسائل               | البريد، العقل، الإرسال         |
| `google_drive` | البحث والاستيراد والمستندات             | العقل، المحتوى، الشرائح        |
| `hubspot`      | بحث، استيراد، إدارة علاقات العملاء      | التحليلات والدماغ والبريد      |
| `granola`      | البحث والاستيراد والاجتماعات والمستندات | العقل، التقويم، الإرسال        |
| `clips`        | البحث والاستيراد والاجتماعات            | الدماغ والمقاطع ومقاطع الفيديو |
| `generic`      | البحث والاستيراد والمستندات             | webhooks مخصص وإسقاط الملفات   |

مفاتيح بيانات الاعتماد هي أسماء فقط، مثل `SLACK_BOT_TOKEN` أو `GITHUB_TOKEN`. يجب ألا تتضمن البيانات الوصفية للموفر أبدًا قيم بيانات اعتماد فعلية.

### متجر الاتصال API

```ts
import {
  listWorkspaceConnectionProviderCatalogForApp,
  listWorkspaceConnectionGrants,
  listWorkspaceConnections,
  summarizeWorkspaceConnectionProviderForApp,
  summarizeWorkspaceConnectionProviderReadiness,
  upsertWorkspaceConnection,
  upsertWorkspaceConnectionGrant,
  revokeWorkspaceConnectionGrant,
} from "@agent-native/core/workspace-connections";

const connections = await listWorkspaceConnections({ includeDisabled: true });
const grants = await listWorkspaceConnectionGrants({ appId: "brain" });

const appGrant = summarizeWorkspaceConnectionProviderForApp({
  providerId: "slack",
  appId: "brain",
  connections,
  grants,
});

const readiness = summarizeWorkspaceConnectionProviderReadiness({
  provider: slack!,
  appId: "brain",
  connections,
  grants,
});

const brainCatalog = await listWorkspaceConnectionProviderCatalogForApp({
  appId: "brain",
  templateUse: "brain",
});
```

تشير مجموعة `credentialRefs` إلى مفاتيح الخزنة؛ إنه ليس تخزين بيانات الاعتماد. على سبيل المثال، يخبر `{ key: "SLACK_BOT_TOKEN", scope: "org" }` التطبيق الممنوح بالبحث عن سر المخزن على مستوى المؤسسة المسمى `SLACK_BOT_TOKEN` عندما يحتاج إلى الاتصال بـ Slack. تصف مراجع مستوى الاتصال حساب الموفر؛ يمكن للمراجع على مستوى المنحة تضييق أو تجاوز ما يجب أن يستخدمه تطبيق معين.

يتم تحديد نطاق صفوف الاتصال للمؤسسة النشطة عند وجودها. بدون مؤسسة، يتم تحديد نطاقها للمستخدم المصادق عليه. تستخدم صفوف المنح نفس النطاق.

**حقل `allowedApps` القديم:** `allowedApps: []` يعني أن كل تطبيق في نفس النطاق قد يستخدم الاتصال؛ يمنح `allowedApps: ["dispatch"]` حق الوصول من خلال الحقل القديم. استخدم صفوف `workspace_connection_grants` الواضحة للإعداد الجديد - فهي تجعل عملية الإلغاء والتدقيق والاستعداد لكل تطبيق أسهل. يزيل `revokeWorkspaceConnectionGrant(connectionId, appId)` المنحة الصريحة ولكنه لا يغير `allowedApps` القديم.

استخدم `summarizeWorkspaceConnectionProviderForApp()` و`summarizeWorkspaceConnectionProviderReadiness()` لحالة مواجهة التطبيق بدلاً من فحص المنح اليدوية. تعرض الملخصات المشتركة `grantState`، و`grantAvailability`، وأسماء مرجع بيانات الاعتماد الآمنة، وصفوف الاتصال لكل تطبيق، وحقول الاستعداد مثل `readyConnectionCount` و`missingRequiredCredentialKeys`.

بالنسبة إلى شاشات إعداد التطبيق الجديدة، فضل `listWorkspaceConnectionProviderCatalogForApp()` باعتباره الحد الأعلى مستوى - فهو يجمع بين كتالوج الموفر والاتصالات المحددة والمنح الصريحة وملخصات الوصول لكل تطبيق وجاهزية الموفر في شكل واحد آمن.

### كيف يكمل هذا القبو

يجيب مخزن بيانات الاعتماد على السؤال التالي: "أين يتم تخزين السر، ومن يمكنه الوصول إليه، وما التطبيقات التي تم منحه إياه؟"

تجيب البيانات الوصفية لموفر اتصال مساحة العمل على السؤال التالي: "ما هو هذا الموفر، وما الذي يمكنه فعله، وما هي مفاتيح الاعتماد التي قد يحتاجها، وما هي القوالب التي يجب أن تقدمه؟"

```an-diagram title="مخزن الاتصال مقابل المخزن" summary="يمتلك القبو القيمة السرية. يمتلك الاتصال بيانات تعريف الموفر بالإضافة إلى بيانات الاعتماد (المؤشرات). في وقت التنفيذ، يقوم التطبيق بحل المرجع من خلال اتصال ممنوح ويقرأ القيمة من المخزن."
{
  "html": "<div class=\"diagram-vault\"><div class=\"diagram-panel col\" data-rough><span class=\"diagram-pill accent\">مخزن الاتصالات</span><div class=\"diagram-box\" data-rough>provider account + metadata<br><small class=\"diagram-muted\">الحالة، النطاقات، الإعدادات</small></div><div class=\"diagram-box\" data-rough>credentialRef<br><small class=\"diagram-muted\">{ key: SLACK_BOT_TOKEN, scope: org }</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">إجراء التطبيق</span><small class=\"diagram-muted\">resolves at execution time through a granted ref</small><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&darr;</div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel col\" data-rough><span class=\"diagram-pill ok\">Vault</span><div class=\"diagram-box\" data-rough>secret value<br><small class=\"diagram-muted\">لا تعاد أبدا إلى الوكيل أو الواجهة</small></div></div></div>",
  "css": ".diagram-vault{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-vault .col{display:flex;flex-direction:column;gap:8px;padding:14px;min-width:220px}.diagram-vault .diagram-card{display:flex;flex-direction:column;gap:6px;padding:12px 14px}.diagram-vault .diagram-arrow{font-size:22px;line-height:1}"
}
```

استخدم كلاهما معًا:

1. يقوم الإرسال (أو مسار إعداد مساحة عمل آخر) بإنشاء سر المخزن الأساسي أو مرجع بيانات الاعتماد OAuth.
2. يسجل مخزن اتصال مساحة العمل حساب الموفر وبيانات التعريف الآمنة ومراجع بيانات الاعتماد ومنح التطبيقات.
3. يقرأ كل تطبيق البيانات الوصفية للموفر من الكتالوج وملخصات الاتصال/المنحة من المتجر المشترك.
4. يُظهر التطبيق UI مدى الاستعداد: متصل، أو ممنوح ولكنه غير صحي، أو يحتاج إلى موافقة، أو بيانات اعتماد مفقودة، أو بيانات وصفية فقط.
5. يخزن SQL الخاص بالتطبيق فقط معرفات المصدر والمؤشرات والمرشحات ونوافذ المزامنة وتعريفات المقاييس وقواعد المراجعة واختيارات المستخدم الخاصة بالتطبيق.
6. يحل التطبيق actions بيانات الاعتماد في وقت التنفيذ من خلال مراجع الاتصال الممنوحة والمخزن، ولا يُرجع القيم السرية مطلقًا.

### وقت تشغيل قارئ الموفر

إن طبقة الموفر والقارئ عبارة عن عقد أولاً، وليست وعدًا بأن كل موفر لديه قارئ مباشر مشترك. تصف تعريفات القارئ العمليات المدعومة ومتطلبات بيانات الاعتماد وحالة التنفيذ: `metadata-only` أو `template-owned` أو `shared`. يحل وقت التشغيل مشكلة اتصال مساحة العمل الممنوحة ومراجع بيانات الاعتماد لأحد التطبيقات، ويستدعي معالجًا مسجلاً، ويعيد العناصر التي تمت تسويتها دون الكشف عن القيم السرية.

تظل معظم المعالجات المباشرة مملوكة للنماذج اليوم، مما يعني أن Brain لا يزال يمتلك سلوك العرض Slack/GitHub ولا يزال Analytics يمتلك تفسير التحليلات. قم بترقية القارئ إلى `shared` فقط عندما تكون مكالمات API الخاصة بالموفر، وترقيم الصفحات، والأذونات، ودلالات النتائج قابلة لإعادة الاستخدام فعليًا عبر القوالب.

### نمط جاهزية التطبيق

يجب أن تكشف التطبيقات التي تستهلك بيانات اعتماد الموفر المشترك عن إجراء الاستعداد للقراءة فقط وغطاء سطحي صغير للإعداد:

- **كتالوج الموفر:** معرف الموفر، والتسمية، والإمكانات، واستخدامات القالب الموصى بها، وأسماء مفاتيح الاعتماد المطلوبة من `@agent-native/core/connections`.
- **ملخص مساحة العمل:** عدد الاتصالات، والأعداد النشطة/الممنوحة، وحالة المنح، وأسماء مرجع بيانات الاعتماد، وتسميات الحسابات غير السرية من `@agent-native/core/workspace-connections`.
- **جاهزية الموفر:** `ready` أو `needs_credentials` أو `needs_attention` أو `checking` أو `disabled` أو `not_configured` عبر `summarizeWorkspaceConnectionProviderReadiness()`.
- **حالة المصدر:** المصادر التي تم تكوينها محليًا للتطبيق، والمؤشرات، وحالة المزامنة، والإجراء التالي.

صفحة مصادر الدماغ هي التطبيق المرجعي. ويعرض موفري اتصال مساحة العمل القابلة لإعادة الاستخدام بجانب سجلات مصدر الدماغ، وتمنح التسميات الحالات مثل `connected`، أو `granted`، أو `needs_grant`، أو `not_connected`، وتُظهر صحة الموفر على أنها جاهزة، أو مفاتيح مفقودة، أو المنحة مطلوبة، أو تحتاج إلى إصلاح، أو بيانات التعريف فقط.

### إنشاء موصل قابل لإعادة الاستخدام

متى يجب أن يعمل الموفر الجديد عبر قوالب متعددة:

1. **بيانات تعريف الموفر:** إضافة موفر أو إعادة استخدامه في `@agent-native/core/connections`. هذا هو المعرف الثابت، وتصنيف العرض، وقائمة الإمكانات، واستخدامات النماذج الموصى بها، وأسماء مفاتيح الاعتماد.
2. **اتصال مساحة العمل:** يقوم Dispatch أو أي سطح إعداد آخر لمساحة العمل بتخزين البيانات التعريفية الآمنة للحساب المتصل والحالة والنطاقات و`credentialRefs` ومنح التطبيقات من خلال `@agent-native/core/workspace-connections`.
3. **مصدر التطبيق المحلي:** يخزن تطبيق Brain أو Analytics أو Mail أو تطبيق آخر فقط الاختيارات الخاصة بالتطبيق التي يمتلكها، مثل قنوات Slack أو مستودعات GitHub أو مرشحات الكائنات HubSpot أو مؤشرات المزامنة أو إيقاع الاستقصاء.

لا تقم بتكرار تخزين OAuth/الرمز المميز في كل تطبيق. يقول سجل الاتصال "هذا هو Acme Slack والرمز المميز الخاص به موجود في `SLACK_BOT_TOKEN`"؛ يقول المصدر المحلي للتطبيق "قد يستوعب الدماغ `#product` و`#dev-fusion` من اتصال Slack هذا."

### إعداد طائرة التحكم في الإرسال

يكشف Dispatch عن مستوى التحكم actions الذي يكتب نفس وظائف المتجر المشتركة التي يمكن للتطبيق الاتصال بها مباشرة:

```ts
// templates/dispatch/actions/upsert-workspace-connection.ts delegates to this.
await upsertWorkspaceConnection({
  id: "team-slack",
  provider: "slack",
  label: "Acme Slack",
  accountId: "T012345",
  accountLabel: "acme",
  status: "connected",
  scopes: ["channels:history", "groups:history"],
  config: { teamDomain: "acme", preferredChannels: ["product", "dev-fusion"] },
  credentialRefs: [
    {
      key: "SLACK_BOT_TOKEN",
      scope: "org",
      provider: "slack",
      label: "Slack bot token",
    },
  ],
});

// Then grant the apps that should reuse the provider.
await upsertWorkspaceConnectionGrant({
  connectionId: "team-slack",
  appId: "brain",
});
await upsertWorkspaceConnectionGrant({
  connectionId: "team-slack",
  appId: "analytics",
});
```

استخدم `allowedApps: []` فقط عندما يكون الاتصال متاحًا لكل تطبيق في نفس النطاق. تفضيل صفوف المنح الصريحة لإعداد الإنتاج.

### دقة بيانات الاعتماد

يقوم كود تنفيذ التطبيق بحل قيم بيانات الاعتماد من `credentialRefs` الممنوحة من خلال المخزن في نطاق الطلب النشط. يعد `source-credentials.ts` من Brain بمثابة التنفيذ المرجعي الحالي: فهو يسرد اتصالات مساحة العمل للموفر، ويتحقق من `getWorkspaceConnectionAppAccess` بحثًا عن `appId: "brain"`، ويدمج مراجع بيانات الاعتماد على مستوى الاتصال ومستوى المنح، ويقرأ أول سر قبو محدد النطاق مطابق. يجب أن تتبع التطبيقات الأخرى هذا الشكل بدلاً من الوصول إلى `process.env`.

## ملاحظات التصميم {#design-notes}

<details>
<summary> سياسة ترويج القارئ ومسار "الاتصال مرة واحدة، والاستخدام في كل مكان"</summary>

### الحدود المحلية للتطبيق

الحدود بين الاتصالات المشتركة ومصادر التطبيق المحلية مقصودة. ما يمكن إعادة استخدامه اليوم هو هوية المزود، والتحليل المرجعي لبيانات الاعتماد، والمنح لكل تطبيق، وجاهزية المزود، وبيانات تعريف الحساب الآمن، والعقد الموحد بين المزود والقارئ. ما لم يتم تعميمه بعد هو قراءة معظم الموفر المباشر API، وملكية تدفق OAuth، ومؤشرات الاستيعاب، ومرشحات المصدر، وإيقاع المزامنة، وتفسير المجال. ويظل هؤلاء في التطبيق الذي يمتلك سير العمل ما لم تتم ترقية تنفيذ القارئ بشكل صريح إلى مشترك.

يجب ألا تقرأ موصلات مصدر التطبيق متغيرات البيئة على مستوى النشر كبديل لبيانات اعتماد مصدر المستخدم/المؤسسة. تعتبر Env vars عامة بالنسبة للنشر ولا تعبر عن منح مساحة العمل.

يجب على الوكلاء اتباع قاعدة بسيطة: إذا طلب المستخدم الاتصال بـ Slack أو GitHub أو HubSpot أو Gmail أو Google Drive أو Granola أو موفر مشترك آخر، فافحص كتالوج اتصال مساحة العمل أولاً. إذا كان الموفر هو `connected`، فاستخدمه. إذا كان `needs_grant`، فاطلب منحة التطبيق أو قم بتنفيذها. إذا كان `needs_credentials`، فاطلب مفتاح القبو المفقود. اطلب مفتاحًا أوليًا جديدًا فقط في حالة عدم وجود اتصال قابل لإعادة الاستخدام.

### المسار إلى "الاتصال مرة واحدة، والاستخدام في كل مكان"

يعد كتالوج الموفر ومخزن المنح الأساس لطبقة مساحة عمل أوسع:

- معرفات الموفر المشتركة وأسماء القدرات تحافظ على محاذاة القوالب.
- يمكن أن يُظهر المخزون على مستوى مساحة العمل موفري الخدمة الذين تم تكوينهم عبر Brain، وMail، وAnalytics، وDispatch، والتطبيقات المستقبلية.
- تسجل صفوف الاتصال تسميات الحساب والحالة والتطبيقات المسموح بها ومراجع بيانات الاعتماد وعمليات التحقق من السلامة دون تغيير معرفات الموفر التي تواجه القالب.
- تسمح صفوف المنح لمالك مساحة العمل بالاتصال مرة واحدة، ثم قم بتمكين التطبيقات الفردية عندما تعتمدها مساحة العمل.
- يمكن للوكلاء توجيه العمل عبر التطبيقات لمعرفة مقدمي الخدمة المتصلين بالفعل والتطبيقات التي لديها منح.
- يمكن أن يطلب البحث الموحد موفري خدمات يتمتعون بقدرات `search` أو `docs` أو `messages` أو `meetings` أو `crm` أو `code` بدلاً من الترميز الثابت لقائمة موصلات كل تطبيق.
- يمكن مشاركة القراء الخاصين بموفر الخدمة، وتدفقات التحديث OAuth، ونقاط فحص الاستيعاب، ونماذج البيانات المملوكة للتطبيق لاحقًا، ولكن لا يتم تضمينها في اتصال مساحة العمل اليوم.

حافظ على الحدود صارمة: عرض بيانات تعريف الموفر آمن؛ تبقى قيم بيانات الاعتماد في المخزن.

</details>
