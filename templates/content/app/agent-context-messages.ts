import type { BuiltinLocaleCode } from "@agent-native/core/client/i18n";

const en = {
  agentGets: "Agent gets",
  more: "+ {{number}} more",
  openTitle: "What the agent gets with your next message",
  untitled: "Untitled",
  pageAll: "this page, all of it",
  pagePart: "this page, more when needed",
  pageAllDetail:
    "Its title, Description and properties, all of its text, and anything you select.",
  pagePartDetail:
    "Its title, Description and properties, the first {{shown}} of its {{total}} words, and anything you select. It reads the rest when it needs to.",
  pagesAbove_one: "the page it’s in",
  pagesAbove_other: "pages it’s in",
  pagesAboveDetail_one:
    "Its title and Description. Before it drafts or rewrites here, it also reads that page if its text could say how to write here.",
  pagesAboveDetail_other:
    "Their titles and Descriptions. Before it drafts or rewrites here, it also reads the ones whose text could say how to write here.",
  workspace: "Your workspace",
  workspaceMeta: "instructions from your workspace",
  workspaceDetail:
    "Set by your workspace’s admins in Settings › Agent. They go with every message.",
  instructions: "Your instructions",
  instructionsMeta: "from your Settings",
  instructionsDetail:
    "Your instructions in Settings › Agent. They go with all your chats, and nobody else’s.",
  memory: "Your memory",
  memoryMeta: "what it has saved about you",
  memoryDetail:
    "What the agent saved from your earlier chats, such as your name or how you like to write.",
} as const;

type AgentContextMessages = Record<string, string>;

const translations: Record<
  Exclude<BuiltinLocaleCode, "en-US">,
  AgentContextMessages
