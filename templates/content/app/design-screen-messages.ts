import type { BuiltinLocaleCode } from "@agent-native/core/client/i18n";

const en = {
  openInDesign: "Open in Design",
  design: "{{design}} design",
  width: "{{width}} px wide",
  pinnedOn: "Pinned {{date}}",
  pinnedOnBy: "Pinned {{date}} by {{name}}",
  refresh: "Refresh",
  refreshing: "Refreshing…",
  refreshed: "Screen refreshed",
  refreshFailed: "This screen didn't refresh.",
  changed: "This screen changed in Design after this picture was taken.",
  changedRefresh:
    "This screen changed in Design after this picture was taken. Refresh to update it.",
  screenGone:
    "This screen no longer exists in Design. This picture shows it as it was.",
  openCommentsOne: "1 open comment",
  openComments: "{{count}} open comments",
  imageFailed: "This screen's picture didn't load.",
  unreadable: "This screen's saved picture can't be read, so it isn't shown.",
  adding: "Pinning the screen from Design…",
  added: "Screen pinned",
  addFailed: "This screen couldn't be pinned.",
  confirmWider:
    "More people can open this page than the {{design}} design. Everyone who can open the page will see this screen.",
  addAnyway: "Pin screen",
  keepLink: "Keep the link",
  shareDetailUnread:
    "This page has Design screens not yet checked against their designs. Everyone who can open the page will see them.",
  shareDetailOne:
    "This page has a screen from a design fewer people can open ({{designs}}). Everyone who can open the page will see it.",
  shareDetail:
    "This page has {{count}} screens from designs fewer people can open ({{designs}}). Everyone who can open the page will see them.",
  shareDetailSubPagesUnread:
    "Sub-pages going public with this page haven't been checked for Design screens yet. Anyone with the link will see any screens in them.",
  shareDetailSubPagesOne:
    "A sub-page going public with this page has a screen from a design fewer people can open ({{designs}}). Anyone with the link will see it.",
  shareDetailSubPages:
    "Sub-pages going public with this page have {{count}} screens from designs fewer people can open ({{designs}}). Anyone with the link will see them.",
} as const;

type DesignScreenMessages = Record<keyof typeof en, string>;

const translations: Record<
  Exclude<BuiltinLocaleCode, "en-US">,
  DesignScreenMessages
