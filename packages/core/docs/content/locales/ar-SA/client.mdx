---
title: "العميل"
description: "الخطافات والأدوات المساعدة React لتطبيقات الوكيل الأصلية: sendToAgentChat، وحالة سياق دردشة الوكيل الاختيارية، وuseDbSync، وuseAgentChatGenerating، وcn."
---

# العميل

يوفر `@agent-native/core` أدوات ربط وأدوات مساعدة React لجانب المتصفح لتطبيقات الوكيل الأصلية.

يتم تصدير هؤلاء العملاء/React API من `@agent-native/core` و`@agent-native/core/client`. قم باستيرادها من `@agent-native/core/client` (إدخال المتصفح) للحصول على الوضوح والتجميع الصحيح، نظرًا لأن جذر `@agent-native/core` المجرد يتحول إلى إنشاء Node افتراضيًا.

بالنسبة للتوجيه المستند إلى الملف - إضافة الصفحات والمعلمات الديناميكية والتنقل - راجع [Routing](/docs/routing).

## جلب البيانات وتغييرها {#fetching-mutating}

الطريقة الأساسية لقراءة بيانات التطبيق وكتابتها من المتصفح هي من خلال خطافات الإجراء. لا تكتب أبدًا مكالمات `fetch` يدويًا إلى مسارات `/_agent-native/*` - استخدم المساعدين المحددين بدلاً من ذلك (راجع [Actions](/docs/actions)).

```an-diagram title="حلقة بيانات المتصفح" summary="خطافات القراءة والكتابة من خلال الإجراءات؛ يراقب useDbSync قاعدة البيانات حتى يقوم الوكيل والخلفية بإعادة جلب نفس ذاكرات التخزين المؤقت تلقائيًا."
{
  "html": "<div class=\"diagram-client\"><div class=\"diagram-col\"><div class=\"diagram-node\">useActionQuery<br><small class=\"diagram-muted\">قراءة مخبأة</small></div><div class=\"diagram-node\">useActionMutation<br><small class=\"diagram-muted\">كتابة + إبطال</small></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&harr;</div><div class=\"diagram-box\" data-rough>Actions<br><small class=\"diagram-muted\">/_agent-native/actions/*</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&harr;</div><div class=\"diagram-panel\" data-rough><strong>SQL قاعدة البيانات</strong></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&#8635;</div><div class=\"diagram-pill ok\">useDbSync &rarr; الإعادة على التغيير</div></div>",
  "css": ".diagram-client{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-client .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-client .diagram-arrow{font-size:22px;line-height:1}"
}
```

```tsx
import {
  useActionQuery,
  useActionMutation,
  callAction,
} from "@agent-native/core/client";

// Read: auto-cached, auto-invalidated on mutations
const { data, isLoading } = useActionQuery("get-lead", { leadId });

// Mutate: emits a change event so query caches refetch
const { mutate, isPending } = useActionMutation("create-lead");
mutate({ name: "Alice", company: "Acme" });

// Imperative: for one-off calls outside a component
await callAction("archive-lead", { leadId });
```

## sendToAgentChat(opts) {#sendtoagentchat}

أرسل رسالة إلى دردشة الوكيل عبر postMessage — الطريقة الشائعة لتفويض مهمة الذكاء الاصطناعي من تفاعل UI. مرر `context` لسياق النموذج المخفي و`submit: true` للإرسال فورًا، أو `submit: false` لملء مسودة مراجعات المستخدم أولاً مسبقًا.

```ts
import { sendToAgentChat } from "@agent-native/core/client";

// Auto-submit a prompt with hidden context
sendToAgentChat({
  message: "Generate alt text for this image",
  context: "Image path: /api/projects/hero.jpg",
  submit: true,
});

// Prefill without submitting (user reviews first)
sendToAgentChat({
  message: "Rewrite this in a conversational tone",
  context: selectedText,
  submit: false,
});
```

