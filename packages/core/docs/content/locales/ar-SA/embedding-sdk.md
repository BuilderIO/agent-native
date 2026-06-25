---
title: "تضمين SDK"
description: "قم بتضمين ملف جانبي Agent-Native في تطبيق SaaS موجود مع سياق الصفحة وأوامر المضيف."
---

# تضمين SDK

تضمين Agent-Native في منتج حالي: احتفظ بتطبيق SaaS الخاص بك وأضف طابعًا متينًا
الوكيل الجانبي، والسماح لهذا الوكيل برؤية الصفحة التي ينتمي إليها المستخدم والعمل فيها
تستخدم بالفعل. إذا كنت لا تزال تقرر بين العملاء مقطوعي الرأس، فيمكنك الدردشة الغنية
السيارة الجانبية المضمنة، أو التطبيق الكامل، تبدأ بـ
[Agent Surfaces](/docs/agent-surfaces).

```an-diagram title="غشاء التضمين" summary="يوفر التطبيق المضيف مصادقة من جانب الخادم وسياق الصفحة المباشرة؛ يقوم Agent-Native بتشغيل السيارة الجانبية المتينة ويصل إلى علامة التبويب المفتوحة من خلال إجراءات العميل وأوامر المضيف."
{
  "html": "<div class=\"diagram-embed\"><div class=\"diagram-box\" data-rough><strong>تطبيق SaaS المضيف</strong><small class=\"diagram-muted\">واجهتك ومصادقتك</small></div><div class=\"diagram-col\"><div class=\"diagram-pill accent\">getContext &rarr;</div><div class=\"diagram-pill\">&larr; إجراءات العميل</div><div class=\"diagram-pill\">&larr; أوامر المضيف</div></div><div class=\"diagram-panel center\" data-rough><strong>Agent-Native sidecar</strong><small class=\"diagram-muted\">دردشة دائمة · حالة التطبيق · الإضافات</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>SQL<br><small class=\"diagram-muted\">جداول الإطار</small></div></div>",
  "css": ".diagram-embed{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-embed .diagram-col{display:flex;flex-direction:column;gap:8px}.diagram-embed .diagram-arrow{font-size:22px;line-height:1}.diagram-embed .center{display:flex;flex-direction:column;align-items:center;gap:4px}"
}
```

## ابدأ هنا: المكوّن الإضافي المتضمن بالبطاريات {#batteries-included}

بالنسبة لمعظم مضيفي SaaS، **استخدم وقت التشغيل المضمن الكامل** — المكون الإضافي للخادم
`createAgentNativeEmbeddedPlugin` بالإضافة إلى عميل `<AgentNativeEmbedded>`
المكون. هذا هو الإعداد الافتراضي الموصى به: فهو يعيد استخدام إطار العمل بالكامل
(actions، حالة التطبيق المدعومة SQL، والإضافات، وأدوات جلسة المتصفح) ويعطي
الوكيل القدرة على رؤية الصفحة التي يستخدمها المستخدم بالفعل والعمل عليها.

يقوم المضيف بتوصيل مسارات خادم Agent-Native إلى تطبيقه الحالي، ويمررها
قام المستخدم بتسجيل الدخول إلى Agent-Native، ويعرض الشريط الجانبي React في المنتج UI.
يستخدم Agent-Native نشر المضيف وجلسة المضيف والإعدادات
`DATABASE_URL` لإدارة جداول الإطار الخاصة به: سلاسل المحادثات والإعدادات
حالة التطبيق، والإضافات، وبيانات الإضافات، والأسرار، وجلسات المتصفح، و
طرق العمل.

```bash
pnpm add @agent-native/core
```

على الخادم:

```ts
// server/plugins/agent-native.ts
import { createAgentNativeEmbeddedPlugin } from "@agent-native/core/server";
import { builderActions } from "../agent-native/actions";
import { getBuilderSession } from "../auth";

export default createAgentNativeEmbeddedPlugin({
  databaseUrl: process.env.DATABASE_URL,
  auth: async (event) => {
    const session = await getBuilderSession(event);
    if (!session) return null;
    return {
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name,
      orgId: session.organization.id,
      orgRole: session.organization.role,
    };
  },
  actions: builderActions,
  agentChat: {
    appId: "builder",
    systemPrompt:
      "You are Builder's embedded agent. Use Builder actions for durable work.",
  },
});
```

على العميل:

```tsx
import {
  AgentNativeEmbedded,
  defineClientAction,
} from "@agent-native/core/client";

export function BuilderAppShell({ children, content, editor }) {
  return (
    <AgentNativeEmbedded
      defaultOpen
      session={{
        id: browserTabId(),
        label: "Builder editor",
      }}
      getContext={() => ({
        route: {
          name: "builder-editor",
          pathname: window.location.pathname,
          params: { contentId: content.id },
        },
        resource: {
          type: "content",
          id: content.id,
          name: content.name,
        },
        user: currentUser(),
        organization: currentOrganization(),
      })}
      actions={[
        defineClientAction({
          name: "select-element",
          description: "Select an element in the visual editor",
          schema: {
            type: "object",
            properties: { elementId: { type: "string" } },
            required: ["elementId"],
          },
          run: ({ elementId }) => editor.select(elementId),
        }),
      ]}
      onRefresh={() => queryClient.invalidateQueries()}
      onNavigate={(payload) =>
        router.navigate((payload as { path: string }).path)
      }
      onRemount={() => setAppKey((key) => key + 1)}
    >
      {children}
    </AgentNativeEmbedded>
  );
}
```

هذا الوضع هو الوضع الافتراضي الموصى به لأنه يعيد استخدام الإطار الكامل: يتم تثبيت الواجهة الخلفية actions ضمن `/_agent-native/actions`، ويمكن للوكيل استدعاء نفس actions مثل UI، ويتم تخزين الامتدادات التي أنشأها المستخدم في SQL، و`extensionData` متين ويمكن تحديد نطاقه بواسطة المستخدم/المؤسسة، وتسمح أدوات جلسة المتصفح لوكيل الواجهة الخلفية بفحص أو تشغيل الإطار المفتوح حاليًا علامة التبويب.

مصادقة المضيف هي من جانب الخادم. لا تمرر الهوية من المتصفح كمصدر للحقيقة؛ استخدم كائن الطلب/الجلسة الخاص بالمضيف أو رمزًا مميزًا قصير العمر تم التحقق منه من قبل الخادم. إذا لم يكشف المضيف عن رسائل البريد الإلكتروني، قم بإرجاع `userId` المستقر وسيستخدمه Agent-Native كمفتاح المالك.

### عزل قاعدة البيانات

يدير الوضع المضمن جداول Agent-Native في SQL. بالنسبة لمنتج SaaS الناضج، فإن الإعداد الافتراضي الأكثر أمانًا هو **نفس الاستضافة والمصادقة، وقاعدة بيانات/مخطط Agent-Native المخصص**:

```ts
export default createAgentNativeEmbeddedPlugin({
  databaseUrl: process.env.AGENT_NATIVE_DATABASE_URL,
  auth: getHostSession,
  actions: hostActions,
});
```

يتم دعم استخدام `DATABASE_URL` الرئيسي للمنتج المضيف، ولكن اجعل ذلك اختيارًا صريحًا. يقوم Agent-Native بإنشاء جداول إطارية مثل `settings` و`application_state` و`tools` و`tool_data` وجداول جلسات المتصفح والأسرار وسلاسل الدردشة والفهارس ذات الصلة. يتجنب قاعدة البيانات/المخطط المخصص تضارب أسماء الجدول، ويحافظ على ملكية الجداول المُدارة واضحة، ويجعل سياسة النسخ الاحتياطي/الاحتفاظ أسهل في التفكير. إذا كنت تشارك قاعدة بيانات المضيف عمدًا، فراجع أسماء الجداول الموجودة أولاً وتعامل مع جداول Agent-Native على أنها مملوكة لإطار العمل.

## أوضاع أخرى {#other-modes}

يعد المكون الإضافي المتضمن بالبطاريات أعلاه هو المسار السعيد. يمكنك الوصول إلى أحد هذه
فقط عندما يناسب موقفك بشكل أفضل:

| الوضع                            | استخدمه عندما                                                                                                           | الحزمة                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **منتقي التطبيقات المضمنة**      | إطلاق تطبيق Agent-Native كامل كإطار iframe مركّز (منتقي الأصول، منشئ النماذج، لوحة الموافقة).                           | `@agent-native/embedding`              |
| **الجسر المضيف `<AgentNative>`** | تطبيقات جانبية مستقلة أو إطارات iframe مشتركة الأصل تربط سياق الصفحة والعميل actions يدويًا.                            | `@agent-native/core/client`            |
| **الامتدادات المحمولة**          | السماح للمستخدمين المضيفين بإنشاء تطبيقات صغيرة في وضع الحماية عندما تمتلك SaaS بالفعل مساحة تخزين/موافقة على الامتداد. | فتحة تمديد `@agent-native/core/client` |