> = {
  "es-ES": {
    openInDesign: "Abrir en Design",
    design: "Diseño {{design}}",
    width: "{{width}} px de ancho",
    pinnedOn: "Fijada el {{date}}",
    pinnedOnBy: "Fijada el {{date}} por {{name}}",
    refresh: "Actualizar",
    refreshing: "Actualizando…",
    refreshed: "Pantalla actualizada",
    refreshFailed: "Esta pantalla no se actualizó.",
    changed: "Esta pantalla cambió en Design después de tomar esta imagen.",
    changedRefresh:
      "Esta pantalla cambió en Design después de tomar esta imagen. Actualízala para ponerla al día.",
    screenGone:
      "Esta pantalla ya no existe en Design. Esta imagen la muestra como era.",
    openCommentsOne: "1 comentario abierto",
    openComments: "{{count}} comentarios abiertos",
    imageFailed: "La imagen de esta pantalla no se cargó.",
    unreadable:
      "La imagen guardada de esta pantalla no se puede leer, así que no se muestra.",
    adding: "Fijando la pantalla desde Design…",
    added: "Pantalla fijada",
    addFailed: "No se pudo fijar esta pantalla.",
    confirmWider:
      "Más personas pueden abrir esta página que el diseño {{design}}. Todos los que puedan abrir la página verán esta pantalla.",
    addAnyway: "Fijar pantalla",
    keepLink: "Mantener el enlace",
    shareDetailUnread:
      "Esta página tiene pantallas de Design que aún no se han comparado con sus diseños. Todos los que puedan abrir la página las verán.",
    shareDetailOne:
      "Esta página tiene una pantalla de un diseño que pueden abrir menos personas ({{designs}}). Todos los que puedan abrir la página la verán.",
    shareDetail:
      "Esta página tiene {{count}} pantallas de diseños que pueden abrir menos personas ({{designs}}). Todos los que puedan abrir la página las verán.",
    shareDetailSubPagesUnread:
      "Aún no se han revisado las subpáginas que se harán públicas con esta página en busca de pantallas de Design. Cualquiera con el enlace verá las pantallas que contengan.",
    shareDetailSubPagesOne:
      "Una subpágina que se hará pública con esta página tiene una pantalla de un diseño que pueden abrir menos personas ({{designs}}). Cualquiera con el enlace la verá.",
    shareDetailSubPages:
      "Las subpáginas que se harán públicas con esta página tienen {{count}} pantallas de diseños que pueden abrir menos personas ({{designs}}). Cualquiera con el enlace las verá.",
  },
  "fr-FR": {
    openInDesign: "Ouvrir dans Design",
    design: "Design {{design}}",
    width: "{{width}} px de large",
    pinnedOn: "Épinglé le {{date}}",
    pinnedOnBy: "Épinglé le {{date}} par {{name}}",
    refresh: "Actualiser",
    refreshing: "Actualisation…",
    refreshed: "Écran actualisé",
    refreshFailed: "Cet écran ne s'est pas actualisé.",
    changed: "Cet écran a changé dans Design après la prise de cette image.",
    changedRefresh:
      "Cet écran a changé dans Design après la prise de cette image. Actualisez-le pour le mettre à jour.",
    screenGone:
      "Cet écran n'existe plus dans Design. Cette image le montre tel qu'il était.",
    openCommentsOne: "1 commentaire ouvert",
    openComments: "{{count}} commentaires ouverts",
    imageFailed: "L'image de cet écran ne s'est pas chargée.",
    unreadable:
      "L'image enregistrée de cet écran est illisible, elle n'est donc pas affichée.",
    adding: "Épinglage de l'écran depuis Design…",
    added: "Écran épinglé",
    addFailed: "Impossible d'épingler cet écran.",
    confirmWider:
      "Plus de personnes peuvent ouvrir cette page que le design {{design}}. Toute personne pouvant ouvrir la page verra cet écran.",
    addAnyway: "Épingler l'écran",
    keepLink: "Garder le lien",
    shareDetailUnread:
      "Cette page contient des écrans Design pas encore comparés à leurs designs. Toute personne pouvant ouvrir la page les verra.",
    shareDetailOne:
      "Cette page contient un écran d'un design que moins de personnes peuvent ouvrir ({{designs}}). Toute personne pouvant ouvrir la page le verra.",
    shareDetail:
      "Cette page contient {{count}} écrans de designs que moins de personnes peuvent ouvrir ({{designs}}). Toute personne pouvant ouvrir la page les verra.",
    shareDetailSubPagesUnread:
      "Les sous-pages qui deviennent publiques avec cette page n'ont pas encore été vérifiées pour les écrans Design. Toute personne disposant du lien verra les écrans qu'elles contiennent.",
    shareDetailSubPagesOne:
      "Une sous-page qui devient publique avec cette page contient un écran d'un design que moins de personnes peuvent ouvrir ({{designs}}). Toute personne disposant du lien le verra.",
    shareDetailSubPages:
      "Les sous-pages qui deviennent publiques avec cette page contiennent {{count}} écrans de designs que moins de personnes peuvent ouvrir ({{designs}}). Toute personne disposant du lien les verra.",
  },
  "de-DE": {
    openInDesign: "In Design öffnen",
    design: "Design {{design}}",
    width: "{{width}} px breit",
    pinnedOn: "Angeheftet am {{date}}",
    pinnedOnBy: "Angeheftet am {{date}} von {{name}}",
    refresh: "Aktualisieren",
    refreshing: "Wird aktualisiert…",
    refreshed: "Screen aktualisiert",
    refreshFailed: "Dieser Screen wurde nicht aktualisiert.",
    changed:
      "Dieser Screen wurde in Design geändert, nachdem dieses Bild aufgenommen wurde.",
    changedRefresh:
      "Dieser Screen wurde in Design geändert, nachdem dieses Bild aufgenommen wurde. Aktualisiere ihn, um ihn auf den neuesten Stand zu bringen.",
    screenGone:
      "Dieser Screen existiert in Design nicht mehr. Dieses Bild zeigt ihn, wie er war.",
    openCommentsOne: "1 offener Kommentar",
    openComments: "{{count}} offene Kommentare",
    imageFailed: "Das Bild dieses Screens wurde nicht geladen.",
    unreadable:
      "Das gespeicherte Bild dieses Screens kann nicht gelesen werden und wird daher nicht angezeigt.",
    adding: "Screen aus Design wird angeheftet…",
    added: "Screen angeheftet",
    addFailed: "Dieser Screen konnte nicht angeheftet werden.",
    confirmWider:
      "Mehr Personen können diese Seite öffnen als das Design {{design}}. Alle, die die Seite öffnen können, sehen diesen Screen.",
    addAnyway: "Screen anheften",
    keepLink: "Link behalten",
    shareDetailUnread:
      "Diese Seite enthält Design-Screens, die noch nicht mit ihren Designs abgeglichen wurden. Alle, die die Seite öffnen können, sehen sie.",
    shareDetailOne:
      "Diese Seite enthält einen Screen aus einem Design, das weniger Personen öffnen können ({{designs}}). Alle, die die Seite öffnen können, sehen ihn.",
    shareDetail:
      "Diese Seite enthält {{count}} Screens aus Designs, die weniger Personen öffnen können ({{designs}}). Alle, die die Seite öffnen können, sehen sie.",
    shareDetailSubPagesUnread:
      "Unterseiten, die mit dieser Seite öffentlich werden, wurden noch nicht auf Design-Screens geprüft. Alle mit dem Link sehen die Screens darin.",
    shareDetailSubPagesOne:
      "Eine Unterseite, die mit dieser Seite öffentlich wird, enthält einen Screen aus einem Design, das weniger Personen öffnen können ({{designs}}). Alle mit dem Link sehen ihn.",
    shareDetailSubPages:
      "Unterseiten, die mit dieser Seite öffentlich werden, enthalten {{count}} Screens aus Designs, die weniger Personen öffnen können ({{designs}}). Alle mit dem Link sehen sie.",
  },
  "pt-BR": {
    openInDesign: "Abrir no Design",
    design: "Design {{design}}",
    width: "{{width}} px de largura",
    pinnedOn: "Fixada em {{date}}",
    pinnedOnBy: "Fixada em {{date}} por {{name}}",
    refresh: "Atualizar",
    refreshing: "Atualizando…",
    refreshed: "Tela atualizada",
    refreshFailed: "Esta tela não foi atualizada.",
    changed: "Esta tela mudou no Design depois que esta imagem foi feita.",
    changedRefresh:
      "Esta tela mudou no Design depois que esta imagem foi feita. Atualize para deixá-la em dia.",
    screenGone:
      "Esta tela não existe mais no Design. Esta imagem a mostra como era.",
    openCommentsOne: "1 comentário aberto",
    openComments: "{{count}} comentários abertos",
    imageFailed: "A imagem desta tela não carregou.",
    unreadable:
      "A imagem salva desta tela não pode ser lida, por isso não é exibida.",
    adding: "Fixando a tela do Design…",
    added: "Tela fixada",
    addFailed: "Não foi possível fixar esta tela.",
    confirmWider:
      "Mais pessoas podem abrir esta página do que o design {{design}}. Todos que podem abrir a página verão esta tela.",
    addAnyway: "Fixar tela",
    keepLink: "Manter o link",
    shareDetailUnread:
      "Esta página tem telas do Design ainda não comparadas com seus designs. Todos que podem abrir a página as verão.",
    shareDetailOne:
      "Esta página tem uma tela de um design que menos pessoas podem abrir ({{designs}}). Todos que podem abrir a página a verão.",
    shareDetail:
      "Esta página tem {{count}} telas de designs que menos pessoas podem abrir ({{designs}}). Todos que podem abrir a página as verão.",
    shareDetailSubPagesUnread:
      "As subpáginas que ficarão públicas com esta página ainda não foram verificadas em busca de telas do Design. Qualquer pessoa com o link verá as telas que elas tiverem.",
    shareDetailSubPagesOne:
      "Uma subpágina que ficará pública com esta página tem uma tela de um design que menos pessoas podem abrir ({{designs}}). Qualquer pessoa com o link a verá.",
    shareDetailSubPages:
      "As subpáginas que ficarão públicas com esta página têm {{count}} telas de designs que menos pessoas podem abrir ({{designs}}). Qualquer pessoa com o link as verá.",
  },
  "zh-CN": {
    openInDesign: "在 Design 中打开",
    design: "{{design}} 设计",
    width: "宽 {{width}} 像素",
    pinnedOn: "固定于 {{date}}",
    pinnedOnBy: "由 {{name}} 固定于 {{date}}",
    refresh: "刷新",
    refreshing: "正在刷新…",
    refreshed: "画面已刷新",
    refreshFailed: "此画面未能刷新。",
    changed: "拍下这张图片后，此画面在 Design 中发生了变化。",
    changedRefresh:
      "拍下这张图片后，此画面在 Design 中发生了变化。刷新以更新它。",
    screenGone: "此画面在 Design 中已不存在。这张图片显示的是它原来的样子。",
    openCommentsOne: "1 条未解决的评论",
    openComments: "{{count}} 条未解决的评论",
    imageFailed: "此画面的图片未能加载。",
    unreadable: "此画面保存的图片无法读取，因此不显示。",
    adding: "正在从 Design 固定画面…",
    added: "画面已固定",
    addFailed: "无法固定此画面。",
    confirmWider:
      "能打开此页面的人比能打开 {{design}} 设计的人多。所有能打开此页面的人都会看到此画面。",
    addAnyway: "固定画面",
    keepLink: "保留链接",
    shareDetailUnread:
      "此页面中有尚未与其设计核对的 Design 画面。所有能打开此页面的人都会看到它们。",
    shareDetailOne:
      "此页面中有一个来自较少人能打开的设计（{{designs}}）的画面。所有能打开此页面的人都会看到它。",
    shareDetail:
      "此页面中有 {{count}} 个来自较少人能打开的设计（{{designs}}）的画面。所有能打开此页面的人都会看到它们。",
    shareDetailSubPagesUnread:
      "将随此页面一起公开的子页面尚未检查是否含有 Design 画面。任何拥有链接的人都会看到其中的画面。",
    shareDetailSubPagesOne:
      "将随此页面一起公开的一个子页面中有一个来自较少人能打开的设计（{{designs}}）的画面。任何拥有链接的人都会看到它。",
    shareDetailSubPages:
      "将随此页面一起公开的子页面中有 {{count}} 个来自较少人能打开的设计（{{designs}}）的画面。任何拥有链接的人都会看到它们。",
  },
  "zh-TW": {
    openInDesign: "在 Design 中開啟",
    design: "{{design}} 設計",
    width: "寬 {{width}} 像素",
    pinnedOn: "釘選於 {{date}}",
    pinnedOnBy: "由 {{name}} 釘選於 {{date}}",
    refresh: "重新整理",
    refreshing: "正在重新整理…",
    refreshed: "畫面已重新整理",
    refreshFailed: "此畫面未能重新整理。",
    changed: "拍下這張圖片後，此畫面在 Design 中有所變更。",
    changedRefresh:
      "拍下這張圖片後，此畫面在 Design 中有所變更。重新整理以更新它。",
    screenGone: "此畫面在 Design 中已不存在。這張圖片顯示的是它原本的樣子。",
    openCommentsOne: "1 則未解決的留言",
    openComments: "{{count}} 則未解決的留言",
    imageFailed: "此畫面的圖片未能載入。",
    unreadable: "此畫面儲存的圖片無法讀取，因此不會顯示。",
    adding: "正在從 Design 釘選畫面…",
    added: "畫面已釘選",
    addFailed: "無法釘選此畫面。",
    confirmWider:
      "能開啟此頁面的人比能開啟 {{design}} 設計的人多。所有能開啟此頁面的人都會看到此畫面。",
    addAnyway: "釘選畫面",
    keepLink: "保留連結",
    shareDetailUnread:
      "此頁面中有尚未與其設計核對的 Design 畫面。所有能開啟此頁面的人都會看到它們。",
    shareDetailOne:
      "此頁面中有一個來自較少人能開啟的設計（{{designs}}）的畫面。所有能開啟此頁面的人都會看到它。",
    shareDetail:
      "此頁面中有 {{count}} 個來自較少人能開啟的設計（{{designs}}）的畫面。所有能開啟此頁面的人都會看到它們。",
    shareDetailSubPagesUnread:
      "將隨此頁面一起公開的子頁面尚未檢查是否含有 Design 畫面。任何擁有連結的人都會看到其中的畫面。",
    shareDetailSubPagesOne:
      "將隨此頁面一起公開的一個子頁面中有一個來自較少人能開啟的設計（{{designs}}）的畫面。任何擁有連結的人都會看到它。",
    shareDetailSubPages:
      "將隨此頁面一起公開的子頁面中有 {{count}} 個來自較少人能開啟的設計（{{designs}}）的畫面。任何擁有連結的人都會看到它們。",
  },
  "ja-JP": {
    openInDesign: "Design で開く",
    design: "{{design}} デザイン",
    width: "幅 {{width}} px",
    pinnedOn: "{{date}} にピン留め",
    pinnedOnBy: "{{date}} に {{name}} がピン留め",
    refresh: "更新",
    refreshing: "更新中…",
    refreshed: "画面を更新しました",
    refreshFailed: "この画面を更新できませんでした。",
    changed: "この画像を撮った後に、この画面は Design で変更されました。",
    changedRefresh:
      "この画像を撮った後に、この画面は Design で変更されました。更新して最新にしてください。",
    screenGone:
      "この画面は Design にもうありません。この画像は以前の状態を示しています。",
    openCommentsOne: "未解決のコメント 1 件",
    openComments: "未解決のコメント {{count}} 件",
    imageFailed: "この画面の画像を読み込めませんでした。",
    unreadable: "この画面の保存された画像を読み取れないため、表示されません。",
    adding: "Design から画面をピン留めしています…",
    added: "画面をピン留めしました",
    addFailed: "この画面をピン留めできませんでした。",
    confirmWider:
      "このページは {{design}} デザインより多くの人が開けます。ページを開けるすべての人にこの画面が表示されます。",
    addAnyway: "画面をピン留め",
    keepLink: "リンクのままにする",
    shareDetailUnread:
      "このページには、デザインとまだ照合していない Design の画面があります。ページを開けるすべての人に表示されます。",
    shareDetailOne:
      "このページには、開ける人が少ないデザイン（{{designs}}）の画面が 1 つあります。ページを開けるすべての人に表示されます。",
    shareDetail:
      "このページには、開ける人が少ないデザイン（{{designs}}）の画面が {{count}} 個あります。ページを開けるすべての人に表示されます。",
    shareDetailSubPagesUnread:
      "このページと一緒に公開されるサブページは、Design の画面があるかまだ確認されていません。リンクを知っている人は誰でも、そこにある画面を見られます。",
    shareDetailSubPagesOne:
      "このページと一緒に公開されるサブページに、開ける人が少ないデザイン（{{designs}}）の画面が 1 つあります。リンクを知っている人は誰でも見られます。",
    shareDetailSubPages:
      "このページと一緒に公開されるサブページに、開ける人が少ないデザイン（{{designs}}）の画面が {{count}} 個あります。リンクを知っている人は誰でも見られます。",
  },
  "ko-KR": {
    openInDesign: "Design에서 열기",
    design: "{{design}} 디자인",
    width: "너비 {{width}}px",
    pinnedOn: "{{date}}에 고정됨",
    pinnedOnBy: "{{date}}에 {{name}} 님이 고정함",
    refresh: "새로고침",
    refreshing: "새로고침 중…",
    refreshed: "화면을 새로고침했습니다",
    refreshFailed: "이 화면을 새로고침하지 못했습니다.",
    changed: "이 이미지를 찍은 후 Design에서 이 화면이 변경되었습니다.",
    changedRefresh:
      "이 이미지를 찍은 후 Design에서 이 화면이 변경되었습니다. 새로고침하여 업데이트하세요.",
    screenGone:
      "이 화면은 더 이상 Design에 없습니다. 이 이미지는 이전 모습을 보여 줍니다.",
    openCommentsOne: "열린 댓글 1개",
    openComments: "열린 댓글 {{count}}개",
    imageFailed: "이 화면의 이미지를 불러오지 못했습니다.",
    unreadable: "이 화면의 저장된 이미지를 읽을 수 없어 표시하지 않습니다.",
    adding: "Design에서 화면을 고정하는 중…",
    added: "화면을 고정했습니다",
    addFailed: "이 화면을 고정할 수 없습니다.",
    confirmWider:
      "{{design}} 디자인보다 더 많은 사람이 이 페이지를 열 수 있습니다. 페이지를 열 수 있는 모든 사람이 이 화면을 보게 됩니다.",
    addAnyway: "화면 고정",
    keepLink: "링크 유지",
    shareDetailUnread:
      "이 페이지에는 아직 디자인과 대조하지 않은 Design 화면이 있습니다. 페이지를 열 수 있는 모든 사람이 보게 됩니다.",
    shareDetailOne:
      "이 페이지에는 더 적은 사람이 열 수 있는 디자인({{designs}})의 화면이 있습니다. 페이지를 열 수 있는 모든 사람이 보게 됩니다.",
    shareDetail:
      "이 페이지에는 더 적은 사람이 열 수 있는 디자인({{designs}})의 화면 {{count}}개가 있습니다. 페이지를 열 수 있는 모든 사람이 보게 됩니다.",
    shareDetailSubPagesUnread:
      "이 페이지와 함께 공개되는 하위 페이지에 Design 화면이 있는지 아직 확인하지 않았습니다. 링크가 있는 누구나 그 안의 화면을 보게 됩니다.",
    shareDetailSubPagesOne:
      "이 페이지와 함께 공개되는 하위 페이지에 더 적은 사람이 열 수 있는 디자인({{designs}})의 화면이 있습니다. 링크가 있는 누구나 보게 됩니다.",
    shareDetailSubPages:
      "이 페이지와 함께 공개되는 하위 페이지에 더 적은 사람이 열 수 있는 디자인({{designs}})의 화면 {{count}}개가 있습니다. 링크가 있는 누구나 보게 됩니다.",
  },
  "hi-IN": {
    openInDesign: "Design में खोलें",
    design: "{{design}} डिज़ाइन",
    width: "{{width}} px चौड़ा",
    pinnedOn: "{{date}} को पिन किया गया",
    pinnedOnBy: "{{date}} को {{name}} ने पिन किया",
    refresh: "रीफ़्रेश करें",
    refreshing: "रीफ़्रेश हो रहा है…",
    refreshed: "स्क्रीन रीफ़्रेश हो गई",
    refreshFailed: "यह स्क्रीन रीफ़्रेश नहीं हुई।",
    changed: "यह तस्वीर लेने के बाद Design में यह स्क्रीन बदल गई।",
    changedRefresh:
      "यह तस्वीर लेने के बाद Design में यह स्क्रीन बदल गई। इसे अपडेट करने के लिए रीफ़्रेश करें।",
    screenGone:
      "यह स्क्रीन अब Design में नहीं है। यह तस्वीर इसे वैसा दिखाती है जैसी यह थी।",
    openCommentsOne: "1 खुली टिप्पणी",
    openComments: "{{count}} खुली टिप्पणियाँ",
    imageFailed: "इस स्क्रीन की तस्वीर लोड नहीं हुई।",
    unreadable:
      "इस स्क्रीन की सहेजी गई तस्वीर पढ़ी नहीं जा सकती, इसलिए यह नहीं दिखाई जाती।",
    adding: "Design से स्क्रीन पिन की जा रही है…",
    added: "स्क्रीन पिन हो गई",
    addFailed: "यह स्क्रीन पिन नहीं की जा सकी।",
    confirmWider:
      "{{design}} डिज़ाइन की तुलना में ज़्यादा लोग यह पेज खोल सकते हैं। पेज खोल सकने वाला हर व्यक्ति यह स्क्रीन देखेगा।",
    addAnyway: "स्क्रीन पिन करें",
    keepLink: "लिंक रखें",
    shareDetailUnread:
      "इस पेज में ऐसी Design स्क्रीन हैं जिनकी अभी उनके डिज़ाइन से जाँच नहीं हुई है। पेज खोल सकने वाला हर व्यक्ति उन्हें देखेगा।",
    shareDetailOne:
      "इस पेज में एक ऐसे डिज़ाइन की स्क्रीन है जिसे कम लोग खोल सकते हैं ({{designs}})। पेज खोल सकने वाला हर व्यक्ति इसे देखेगा।",
    shareDetail:
      "इस पेज में ऐसे डिज़ाइनों की {{count}} स्क्रीन हैं जिन्हें कम लोग खोल सकते हैं ({{designs}})। पेज खोल सकने वाला हर व्यक्ति उन्हें देखेगा।",
    shareDetailSubPagesUnread:
      "इस पेज के साथ सार्वजनिक होने वाले सब-पेजों में Design स्क्रीन की अभी जाँच नहीं हुई है। लिंक वाला कोई भी व्यक्ति उनमें मौजूद स्क्रीन देखेगा।",
    shareDetailSubPagesOne:
      "इस पेज के साथ सार्वजनिक होने वाले एक सब-पेज में ऐसे डिज़ाइन की स्क्रीन है जिसे कम लोग खोल सकते हैं ({{designs}})। लिंक वाला कोई भी व्यक्ति इसे देखेगा।",
    shareDetailSubPages:
      "इस पेज के साथ सार्वजनिक होने वाले सब-पेजों में ऐसे डिज़ाइनों की {{count}} स्क्रीन हैं जिन्हें कम लोग खोल सकते हैं ({{designs}})। लिंक वाला कोई भी व्यक्ति उन्हें देखेगा।",
  },
  "ar-SA": {
    openInDesign: "فتح في Design",
    design: "تصميم {{design}}",
    width: "بعرض {{width}} بكسل",
    pinnedOn: "ثُبّتت في {{date}}",
    pinnedOnBy: "ثبّتها {{name}} في {{date}}",
    refresh: "تحديث",
    refreshing: "جارٍ التحديث…",
    refreshed: "تم تحديث الشاشة",
    refreshFailed: "لم يتم تحديث هذه الشاشة.",
    changed: "تغيّرت هذه الشاشة في Design بعد التقاط هذه الصورة.",
    changedRefresh:
      "تغيّرت هذه الشاشة في Design بعد التقاط هذه الصورة. حدّثها لتصبح محدّثة.",
    screenGone:
      "لم تعد هذه الشاشة موجودة في Design. تُظهرها هذه الصورة كما كانت.",
    openCommentsOne: "تعليق مفتوح واحد",
    openComments: "{{count}} تعليقات مفتوحة",
    imageFailed: "لم يتم تحميل صورة هذه الشاشة.",
    unreadable: "تتعذّر قراءة الصورة المحفوظة لهذه الشاشة، لذا لا تُعرض.",
    adding: "جارٍ تثبيت الشاشة من Design…",
    added: "تم تثبيت الشاشة",
    addFailed: "تعذّر تثبيت هذه الشاشة.",
    confirmWider:
      "يمكن لعدد أكبر من الأشخاص فتح هذه الصفحة مقارنةً بتصميم {{design}}. سيرى كل من يمكنه فتح الصفحة هذه الشاشة.",
    addAnyway: "تثبيت الشاشة",
    keepLink: "الإبقاء على الرابط",
    shareDetailUnread:
      "تحتوي هذه الصفحة على شاشات من Design لم تتم مقارنتها بتصاميمها بعد. سيراها كل من يمكنه فتح الصفحة.",
    shareDetailOne:
      "تحتوي هذه الصفحة على شاشة من تصميم يمكن لعدد أقل من الأشخاص فتحه ({{designs}}). سيراها كل من يمكنه فتح الصفحة.",
    shareDetail:
      "تحتوي هذه الصفحة على {{count}} شاشات من تصاميم يمكن لعدد أقل من الأشخاص فتحها ({{designs}}). سيراها كل من يمكنه فتح الصفحة.",
    shareDetailSubPagesUnread:
      "لم يتم بعد التحقق من الصفحات الفرعية التي تصبح عامة مع هذه الصفحة بحثًا عن شاشات Design. سيرى كل من لديه الرابط أي شاشات فيها.",
    shareDetailSubPagesOne:
      "تحتوي صفحة فرعية تصبح عامة مع هذه الصفحة على شاشة من تصميم يمكن لعدد أقل من الأشخاص فتحه ({{designs}}). سيراها كل من لديه الرابط.",
    shareDetailSubPages:
      "تحتوي الصفحات الفرعية التي تصبح عامة مع هذه الصفحة على {{count}} شاشات من تصاميم يمكن لعدد أقل من الأشخاص فتحها ({{designs}}). سيراها كل من لديه الرابط.",
  },
};

export const designScreenMessagesByLocale: Record<
  BuiltinLocaleCode,
  DesignScreenMessages
> = {
  "en-US": en,
  ...translations,
};