داخل تطبيق MCP المضمن الذي تم إنشاؤه باستخدام `embedApp()`، الرسائل المرسلة تلقائيًا
(تم حذف `submit` أو `true`) إلى جسر مضيف تطبيق MCP، والذي
يطلب من المضيف المحتوي إضافة سياق مخفي وإرسال الدور المرئي للمستخدم.
يظل `context` مرئيًا للنموذج دون نشره كدردشة مع المستخدم.
يحتفظ `submit: false` بسلوك التعبئة المسبقة/المراجعة المحلي لأن تطبيقات MCP لا تفعل ذلك
حدد مسودة قياسية للتعبئة المسبقة API. داخليًا، هذا هو مسار الدردشة المرسلة
يظهر أحيانًا كـ `agentNative.submitChat`؛ يجب أن يتصل رمز التطبيق
`sendToAgentChat()` بدلاً من نشر هذا الحدث مباشرةً.

### يتم إرسال الخلفية الصامتة {#background-send}

استخدم `background: true` عندما يؤدي إجراء UI إلى بدء عمل الوكيل الحقيقي بدون
فتح الشريط الجانبي أو التركيز عليه. لا يزال هذا يؤدي إلى إنشاء سلسلة محادثات/تشغيل عادي،
يستخدم أدوات الوكيل/actions/السياق، ويحافظ على إمكانية ملاحظة العمل من خلال
علبة التشغيل؛ إنها ليست دعوة نموذجية خام لمرة واحدة.

```ts
const tabId = sendToAgentChat({
  message: "Analyze this import and create any missing records",
  context: `Import batch id: ${batchId}`,
  submit: true,
  newTab: true,
  background: true,
  openSidebar: false,
});
```

تم تصميم `background` ليتم إقرانه مع `newTab` حتى لا يتم إقران العمل المخفي
الكتابة فوق المحادثة النشطة للمستخدم. استخدم `tabId` الذي تم إرجاعه إذا كان UI
يحتاج إلى ربط حالة المتابعة أو الارتباط العميق بالتشغيل لاحقًا.

### AgentChatMessage {#agentchatmessage}

| الخيار                | اكتب        | الوصف                                                                                    |
| --------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| `message`             | `string`    | تم إرسال المطالبة المرئية إلى الدردشة                                                    |
| `context`             | `string?`   | تم إلحاق السياق المخفي (لا يظهر في الدردشة UI)                                           |
| `submit`              | `boolean?`  | صحيح = إرسال تلقائي، خطأ = تعبئة مسبقة فقط                                               |
| `newTab`              | `boolean?`  | قم بإنشاء سلسلة محادثات منفصلة لهذه المطالبة                                             |
| `background`          | `boolean?`  | باستخدام `newTab`، قم بالتشغيل دون التركيز على علامة التبويب وأظهر التشغيل في `RunsTray` |
| `openSidebar`         | `boolean?`  | قم بتعيين خطأ للإرسال/التعبئة المسبقة دون فتح الشريط الجانبي                             |
| `projectSlug`         | `string?`   | الارتباط الثابت للمشروع الاختياري للسياق المنظم                                          |
| `preset`              | `string?`   | اسم اختياري محدد مسبقًا للمستهلكين النهائيين                                             |
| `referenceImagePaths` | `string[]?` | مسارات الصور المرجعية الاختيارية                                                         |

## حالة سياق محادثة الوكيل (متقدمة) {#agent-chat-context-state}

تُعتبر حالة السياق API عبارة عن توصيلات اختيارية لـ UI والتي تحتاج إلى مزامنة ثنائية الاتجاه مع
شرائح السياق المرحلية: عرض العناصر المرحلية الحالية خارج المؤلف
يعكس ما إذا كان العنصر مرفقًا بالفعل، أو يقدم توضيحًا واضحًا
إزالة/مسح عناصر التحكم.

لا تتواصل مع هؤلاء المساعدين لمجرد "إرسال هذا إلى الوكيل" أو
تدفقات "ملء هذه المسودة مسبقًا للمراجعة". استخدم `sendToAgentChat()` مع `context`
و`submit` لهؤلاء.