تكشف حزمة `@agent-native/embedding` ذات المستوى الأدنى عن:

| مسار الاستيراد                     | ما يقدمه                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `@agent-native/embedding`          | مكون منتقي `EmbeddedApp`، `getA2AUrl`، `getMcpUrl`، `sendMessage` (بث A2A)         |
| `@agent-native/embedding/react`    | الخطافات والمكونات الخاصة بـ React                                                 |
| `@agent-native/embedding/bridge`   | `announceEmbeddedAppReady`، `sendEmbeddedAppMessage` - يُستخدم داخل التطبيق المضمن |
| `@agent-native/embedding/agent`    | مساعدي نقطة النهاية للوكيل                                                         |
| `@agent-native/embedding/protocol` | أنواع البروتوكولات                                                                 |

```bash
pnpm add @agent-native/embedding
```

### التطبيق المضمن ووضع المنتقي

استخدم `@agent-native/embedding` عندما يريد المنتج المضيف تشغيل منتج كامل
تطبيق Agent-Native كسطح iframe مركّز: منتقي الأصول، ومنشئ الأصول،
أداة إنشاء النماذج، أو منتقي فتحات التقويم، أو لوحة الموافقة، أو أي مهمة أخرى خاصة
سير العمل. وهذا أصغر عمدًا من جسر مضيف العربة الجانبية الموجود أدناه:
يعلن iframe عن الاستعداد، ويمكن للمضيف إرسال رسائل مسماة، والمضمنة
يمكن للتطبيق إرسال أحداث النطاق مثل `chooseAsset` أو `close`.

```tsx
import { EmbeddedApp } from "@agent-native/embedding";

export function AssetPickerDialog({ close }) {
  return (
    <EmbeddedApp
      url="https://assets.agent-native.com/picker"
      className="h-full w-full"
      onLoad={(ref) => {
        ref.postMessage("configure", {
          prompt: "Editorial blog hero",
          aspectRatio: "16:9",
        });
      }}
      onMessage={(name, payload) => {
        if (name === "chooseAsset") {
          const asset = payload as { url: string; altText?: string };
          insertAsset(asset.url, asset.altText);
          close();
        }
        if (name === "close") close();
      }}
    />
  );
}
```

داخل التطبيق المضمن، استخدم جسر المتصفح للإعلان عن الاستعداد والإرسال
إرجاع الأحداث إلى المضيف:

```ts
import {
  announceEmbeddedAppReady,
  sendEmbeddedAppMessage,
} from "@agent-native/embedding/bridge";

announceEmbeddedAppReady({ app: "assets", mode: "picker" });
sendEmbeddedAppMessage("chooseAsset", {
  url: asset.previewUrl,
  assetId: asset.id,
  altText: asset.altText,
});
```

تصدر الأصول أيضًا `chooseImage` كاسم مستعار للتوافق لمنتقي الصور الأقدم
المضيفين; يجب أن تستمع عمليات التكامل الجديدة إلى `chooseAsset`.

بالنسبة لتطبيقات الطرف الأول المستضافة، قم بتمكين Cross-App SSO مع Dispatch كهوية
مركز حتى يتمكن `content.agent-native.com` و`assets.agent-native.com` من ربط المستخدمين حسب
بريد إلكتروني تم التحقق منه. يجب أن تستمر عمليات تشغيل Iframe في استخدام قصيرة العمر ومحددة النطاق
تضمين الجلسات عندما يحتاجون إلى مرونة ملفات تعريف الارتباط التابعة لجهات خارجية؛ ملفات تعريف الارتباط العادية للتطبيقات
ليست قصة مصادقة مضمنة كاملة بحد ذاتها.

تتضمن نفس الحزمة مساعدي نقطة النهاية الوكيل لاكتشاف البروتوكول و
تدفق النص عبر A2A:

```ts
import { getA2AUrl, getMcpUrl, sendMessage } from "@agent-native/embedding";

getMcpUrl("https://assets.agent-native.com");
getA2AUrl("https://assets.agent-native.com");

for await (const chunk of sendMessage(
  "https://assets.agent-native.com",
  "Generate a blog hero",
)) {
  append(chunk);
}
```

### التطبيق المضيف (جسر مضيف `<AgentNative>`)

> يُفضل استخدام المكوّن الإضافي المضمن بالبطاريات أعلاه. استخدم هذا الجسر ذي المستوى الأدنى
> فقط للتطبيقات الجانبية المستقلة أو إطارات iframe المشتركة الأصل حيث تقوم بتوصيل الصفحة
> السياق والعميل actions بنفسك.