> = {
  "es-ES": {
    agentGets: "El agente recibe",
    more: "+ {{number}} más",
    openTitle: "Lo que recibe el agente con tu próximo mensaje",
    untitled: "Sin título",
    pageAll: "esta página, entera",
    pagePart: "esta página, más si lo necesita",
    pageAllDetail:
      "Su título, Descripción y propiedades, todo su texto y lo que selecciones.",
    pagePartDetail:
      "Su título, Descripción y propiedades, las primeras {{shown}} de sus {{total}} palabras y lo que selecciones. Lee el resto cuando lo necesita.",
    pagesAbove_one: "la página en la que está",
    pagesAbove_many: "las páginas en las que está",
    pagesAbove_other: "las páginas en las que está",
    pagesAboveDetail_one:
      "Su título y Descripción. Antes de redactar o reescribir aquí, también lee esa página si su texto puede indicar cómo escribir aquí.",
    pagesAboveDetail_many:
      "Sus títulos y Descripciones. Antes de redactar o reescribir aquí, también lee las que pueden indicar cómo escribir aquí.",
    pagesAboveDetail_other:
      "Sus títulos y Descripciones. Antes de redactar o reescribir aquí, también lee las que pueden indicar cómo escribir aquí.",
    workspace: "Tu espacio de trabajo",
    workspaceMeta: "instrucciones de tu espacio de trabajo",
    workspaceDetail:
      "Las fijan los administradores de tu espacio de trabajo en Configuración › Agente. Van con cada mensaje.",
    instructions: "Tus instrucciones",
    instructionsMeta: "de tu Configuración",
    instructionsDetail:
      "Tus instrucciones en Configuración › Agente. Van con todos tus chats, y con los de nadie más.",
    memory: "Tu memoria",
    memoryMeta: "lo que ha guardado sobre ti",
    memoryDetail:
      "Lo que el agente guardó de tus chats anteriores, como tu nombre o cómo te gusta escribir.",
  },
  "fr-FR": {
    agentGets: "L’agent reçoit",
    more: "+ {{number}} autres",
    openTitle: "Ce que l’agent reçoit avec votre prochain message",
    untitled: "Sans titre",
    pageAll: "cette page, en entier",
    pagePart: "cette page, plus si besoin",
    pageAllDetail:
      "Son titre, sa Description et ses propriétés, tout son texte et ce que vous sélectionnez.",
    pagePartDetail:
      "Son titre, sa Description et ses propriétés, les {{shown}} premiers de ses {{total}} mots et ce que vous sélectionnez. Il lit le reste quand il en a besoin.",
    pagesAbove_one: "la page qui la contient",
    pagesAbove_many: "les pages qui la contiennent",
    pagesAbove_other: "les pages qui la contiennent",
    pagesAboveDetail_one:
      "Son titre et sa Description. Avant de rédiger ou de réécrire ici, il lit aussi cette page si son texte peut dire comment écrire ici.",
    pagesAboveDetail_many:
      "Leurs titres et Descriptions. Avant de rédiger ou de réécrire ici, il lit aussi celles dont le texte peut dire comment écrire ici.",
    pagesAboveDetail_other:
      "Leurs titres et Descriptions. Avant de rédiger ou de réécrire ici, il lit aussi celles dont le texte peut dire comment écrire ici.",
    workspace: "Votre espace de travail",
    workspaceMeta: "instructions de votre espace de travail",
    workspaceDetail:
      "Définies par les administrateurs de votre espace de travail dans Paramètres › Agent. Elles accompagnent chaque message.",
    instructions: "Vos instructions",
    instructionsMeta: "de vos Paramètres",
    instructionsDetail:
      "Vos instructions dans Paramètres › Agent. Elles accompagnent toutes vos conversations, et celles de personne d’autre.",
    memory: "Votre mémoire",
    memoryMeta: "ce qu’il a retenu de vous",
    memoryDetail:
      "Ce que l’agent a retenu de vos conversations précédentes, comme votre nom ou votre façon d’écrire.",
  },
  "de-DE": {
    agentGets: "Agent erhält",
    more: "+ {{number}} weitere",
    openTitle: "Was der Agent mit deiner nächsten Nachricht erhält",
    untitled: "Ohne Titel",
    pageAll: "diese Seite, vollständig",
    pagePart: "diese Seite, mehr bei Bedarf",
    pageAllDetail:
      "Ihr Titel, ihre Beschreibung und Eigenschaften, ihr ganzer Text und alles, was du auswählst.",
    pagePartDetail:
      "Ihr Titel, ihre Beschreibung und Eigenschaften, die ersten {{shown}} ihrer {{total}} Wörter und alles, was du auswählst. Den Rest liest er, wenn er ihn braucht.",
    pagesAbove_one: "die Seite, in der sie liegt",
    pagesAbove_other: "Seiten, in denen sie liegt",
    pagesAboveDetail_one:
      "Ihr Titel und ihre Beschreibung. Bevor er hier entwirft oder umschreibt, liest er diese Seite auch, wenn ihr Text sagen könnte, wie man hier schreibt.",
    pagesAboveDetail_other:
      "Ihre Titel und Beschreibungen. Bevor er hier entwirft oder umschreibt, liest er auch die, deren Text sagen könnte, wie man hier schreibt.",
    workspace: "Dein Workspace",
    workspaceMeta: "Anweisungen aus deinem Workspace",
    workspaceDetail:
      "Von den Admins deines Workspace unter Einstellungen › Agent festgelegt. Sie gehen mit jeder Nachricht mit.",
    instructions: "Deine Anweisungen",
    instructionsMeta: "aus deinen Einstellungen",
    instructionsDetail:
      "Deine Anweisungen unter Einstellungen › Agent. Sie gehen mit all deinen Chats mit, und mit niemand anderes.",
    memory: "Dein Gedächtnis",
    memoryMeta: "was er über dich gespeichert hat",
    memoryDetail:
      "Was der Agent aus deinen früheren Chats gespeichert hat, etwa deinen Namen oder wie du gern schreibst.",
  },
  "pt-BR": {
    agentGets: "O agente recebe",
    more: "+ {{number}} mais",
    openTitle: "O que o agente recebe com sua próxima mensagem",
    untitled: "Sem título",
    pageAll: "esta página, inteira",
    pagePart: "esta página, mais quando precisar",
    pageAllDetail:
      "O título, a Descrição e as propriedades, todo o texto e o que você selecionar.",
    pagePartDetail:
      "O título, a Descrição e as propriedades, as primeiras {{shown}} de suas {{total}} palavras e o que você selecionar. Ele lê o resto quando precisa.",
    pagesAbove_one: "a página em que ela está",
    pagesAbove_many: "as páginas em que ela está",
    pagesAbove_other: "as páginas em que ela está",
    pagesAboveDetail_one:
      "O título e a Descrição. Antes de redigir ou reescrever aqui, ele também lê essa página se o texto dela puder dizer como escrever aqui.",
    pagesAboveDetail_many:
      "Os títulos e as Descrições. Antes de redigir ou reescrever aqui, ele também lê as que puderem dizer como escrever aqui.",
    pagesAboveDetail_other:
      "Os títulos e as Descrições. Antes de redigir ou reescrever aqui, ele também lê as que puderem dizer como escrever aqui.",
    workspace: "Seu espaço de trabalho",
    workspaceMeta: "instruções do seu espaço de trabalho",
    workspaceDetail:
      "Definidas pelos administradores do seu espaço de trabalho em Configurações › Agente. Vão com cada mensagem.",
    instructions: "Suas instruções",
    instructionsMeta: "das suas Configurações",
    instructionsDetail:
      "Suas instruções em Configurações › Agente. Vão com todos os seus chats, e com os de mais ninguém.",
    memory: "Sua memória",
    memoryMeta: "o que ele guardou sobre você",
    memoryDetail:
      "O que o agente guardou dos seus chats anteriores, como seu nome ou como você gosta de escrever.",
  },
  "zh-CN": {
    agentGets: "智能体会收到",
    more: "另外 {{number}} 项",
    openTitle: "智能体会随你的下一条消息收到的内容",
    untitled: "无标题",
    pageAll: "此页面的全部内容",
    pagePart: "此页面，需要时读取更多",
    pageAllDetail: "它的标题、描述和属性、全部正文，以及你选中的内容。",
    pagePartDetail:
      "它的标题、描述和属性、全部 {{total}} 个词中的前 {{shown}} 个，以及你选中的内容。需要时它会读取其余部分。",
    pagesAbove_other: "它所在的页面",
    pagesAboveDetail_other:
      "这些页面的标题和描述。在这里起草或改写之前，它还会阅读其中可能说明这里该怎么写的页面。",
    workspace: "你的工作区",
    workspaceMeta: "来自你的工作区的指令",
    workspaceDetail:
      "由你的工作区管理员在“设置 › 智能体”中设定。它们会随每条消息一起发送。",
    instructions: "你的指令",
    instructionsMeta: "来自你的设置",
    instructionsDetail:
      "你在“设置 › 智能体”中的指令。它们会随你的所有聊天一起发送，不会用于其他人。",
    memory: "你的记忆",
    memoryMeta: "它保存的关于你的信息",
    memoryDetail:
      "智能体从你之前的聊天中保存的信息，例如你的名字或你喜欢的写作方式。",
  },
  "zh-TW": {
    agentGets: "代理程式會收到",
    more: "另外 {{number}} 項",
    openTitle: "代理程式會隨你的下一則訊息收到的內容",
    untitled: "未命名",
    pageAll: "此頁面的全部內容",
    pagePart: "此頁面，需要時讀取更多",
    pageAllDetail: "它的標題、描述和屬性、全部內文，以及你選取的內容。",
    pagePartDetail:
      "它的標題、描述和屬性、全部 {{total}} 個字詞中的前 {{shown}} 個，以及你選取的內容。需要時它會讀取其餘部分。",
    pagesAbove_other: "它所在的頁面",
    pagesAboveDetail_other:
      "這些頁面的標題和描述。在這裡起草或改寫之前，它也會閱讀其中可能說明這裡該怎麼寫的頁面。",
    workspace: "你的工作區",
    workspaceMeta: "來自你的工作區的指示",
    workspaceDetail:
      "由你的工作區管理員在「設定 › 代理程式」中設定。它們會隨每則訊息一起送出。",
    instructions: "你的指示",
    instructionsMeta: "來自你的設定",
    instructionsDetail:
      "你在「設定 › 代理程式」中的指示。它們會隨你的所有聊天一起送出，不會用於其他人。",
    memory: "你的記憶",
    memoryMeta: "它儲存的關於你的資訊",
    memoryDetail:
      "代理程式從你先前的聊天中儲存的資訊，例如你的名字或你喜歡的寫作方式。",
  },
  "ja-JP": {
    agentGets: "エージェントが受け取るもの",
    more: "ほか {{number}} 件",
    openTitle: "次のメッセージと一緒にエージェントが受け取るもの",
    untitled: "無題",
    pageAll: "このページ、全文",
    pagePart: "このページ、必要に応じて続きも",
    pageAllDetail:
      "タイトル、説明、プロパティ、本文すべて、そして選択した内容。",
    pagePartDetail:
      "タイトル、説明、プロパティ、全 {{total}} 語のうち最初の {{shown}} 語、そして選択した内容。残りは必要なときに読みます。",
    pagesAbove_other: "このページを含むページ",
    pagesAboveDetail_other:
      "それらのタイトルと説明。ここで下書きや書き直しをする前に、ここでの書き方が書かれていそうなページも読みます。",
    workspace: "あなたのワークスペース",
    workspaceMeta: "ワークスペースの指示",
    workspaceDetail:
      "ワークスペースの管理者が［設定 › エージェント］で設定したものです。すべてのメッセージと一緒に送られます。",
    instructions: "あなたの指示",
    instructionsMeta: "設定から",
    instructionsDetail:
      "［設定 › エージェント］にあるあなたの指示です。あなたのすべてのチャットに送られ、ほかの人のチャットには送られません。",
    memory: "あなたのメモリー",
    memoryMeta: "あなたについて保存した内容",
    memoryDetail:
      "エージェントが以前のチャットから保存した内容です。たとえば、あなたの名前や好みの書き方など。",
  },
  "ko-KR": {
    agentGets: "에이전트가 받는 것",
    more: "외 {{number}}개",
    openTitle: "다음 메시지와 함께 에이전트가 받는 것",
    untitled: "제목 없음",
    pageAll: "이 페이지, 전체",
    pagePart: "이 페이지, 필요할 때 더",
    pageAllDetail: "제목, 설명, 속성, 본문 전체, 그리고 선택한 내용.",
    pagePartDetail:
      "제목, 설명, 속성, 전체 {{total}}단어 중 처음 {{shown}}단어, 그리고 선택한 내용. 나머지는 필요할 때 읽습니다.",
    pagesAbove_other: "이 페이지가 속한 페이지",
    pagesAboveDetail_other:
      "그 페이지들의 제목과 설명. 여기서 초안을 쓰거나 다시 쓰기 전에, 여기서 어떻게 써야 하는지 알려 줄 수 있는 페이지도 읽습니다.",
    workspace: "내 워크스페이스",
    workspaceMeta: "워크스페이스의 지침",
    workspaceDetail:
      "워크스페이스 관리자가 설정 › 에이전트에서 정한 지침입니다. 모든 메시지와 함께 전송됩니다.",
    instructions: "내 지침",
    instructionsMeta: "내 설정에서",
    instructionsDetail:
      "설정 › 에이전트에 있는 내 지침입니다. 내 모든 채팅에 함께 전송되고, 다른 사람의 채팅에는 전송되지 않습니다.",
    memory: "내 메모리",
    memoryMeta: "나에 대해 저장한 내용",
    memoryDetail:
      "에이전트가 이전 채팅에서 저장한 내용입니다. 예를 들어 이름이나 선호하는 글쓰기 방식 등입니다.",
  },
  "hi-IN": {
    agentGets: "एजेंट को मिलता है",
    more: "+ {{number}} और",
    openTitle: "आपके अगले संदेश के साथ एजेंट को क्या मिलता है",
    untitled: "बिना शीर्षक",
    pageAll: "यह पेज, पूरा",
    pagePart: "यह पेज, ज़रूरत पर और",
    pageAllDetail:
      "इसका शीर्षक, विवरण और प्रॉपर्टी, इसका पूरा टेक्स्ट, और जो भी आप चुनें।",
    pagePartDetail:
      "इसका शीर्षक, विवरण और प्रॉपर्टी, इसके {{total}} शब्दों में से पहले {{shown}}, और जो भी आप चुनें। बाकी यह ज़रूरत पड़ने पर पढ़ता है।",
    pagesAbove_one: "वह पेज जिसमें यह है",
    pagesAbove_other: "वे पेज जिनमें यह है",
    pagesAboveDetail_one:
      "उसका शीर्षक और विवरण। यहाँ ड्राफ़्ट करने या दोबारा लिखने से पहले, अगर उस पेज का टेक्स्ट बता सकता है कि यहाँ कैसे लिखना है, तो यह उसे भी पढ़ता है।",
    pagesAboveDetail_other:
      "उनके शीर्षक और विवरण। यहाँ ड्राफ़्ट करने या दोबारा लिखने से पहले, यह उन पेजों को भी पढ़ता है जिनका टेक्स्ट बता सकता है कि यहाँ कैसे लिखना है।",
    workspace: "आपका वर्कस्पेस",
    workspaceMeta: "आपके वर्कस्पेस के निर्देश",
    workspaceDetail:
      "आपके वर्कस्पेस के एडमिन ने सेटिंग › एजेंट में तय किए हैं। ये हर संदेश के साथ जाते हैं।",
    instructions: "आपके निर्देश",
    instructionsMeta: "आपकी सेटिंग से",
    instructionsDetail:
      "सेटिंग › एजेंट में आपके निर्देश। ये आपकी सभी चैट के साथ जाते हैं, किसी और की चैट के साथ नहीं।",
    memory: "आपकी मेमोरी",
    memoryMeta: "इसने आपके बारे में क्या सहेजा है",
    memoryDetail:
      "एजेंट ने आपकी पिछली चैट से जो सहेजा है, जैसे आपका नाम या आपको कैसे लिखना पसंद है।",
  },
  "ar-SA": {
    agentGets: "يتلقى الوكيل",
    more: "+ {{number}} أخرى",
    openTitle: "ما يتلقاه الوكيل مع رسالتك التالية",
    untitled: "بلا عنوان",
    pageAll: "هذه الصفحة كاملة",
    pagePart: "هذه الصفحة، والمزيد عند الحاجة",
    pageAllDetail: "عنوانها ووصفها وخصائصها، ونصها كله، وأي شيء تحدده.",
    pagePartDetail:
      "عنوانها ووصفها وخصائصها، وأول {{shown}} من كلماتها البالغة {{total}}، وأي شيء تحدده. ويقرأ الباقي عندما يحتاج إليه.",
    pagesAbove_zero: "الصفحات التي تضمها",
    pagesAbove_one: "الصفحة التي تضمها",
    pagesAbove_two: "الصفحتان اللتان تضمانها",
    pagesAbove_few: "الصفحات التي تضمها",
    pagesAbove_many: "الصفحات التي تضمها",
    pagesAbove_other: "الصفحات التي تضمها",
    pagesAboveDetail_zero:
      "عناوينها وأوصافها. وقبل أن يكتب مسودة أو يعيد الكتابة هنا، يقرأ أيضًا الصفحات التي قد يوضح نصها كيفية الكتابة هنا.",
    pagesAboveDetail_one:
      "عنوانها ووصفها. وقبل أن يكتب مسودة أو يعيد الكتابة هنا، يقرأ تلك الصفحة أيضًا إذا كان نصها قد يوضح كيفية الكتابة هنا.",
    pagesAboveDetail_two:
      "عنواناهما ووصفاهما. وقبل أن يكتب مسودة أو يعيد الكتابة هنا، يقرأ أيضًا ما قد يوضح نصه كيفية الكتابة هنا.",
    pagesAboveDetail_few:
      "عناوينها وأوصافها. وقبل أن يكتب مسودة أو يعيد الكتابة هنا، يقرأ أيضًا الصفحات التي قد يوضح نصها كيفية الكتابة هنا.",
    pagesAboveDetail_many:
      "عناوينها وأوصافها. وقبل أن يكتب مسودة أو يعيد الكتابة هنا، يقرأ أيضًا الصفحات التي قد يوضح نصها كيفية الكتابة هنا.",
    pagesAboveDetail_other:
      "عناوينها وأوصافها. وقبل أن يكتب مسودة أو يعيد الكتابة هنا، يقرأ أيضًا الصفحات التي قد يوضح نصها كيفية الكتابة هنا.",
    workspace: "مساحة عملك",
    workspaceMeta: "تعليمات من مساحة عملك",
    workspaceDetail:
      "يضبطها مشرفو مساحة عملك في الإعدادات › الوكيل. وتُرسل مع كل رسالة.",
    instructions: "تعليماتك",
    instructionsMeta: "من إعداداتك",
    instructionsDetail:
      "تعليماتك في الإعدادات › الوكيل. تُرسل مع كل محادثاتك، ولا تُرسل مع محادثات أي شخص آخر.",
    memory: "ذاكرتك",
    memoryMeta: "ما حفظه عنك",
    memoryDetail:
      "ما حفظه الوكيل من محادثاتك السابقة، مثل اسمك أو الطريقة التي تحب أن تكتب بها.",
  },
};

export const agentContextMessagesByLocale: Record<
  BuiltinLocaleCode,
  AgentContextMessages
> = {
  "en-US": en,
  ...translations,
};