| API                               | استخدم عندما                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------ |
| `useAgentChatContext()`           | يحتاج مكون React إلى قائمة السياقات المرحلية المباشرة                          |
| `setAgentChatContextItem(item)`   | يجب أن تقوم التعليمات البرمجية الحتمية بتشغيل أو استبدال عنصر سياق مفتاحي واحد |
| `listAgentChatContext()`          | تحتاج التعليمات البرمجية غير React إلى لقطة واحدة للسياق المرحلي               |
| `removeAgentChatContextItem(key)` | يجب على UI إزالة عنصر سياق مرحلي واحد بواسطة `key` المستقر                     |
| `clearAgentChatContext()`         | يجب أن يقوم UI بمسح كل السياق المرحلي، مثل بعد إعادة ضبط العرض أو الوضع        |
| `refreshAgentChatContext()`       | يجب أن تعيد التعليمات البرمجية الحتمية قراءة أحدث لقطة للسياق المستمر          |

ترجع `useAgentChatContext()` `{ items, set, remove, clear, refresh }`.

## openAgentSettings(القسم؟) {#openagentsettings}

استخدم `openAgentSettings()` عند فتح صفحة إعدادات التطبيق أو بطاقة الإعداد
علامة التبويب إعدادات الشريط الجانبي للوكيل. قم بتمرير معرف قسم مثل `"llm"`، `"secrets"`،
`"automations"` أو `"voice"` أو `"limits"` لفتح قسم معين.

```ts
import { openAgentSettings } from "@agent-native/core/client";

openAgentSettings();
openAgentSettings("secrets");
```

تفضل هذا المساعد على إرسال `agent-panel:open-settings` مباشرة.

```tsx
import { useAgentChatContext } from "@agent-native/core/client";

function SelectionContextButton({ record }: { record: { id: string } }) {
  const chatContext = useAgentChatContext();
  const contextKey = `selected-record:${record.id}`;
  const isAttached = chatContext.items.some((item) => item.key === contextKey);

  return (
    <button
      type="button"
      onClick={() => {
        if (isAttached) {
          chatContext.remove(contextKey);
          return;
        }

        chatContext.set({
          key: contextKey,
          title: "Selected Record",
          context: JSON.stringify(record, null, 2),
          openSidebar: false,
        });
      }}
    >
      {isAttached ? "Remove from prompt context" : "Add to prompt context"}
    </button>
  );
}
```

`listAgentChatContext()` مخصص للتعليمات البرمجية الحتمية التي تحتاج فقط إلى فحص
العناصر المرحلية الحالية مرة واحدة. `clearAgentChatContext()` واسع عمدًا؛ استخدم
`removeAgentChatContextItem(key)` عند تغيير تحديد واحد فقط.

### AgentChatContextSetOptions {#agentchatcontextsetoptions}

| الخيار        | اكتب       | الوصف                                                 |
| ------------- | ---------- | ----------------------------------------------------- |
| `key`         | `string`   | معرف ثابت يستخدم لاستبدال كتلة صلبة موجودة            |
| `title`       | `string`   | تظهر التسمية القصيرة في شريحة الملحن                  |
| `context`     | `string`   | سياق مخفي مضمن في المطالبة التالية التي تم إرسالها    |
| `openSidebar` | `boolean?` | الافتراضيات صحيحة؛ قم بتمرير خطأ إلى سياق المسرح بصمت |

## askUserQuestion(opts) {#ask-user-question}

اطرح على المستخدم سؤالاً متعدد الاختيارات من رمز التطبيق، واجعله مضمنًا في
لوحة الوكلاء، و**انتظر إجابتهم**. إنه التوأم من جانب العميل
أداة `ask-question` المدمجة للوكيل: تكتب `GuidedQuestionPayload` إلى
مفتاح حالة التطبيق `"guided-questions"` (حيث تم تثبيت
يعرضها `GuidedQuestionFlow`) ويكشف عن لوحة الوكيل لذا فإن السؤال هو
مرئية. على عكس أداة الوكيل - التي تتدفق إجابتها مرة أخرى إلى الوكيل -
`askUserQuestion()` **يحل مع الرد على المتصل**، لذلك يمكن لـ UI
فرع عليه.