بالنسبة للتطبيقات الجانبية المستقلة أو إطارات iframe المشتركة الأصل، استخدم `<AgentNative />` ذات المستوى الأدنى. فهو يعرض سياق صفحة iframe الجانبية وwires، والعميل المباشر actions، وأوامر التحديث/التنقل للمضيف في مكان واحد:

```tsx
import { AgentNative, defineClientAction } from "@agent-native/core/client";

export function AssistantDock({ customer, sessionToken }) {
  return (
    <AgentNative
      agentUrl="https://agent.example.com/workspaces/acme/sidecar"
      className="h-full w-full"
      session={{ id: browserTabId(), label: "Customer detail" }}
      auth={() => ({ token: sessionToken })}
      screen={{ includeVisibleText: true }}
      getContext={() => ({
        route: {
          name: "customer-detail",
          pathname: window.location.pathname,
          params: { customerId: customer.id },
        },
        resource: {
          type: "customer",
          id: customer.id,
          name: customer.name,
        },
        selection: {
          ids: getSelectedRowIds(),
          text: window.getSelection()?.toString() || undefined,
        },
        user: currentUser(),
        organization: currentOrganization(),
      })}
      actions={[
        defineClientAction<{ contentId: string }, { published: true }>({
          name: "publish-content",
          description: "Publish a Builder content entry",
          schema: {
            type: "object",
            properties: { contentId: { type: "string" } },
            required: ["contentId"],
          },
          destructive: true,
          approval: { title: "Publish this entry?", risk: "medium" },
          run: async ({ contentId }, { refresh }) => {
            await builderApi.publish(contentId);
            await refresh({ queryKey: ["content", contentId] });
            return { published: true };
          },
        }),
        defineClientAction<{ elementId: string }, void>({
          name: "select-element",
          description: "Select an element in the live visual editor",
          schema: {
            type: "object",
            properties: { elementId: { type: "string" } },
            required: ["elementId"],
          },
          run: ({ elementId }) => editor.select(elementId),
        }),
      ]}
      onNavigate={(payload) => {
        const { path } = payload as { path: string };
        router.navigate(path);
      }}
      onRefresh={(payload) => {
        const { queryKey } = payload as { queryKey?: readonly unknown[] };
        queryClient.invalidateQueries({ queryKey });
      }}
      onRemount={() => setAppKey((key) => key + 1)}
      onOpenResource={(payload) => openResource(payload)}
      onRequestApproval={(payload) => approvalDialog.confirm(payload)}
    />
  );
}
```

استخدم `screen={false}` إذا كنت تريد سياقًا دلاليًا صريحًا فقط. استخدم `screen={{ includeDomHtml: true }}` كبديل للتطبيقات التي لم تقم بعد بتعيين UI الخاصة بها في المعرفات الدلالية وحالة التحديد. يقبل الجسر المضيف فقط الرسائل من أصل `agentUrl` بشكل افتراضي. قم بتمرير `agentOrigin` إذا كان iframe URL هو URL موجه/وكيل ويختلف أصله الموثوق به.

بالنسبة للمضيفين غير React، اتصل بـ `createAgentNativeHostBridge()` مباشرة وقم بتمرير نفس خيارات `getContext` و`actions` و`commands`.

### جانب Iframe

داخل السيارة الجانبية Agent-Native، استخدم مساعدات الإطار لطلب سياق المضيف، أو اكتشاف جلسة المتصفح المباشرة actions، أو تشغيلها، أو مطالبة المضيف بتنفيذ عمل UI. اجتاز دائمًا `hostOrigin` المتوقع في الإنتاج:

```ts
import {
  announceAgentNativeFrameReady,
  createAgentNativeHostTools,
  requestAgentNativeHostActions,
  requestAgentNativeHostContext,
  runAgentNativeHostAction,
  sendAgentNativeHostCommand,
} from "@agent-native/core/client";

announceAgentNativeFrameReady({ hostOrigin: "https://app.example.com" });

const context = await requestAgentNativeHostContext({
  hostOrigin: "https://app.example.com",
});

const liveActions = await requestAgentNativeHostActions({
  hostOrigin: "https://app.example.com",
});

await runAgentNativeHostAction(
  "select-element",
  { elementId: context.selection?.ids?.[0] },
  { hostOrigin: "https://app.example.com" },
);

await sendAgentNativeHostCommand(
  "refreshData",
  { queryKey: ["customer", context.resource?.id] },
  { hostOrigin: "https://app.example.com" },
);

const hostTools = createAgentNativeHostTools({
  hostOrigin: "https://app.example.com",
});
```