استخدمه عندما يحتاج UI إلى قرار صغير واحد بالضبط (2-4 خيارات) قبله
يبدأ عمل الوكيل — بدلاً من إنشاء نموذج مخصص. الوصول إلى
مؤلف للتفاصيل الحرة، ونموذج/بوبوفر للإدخال متعدد الحقول.

```tsx
import { askUserQuestion, sendToAgentChat } from "@agent-native/core/client";

const length = await askUserQuestion({
  question: "How long should this deck be?",
  header: "Deck length", // optional short chip/heading (≈12 chars)
  options: [
    { label: "Short (3–5 slides)", value: "short" },
    { label: "Medium (6–10 slides)", value: "medium", recommended: true },
    { label: "Long (11+ slides)", value: "long" },
  ],
  allowFreeText: false, // omit the "Other" free-text option (default adds it)
  allowMultiple: false, // single-select (default)
});

if (length) {
  sendToAgentChat({ message: `Generate a ${length} deck.`, submit: true });
}
```

كل خيار هو `{ label, value?, description?, preview?, recommended? }`؛ `value`
الإعداد الافتراضي هو `label`، ويعرض `preview` نموذجًا صغيرًا/مقتطفًا برمجيًا صغيرًا ضمن
الخيار. يتم حل الوعد باستخدام `value` المحدد (أو `value[]` عندما
`allowMultiple`)، سلسلة النص الحر عندما يختار المستخدم "أخرى"، أو `null`
في حالة التخطي — يظل معلقًا حتى يجيب المستخدم. يتطلب لوحة الوكيل
الذي سيتم تركيبه (موجود في كل قالب).

يصل الوكيل إلى نفس UI من خلال أداة `ask-question` الخاصة به: يفضل السماح لـ
يسأل الوكيل عندما _it_ يضرب شوكة حقيقية لا يمكن حلها من السياق؛ استخدم
`askUserQuestion()` عندما يحتاج _UI_ إلى تنفيذ إجراء على الاختيار.

## MCP جسر مضيف التطبيق {#mcp-app-host-bridge}

يجب أن تكون المسارات المضمنة كتطبيقات MCP هي URL أولاً: قم بتحميل العنصر الحالي من
معلمات المسار/الاستعلام، عرض مسار React الحقيقي أو مكون مشترك مركَّز عليه،
واستخدم الجسر المضيف فقط للسلوك المملوك للمضيف. `@agent-native/core/client`
يصدر استدعاء المسارات المضمنة للمساعدين:

```ts
import {
  getMcpAppHostContext,
  openMcpAppHostLink,
  requestMcpAppDisplayMode,
  updateMcpAppModelContext,
  useMcpAppHostContext,
} from "@agent-native/core/client";
```

يقرأ `getMcpAppHostContext()` أحدث لقطة لسياق المضيف المدفوع؛
يشترك `useMcpAppHostContext()` في تغييرات مكونات React. الطلب
المساعدون (`openMcpAppHostLink`، `requestMcpAppDisplayMode`،
`updateMcpAppModelContext`) بإرجاع `false` خارج إطار تطبيق MCP المضمن، أو
`Promise<boolean>` داخل الإطار. يستخدم `sendToAgentChat()` نفس الجسر لـ
المطالبات المقدمة تلقائيًا من المسارات المضمنة.