### جسر الأدوات الذي يتوسط الخادم

بالنسبة لزميل العمل ذو النمط CLAW، يمكن لإطار iframe أيضًا تسجيل علامة تبويب المتصفح المباشرة الخاصة به مع الواجهة الخلفية الجانبية. يحصل الوكيل بعد ذلك على أدوات الواجهة الخلفية العادية التي تسجل الطلب، ويطالب به إطار iframe، وتنفذه الصفحة المضيفة، وترجع الواجهة الخلفية النتيجة إلى الوكيل.

```an-diagram title="جسر جلسة المتصفح بوساطة الخادم" summary="أداة الواجهة الخلفية تحجز العمل؛ تطالب علامة التبويب المسجلة بها، وتقوم بتشغيلها على الصفحة المباشرة، وتعود النتيجة إلى الوكيل - لذلك لا يزال بإمكان وكيل backend/Slack/A2A لمس علامة التبويب المفتوحة."
{
  "html": "<div class=\"diagram-bridge\"><div class=\"diagram-node\" data-rough>وكيل الخلفية<br><small class=\"diagram-muted\">دردشة · Slack · A2A</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>enqueue request<br><small class=\"diagram-muted\">/_agent-native/browser-sessions</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-node\" data-rough>تتبناه علامة التبويب النشطة<br><small class=\"diagram-muted\">registered bridge</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-pill ok\">result &rarr; agent</div></div>",
  "css": ".diagram-bridge{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-bridge .diagram-arrow{font-size:22px;line-height:1}"
}
```

في تطبيق Sidecar، ابدأ تشغيل جسر جلسة المتصفح مرة واحدة عند تثبيت iframe:

```tsx
import { useEffect } from "react";
import { startAgentNativeBrowserSessionBridge } from "@agent-native/core/client";

export function SidecarRuntime() {
  useEffect(() => {
    const bridge = startAgentNativeBrowserSessionBridge({
      hostOrigin: "https://app.example.com",
      label: "Builder editor",
    });
    return () => bridge.stop();
  }, []);

  return null;
}
```

يقوم إطار العمل بتثبيت `/_agent-native/browser-sessions` تلقائيًا. بمجرد تشغيل الجسر، يمكن للوكيل الجانبي استخدام:

| الأداة                         | الغرض                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `list-browser-sessions`        | راجع علامات تبويب المضيف المتصلة للمستخدم الحالي.                                   |
| `view-browser-session`         | اطلب علامة تبويب مباشرة لسياق الصفحة الحالية ولقطات الشاشة.                         |
| `list-browser-session-actions` | اطلب علامة تبويب مباشرة لبيانات الإجراءات الحالية من جانب العميل.                   |
| `run-browser-session-action`   | قم بتشغيل إجراء عميل حالي واحد من خلال علامة التبويب المباشرة.                      |
| `send-browser-session-command` | اطلب من المضيف التحديث، أو التنقل، أو إعادة التحميل، أو إعادة التحميل، أو الموافقة. |

هذا هو الجسر الذي سيتم استخدامه عند تشغيل الوكيل على الواجهة الخلفية، في Slack/Telegram/email، أو كمتصل A2A ولكنه لا يزال بحاجة إلى لمس علامة تبويب المتصفح الحالية للمستخدم عندما يكون مفتوحًا. إذا كان المتصفح مغلقًا، فيجب أن تستمر الواجهة الخلفية actions في التعامل مع العمل الدائم وستبلغ أدوات جلسة المتصفح عن عدم وجود علامة تبويب نشطة متصلة.

### Actions

هناك فئتان من الإجراءات:

| نوع الإجراء   | مكان تشغيله                                                         | هل يعمل عندما يكون المتصفح مغلقًا؟ | الأفضل لـ                                                                                          |
| ------------- | ------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| إجراء الخلفية | تطبيق Sidecar، أو الواجهة الخلفية API، أو MCP، أو محول التكامل      | نعم                                | عمل دائم مثل الإنشاء والتحديث والنشر والمزامنة والإرسال والاستيراد.                                |
| إجراء العميل  | علامة تبويب المتصفح الحالية من خلال `<AgentNative actions={...} />` | لا                                 | تعمل UI المؤقتة مثل تحديد عنصر، وقراءة حالة المحرر، والتمرير إلى صف، ونسخ حالة لوحة الرسم الحالية. |