الجسر نفسه — رسائل `ui/*` JSON-RPC، `agentNative.mcpHost.*`
ترحيل الغلاف، والزرع مقابل عرض الإطار المتحكم فيه، وسياق المضيف، و
طلبات وضع العرض — مملوكة لـ
[External Agents](/docs/external-agents#mcp-app-bridge).

## الاقتراحات الديناميكية {#dynamic-suggestions}

`<AgentSidebar>` و`<AgentPanel>` و`<AssistantChat>` بدمج `suggestions` الثابت مع الاقتراحات المدركة للسياق بشكل افتراضي. يقرأ إطار العمل `navigation`، و`selection`، و`pending-selection-context`، وURL الحالي من حالة التطبيق بينما تكون الدردشة الفارغة مرئية، ثم يقدم شرائح مطالبة تطابق الشاشة الحالية.

```tsx
<AgentSidebar
  suggestions={["Summarize my inbox"]}
  dynamicSuggestions={{ max: 4 }}
>
  <App />
</AgentSidebar>
```

اضبط `dynamicSuggestions={false}` للاحتفاظ بالرقائق الثابتة فقط. قم بتمرير `getSuggestions` عندما يريد أحد التطبيقات شرائح محددة خاصة بالمجال من نفس سياق حالة التطبيق.

## useAgentChatGenerating() {#useagentchatgenerating}

خطاف React الذي يلتف sendToAgentChat مع تتبع حالة التحميل:

```ts
import { useAgentChatGenerating } from "@agent-native/core/client";

function GenerateButton() {
  const [isGenerating, send] = useAgentChatGenerating();

  return (
    <button
      disabled={isGenerating}
      onClick={() => send({
        message: "Generate a summary",
        context: documentContent,
        submit: true,
      })}
    >
      {isGenerating ? "Generating..." : "Generate"}
    </button>
  );
}
```

يتحول `isGenerating` إلى القيمة true عند استدعاء `send()` ويتم إعادة تعيينه تلقائيًا إلى false عندما ينتهي الوكيل من الإنشاء.

## useDbSync(خيارات؟) {#usedbsync}

خطاف React (`useFileWatcher` سابقًا) الذي يستمع إلى تغييرات قاعدة البيانات عبر SSE، ويعود إلى الاستقصاء، ويبطل ذاكرة التخزين المؤقت لاستعلام إطار العمل التي تحافظ على محاذاة UI مع الوكيل:

```ts
import { useDbSync } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";

function App() {
  const queryClient = useQueryClient();

  useDbSync({
    queryClient,
    pollUrl: "/_agent-native/poll",
    onEvent: (data) => console.log("Data changed:", data),
  });

  return <div>...</div>;
}
```

### الخيارات {#usedbsync-options}

| الخيار             | اكتب               | الوصف                                                                                            |
| ------------------ | ------------------ | ------------------------------------------------------------------------------------------------ |
| `queryClient`      | `QueryClient?`     | عميل استعلام React لإبطال ذاكرة التخزين المؤقت                                                   |
| `queryKeys`        | `string[]?`        | مهمل ومتجاهل؛ تم الاحتفاظ بها لمواقع الاتصال القديمة                                             |
| `pollUrl`          | `string?`          | نقطة نهاية الاستقصاء URL. الافتراضي: `"/_agent-native/poll"`                                     |
| `sseUrl`           | `string \| false?` | SSE endpoint URL. Default: `"/_agent-native/events"`; pass `false` to use polling only           |
| `interval`         | `number?`          | الفاصل الزمني للاستقصاء بالمللي ثانية. الافتراضي: `2000`                                         |
| `fallbackInterval` | `number?`          | الفاصل الزمني للاستقصاء الاحتياطي عند عدم توفر SSE. الافتراضي: `15000`                           |
| `pauseWhenHidden`  | `boolean?`         | إيقاف الاستقصاء مؤقتًا عندما تكون علامة تبويب المتصفح مخفية. الافتراضي: `true`                   |
| `ignoreSource`     | `string?`          | تجاهل مصدر الطلب لكل علامة تبويب حتى لا تتم إعادة جلب علامة التبويب من عمليات الكتابة الخاصة بها |
| `onEvent`          | `(data) => void`   | رد اتصال اختياري عندما يتلقى SSE/استقصاء حدث تغيير                                               |

بالنسبة إلى CRUD العادي، تفضل `useActionQuery` و`useActionMutation`؛ يؤدي تغيير actions إلى إصدار `source: "action"` ويتم إعادة جلب هذه الخطافات تلقائيًا.

## useChangeVersion / useChangeVersions {#use-change-version}

يستخدم إطار العمل إصدارات التغيير لمزامنة ذاكرة التخزين المؤقت للاستعلام React مع التغييرات التي أجراها وكلاء الخلفية، أو مهام cron، أو مستخدمين آخرين.

عند حدوث أي تغيير في قاعدة البيانات من جانب الخادم، يسجل الخادم حدث تغيير باستخدام مفتاح `source` محدد. يتلقى مستمع `useDbSync` الخاص بالعميل هذه الأحداث ويتخطى عداد إصدار التغيير المحلي لهذا المصدر. من خلال طي عداد الإصدار في مفاتيح استعلام React، تتم إعادة جلب الاستعلامات تلقائيًا عندما تقوم الواجهة الخلفية بإعلام العميل بنشاط جديد.

- **`useChangeVersion(source: string): number`** — يُرجع عدادًا يتزايد كلما تم تغيير `source` المحدد.
- **`useChangeVersions(sources: readonly string[]): number`** — يُرجع مجموع عدادات الإصدار لمصادر متعددة.

### مثال: مزامنة استعلام أولي مع قاعدة البيانات

```tsx
import { useQuery } from "@tanstack/react-query";
import { useChangeVersion } from "@agent-native/core/client";

function DashboardView({ id }) {
  // Get version for dashboards domain source
  const v = useChangeVersion("dashboards");

  const { data } = useQuery({
    queryKey: ["dashboard", id, v], // Invalidate automatically when version bumps
    queryFn: () => fetchDashboard(id),
    placeholderData: (prev) => prev, // Prevent layout flicker during refetch
  });

  return <div>{data?.title}</div>;
}
```

### نماذج زمن الاستجابة وسلوك الإبطال

- ** الطفرات التي بدأتها UI:** عند تنفيذ إجراء من UI باستخدام `useActionMutation`، تقوم الطفرة على الفور بإطلاق حدث محلي مع `source: "action"` عند النجاح. يؤدي هذا إلى تشغيل **إعادة جلب فورية ومتفائلة** لجميع مفاتيح الاستعلام اعتمادًا على هذا الإجراء، مع تجنب التأخير البصري.
- **طفرات الخلفية أو الوكيل:** عندما يقوم وكيل الذكاء الاصطناعي أو خطاف الويب أو عامل الخلفية بتغيير البيانات، يتم بث التحديث إلى العميل. يلتقط `useDbSync` الخاص بالعميل هذا إما على الفور عبر SSE (الأحداث المرسلة من الخادم) أو يعود إلى **علامة الاستقصاء التي تبلغ ثانيتين**. ثم يبرز إصدار مفتاح الاستعلام، مما يؤدي إلى إعادة جلب الخلفية.

```an-diagram title="طريقان للإعادة" summary="تؤدي الطفرة المحلية إلى إبطال ذاكرة التخزين المؤقت الخاصة بها على الفور؛ تصل الكتابة عن بعد إلى علامة التبويب هذه عبر SSE، أو علامة الاستقصاء كإجراء احتياطي."
{
  "html": "<div class=\"diagram-latency\"><div class=\"diagram-col\"><div class=\"diagram-card\" data-rough><span class=\"diagram-pill ok\">علامة التبويب هذه</span><strong>useActionMutation</strong><small class=\"diagram-muted\">مصدر الحرائق: \"العمل\" على النجاح &rarr; الاسترداد المحلي الفوري</small></div><div class=\"diagram-card\" data-rough><span class=\"diagram-pill accent\">الوكيل · خطاف الويب · علامة تبويب أخرى</span><strong>الكتابة عن بعد</strong><small class=\"diagram-muted\">دفع SSE، أو علامة الاستقصاء ~2s كبديل &rarr; المطبات الإصدار &rarr; إعادة الخلفية</small></div></div></div>",
  "css": ".diagram-latency .diagram-col{display:flex;flex-direction:column;gap:12px}.diagram-latency .diagram-card{display:flex;flex-direction:column;gap:4px;padding:14px 16px}"
}
```

## cn(...المدخلات) {#cn}

أداة مساعدة لدمج أسماء الفئات (clsx + tailwind-merge):

```ts
import { cn } from "@agent-native/core/client";

<div className={cn(
  "px-4 py-2 rounded",
  isActive && "bg-primary text-primary-foreground",
  className
)} />
```