يجب أن تكون الواجهة الخلفية actions هي الواجهة الافتراضية لأي شيء يجب أن ينجو من عمليات التحديث أو المتصفحات المغلقة أو إعادة المحاولة أو عمليات التشغيل التي يتم تشغيلها بواسطة التكامل. إنهم ينتمون إلى طبقة الإجراء/الأداة Agent-Native العادية للتطبيق الجانبي، حيث يمكن للوكيل الاتصال بهم من الدردشة والأتمتة وعمليات تكامل Slack/Telegram/البريد الإلكتروني ومهام الخلفية.

يعد العميل actions بمثابة جسر مباشر إلى علامة تبويب متصفح واحدة. يعلن المضيف عنهم باستخدام `source: "client"` و`availability: "browser-session"`، ويجب على العربة الجانبية التعامل مع هذا البيان على أنه مؤقت. أعد إدراج actions عندما يتغير المسار أو التحديد، ثم ارجع إلى الواجهة الخلفية actions عندما تختفي علامة التبويب.

### الامتدادات المحمولة

> قم بتفضيل المكوّن الإضافي المضمن بالبطاريات عندما تريد إدارة Agent-Native
> والموافقة والتخزين والامتدادات التي أنشأها الوكيل. استخدم
> الفتحة المحمولة أدناه فقط عندما تمتلك SaaS هذه المخاوف بالفعل.

يدعم SDK أيضًا الامتدادات المعرفة من قبل المستخدم: تطبيقات Alpine.js الصغيرة ذات وضع الحماية والتي يمكن لمضيف SaaS عرضها في فتحات مسماة. استخدم هذا عندما يريد العميل إنشاء لوحات صغيرة أو آلات حاسبة أو لوحات معلومات أو أدوات مساعدة لسير العمل مقابل نفس سطح الإجراء/السياق الذي يستخدمه الوكيل.

```tsx
import {
  AgentNativeExtensionSlot,
  createHttpAgentNativeExtensionStorage,
  defineClientAction,
} from "@agent-native/core/client";

const storage = createHttpAgentNativeExtensionStorage({
  endpoint: "/api/agent-native/extensions/storage",
  headers: () => ({ Authorization: `Bearer ${sessionToken()}` }),
});

const actions = [
  defineClientAction({
    name: "list-at-risk-customers",
    description: "List customers currently at risk",
    schema: { type: "object", properties: {} },
    run: () => crmApi.customers.list({ status: "at-risk" }),
  }),
];

const customerHealthExtension = {
  id: "customer-health",
  name: "Customer health",
  description: "Shows at-risk customers and quick notes.",
  manifest: {
    slots: ["crm.customer.sidebar"],
    requestedActions: ["list-at-risk-customers"],
    requestedCommands: ["openResource", "refreshData"],
    storageScopes: ["user", "org"],
  },
  content: `
    <div x-data="{
      customers: [],
      note: '',
      async init() {
        this.customers = await appAction('list-at-risk-customers', {})
        const row = await extensionData.get('notes', slotContext.customerId, { scope: 'user' })
        this.note = row?.data?.text || ''
      },
      async save() {
        await extensionData.set('notes', slotContext.customerId, { text: this.note }, { scope: 'user' })
        await agentNative.refresh({ customerId: slotContext.customerId })
      }
    }" x-init="init()" class="space-y-3">
      <textarea class="w-full rounded-md border bg-background p-2" x-model="note"></textarea>
      <button class="rounded-md bg-primary px-3 py-2 text-primary-foreground" @click="save()">Save</button>
    </div>
  `,
};

export function CustomerSidebar({ customer, userExtensions }) {
  return (
    <AgentNativeExtensionSlot
      id="crm.customer.sidebar"
      extensions={[customerHealthExtension, ...userExtensions]}
      context={{ customerId: customer.id, plan: customer.plan }}
      actions={actions}
      storage={storage}
      storageContext={{
        userId: currentUser().id,
        organizationId: currentOrganization().id,
      }}
      getContext={() => ({
        resource: { type: "customer", id: customer.id, name: customer.name },
      })}
      commands={{
        refreshData: async () => queryClient.invalidateQueries(),
      }}
    />
  );
}
```

البيان هو عقد التثبيت. عند وجود `requestedActions` أو `requestedCommands` أو `storageScopes`، يقوم SDK بفرضها في المضيف قبل أن يصل طلب iframe إلى جسر الإجراء أو محول التخزين. عندما يكون `slots` موجودًا، فإن `AgentNativeExtensionSlot` يعرض الامتداد في الفتحات المطابقة فقط. لا يزال بإمكان المضيفين تجاوز السياسة لكل فتحة مع `allowedActions`، و`allowedCommands`، و`allowedStorageScopes`.

الامتداد عادي HTML. يوفر وقت تشغيل iframe نفس أساسيات الجسر الآمن للتطبيق المصغر:

```html
<div
  x-data="{ customers: [], async init() { this.customers = await appAction('list-at-risk-customers', {}) } }"
  x-init="init()"
>
  <template x-for="customer in customers" :key="customer.id">
    <button
      class="block w-full rounded-md px-3 py-2 text-left hover:bg-muted"
      x-text="customer.name"
      @click="agentNative.command('openResource', { type: 'customer', id: customer.id })"
    ></button>
  </template>
</div>
```

العناصر العالمية المتاحة داخل إطار iframe:

| المساعد                        | الغرض                                                        |
| ------------------------------ | ------------------------------------------------------------ |
| `appAction(name, args)`        | قم بتشغيل الإجراء المعلن من قبل المضيف.                      |
| `agentNative.context()`        | قراءة صفحة المضيف الحالية والموارد والفتحة وبيانات المستخدم. |
| `agentNative.command(name, p)` | اطلب من المضيف التنقل أو التحديث أو إعادة التحميل أو الفتح.  |
| `agentNative.refresh(payload)` | اختصار لـ `refreshData`.                                     |
| `extensionData.*`              | استمرار بيانات الامتداد المحلية من خلال المحول المضيف.       |

افتراضيًا، يستخدم `extensionData` المتصفح `localStorage`، وهو مفيد للنماذج الأولية والأدوات المحلية. يجب أن يمرر مضيفو SaaS للإنتاج محول `storage` مدعوم من الواجهة الخلفية بحيث تكون بيانات الامتداد الخاصة بالمستخدم والمؤسسة متينة وقابلة للتدقيق وتحكمها أذونات التطبيق. يرسل محول HTTP العام أجسام POST مثل `{ operation, extensionId, slotId, collection, id, data, options, context }` ويتوقع إما `{ result }` أو النتيجة JSON مباشرة.

طبقة SDK المحمولة هذه منفصلة عن مخزن الملحقات المدمج والمدعوم بـ SQL في إطار العمل. في تطبيق Agent-Native، استخدم مكونات `ExtensionSlot`/`EmbeddedExtension` الحالية والإجراء `create-extension`. في سيناريو تضمين SaaS المستضاف، تفضل `createAgentNativeEmbeddedPlugin()` بالإضافة إلى `AgentNativeEmbedded` عندما تريد أن يقوم Agent-Native بإدارة تعريفات الامتدادات والموافقة والتخزين والامتدادات التي أنشأها الوكيل خارج الصندوق. استخدم `AgentNativeExtensionSlot` فقط عندما تمتلك SaaS بالفعل تعريفات الامتداد والموافقة والسوق والتخزين والفوترة.

نموذج الأمان:

- تم وضع إطارات iframe الملحقة في وضع الحماية بدون `allow-same-origin`؛ لا يمكن للتطبيق المصغر قراءة DOM الأصلي أو ملفات تعريف الارتباط أو وقت تشغيل التطبيق مباشرةً.
- لا يمكن للملحقات سوى استدعاء actions والأوامر التي يسمح بها المضيف وبيان الامتداد.
- يجب على actions المحفوف بالمخاطر تعيين `destructive` أو `requiresApproval` حتى يتمكن المضيف من إظهار تدفق الموافقة.
- تعامل مع الامتداد الذي كتبه المستخدم HTML على أنه غير موثوق به. راجع عمليات تثبيت السوق، واستخدام إجراء السجل، ونطاق التخزين الخلفي بواسطة المستخدم/المؤسسة.

### الجلسات وعلامات التبويب

يتم تحديد نطاق الجسر المضيف ليشمل زوجًا واحدًا من iframe/host-window. إذا قام نفس المستخدم بفتح علامات تبويب متعددة، فإن كل علامة تبويب لها `session` والسياق والتحديد والعميل actions واستجابات الأوامر المعلقة. لا تفترض أن إجراء العميل الذي تم اكتشافه في إحدى علامات التبويب يمكن تشغيله في علامة تبويب أخرى، أو أنه سيظل موجودًا بعد التنقل.

بالنسبة للمنتجات متعددة علامات التبويب، احتفظ بالحالة الدائمة في SQL/الواجهة الخلفية actions واستخدم العميل actions فقط للأجزاء المحلية لعلامات التبويب: تركيز صف، أو نسخ حالة المحرر المرئية، أو تحديد عنصر قماش، أو تحديث ذاكرة التخزين المؤقت للاستعلام React الحالية. قم بتضمين ما يكفي من سياق `route` و`resource` و`selection` للعربة الجانبية لتحديد ما إذا كانت علامة التبويب الحالية هي المكان المناسب لتشغيل إجراء جلسة المتصفح.

### نموذج الأمر

أسماء الأوامر المضمنة تكون على شكل تطبيق، وليس على شكل قاعدة بيانات:

| الأمر                                  | الغرض                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `navigate`                             | نقل المضيف UI إلى المسار/العرض/المورد.                                       |
| `refreshData` / `refresh-data`         | اطلب من المضيف إبطال البيانات من جانب العميل.                                |
| `remountView` / `remount-view`         | اطلب من المضيف إعادة تحميل شجرة فرعية، على سبيل المثال. `<App key={key} />`. |
| `hardReload` / `hard-reload`           | إعادة تحميل المتصفح بالكامل.                                                 |
| `openResource` / `open-resource`       | افتح كائن مجال محدد في المضيف UI.                                            |
| `requestApproval` / `request-approval` | اطلب من المضيف إظهار تدفق التأكيد. قم بتسجيل معالج لهذا.                     |

إذا لم يتم توفير معالج، تقوم الإعدادات الافتراضية الآمنة بإرسال أحداث المتصفح مثل `agentNative:refresh-data` و`agentNative:remount-view`. `requestApproval` ليس لديه معالج افتراضي؛ سجل واحدة قبل الاعتماد عليها.

### إرشادات الموافقة

ضع علامة على العميل الخطير actions باستخدام `destructive: true` في البيان الخاص به واطلب موافقة المضيف قبل تشغيل العمليات التي تحذف أو تنشر أو ترسل أو تفرض رسومًا أو تدعو أو تشارك أو تؤثر بطريقة أخرى على المستخدمين خارج العرض الحالي. يجب على الواجهة الخلفية actions فرض عمليات التحقق من التفويض والموافقة الخاصة بها أيضًا؛ تعد موافقة المضيف بمثابة تجربة مستخدم مفيدة، وليست حدودًا أمنية.

تفضل هذا الشكل:

- يتم تشغيل الطفرة الدائمة في إجراء الواجهة الخلفية مع التحقق من الصحة والمصادقة وتسجيل التدقيق وإعادة المحاولة.
- يفتح أمر المضيف موافقة UI أو يركز على المورد المتأثر.
- يتعامل إجراء العميل فقط مع خطوة UI المباشرة التي لا يمكن حدوثها على الواجهة الخلفية.

### تكامل وقت التشغيل

استخدم `createAgentNativeHostTools()` داخل إطار iframe الجانبي عندما يقبل وقت تشغيل الوكيل الخاص بك واصفات الأداة العادية. تقوم بإرجاع أربع أدوات غير محددة لإطار العمل:

| الأداة              | الغرض                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| `view-host-screen`  | اقرأ سياق المضيف الدلالي ولقطات الشاشة.                                       |
| `list-host-actions` | سرد جلسة المتصفح المباشرة actions التي تم عرضها بواسطة علامة التبويب الحالية. |
| `run-host-action`   | قم بتشغيل إجراء عميل مباشر واحد بالاسم.                                       |
| `send-host-command` | أرسل أوامر المضيف مثل التحديث أو التنقل أو إعادة التحميل أو الموافقة.         |

يقوم المساعد عن عمد بإرجاع كائنات `{ name, description, parameters, execute }` العادية حتى تتمكن السيارات الجانبية من تكييفها مع استدعاء الوظائف AI SDK أو Anthropic أو OpenAI أو شكل Agent-Native `ActionEntry` دون اقتران SDK بوقت تشغيل واحد.

## شكل المنتج الموصى به

بدء تشغيل iframe أولاً. وهو يعمل مع Builder.io وتطبيقات SaaS للعملاء وأدوات الإدارة الداخلية دون اقتران دورات الإصدار أو افتراضات CSS/وقت التشغيل.

يجب أن تظل السيارة الجانبية نفسها عبارة عن تطبيق/قالب Agent-Native: actions هي سطح API الخلفي، وحالة التطبيق المدعومة من SQL هي ذاكرة الوكيل، ويمكن لعمليات التكامل مثل Slack أو Telegram التوجيه إلى نفس الدردشة الدائمة. يوفر تضمين SDK الغشاء المباشر بين تلك السيارة الجانبية وصفحة المضيف الحالية.
