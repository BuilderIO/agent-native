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
  errorUnreachable: "Design didn't answer. Try again in a minute.",
  errorRefused:
    "Design couldn't show this screen. Check that you can still open the design and that the screen is still in it.",
  errorSignedOut: "Sign in to pin Design screens.",
  errorEditRequired:
    "Only people who can edit this page can pin or refresh its screens.",
  errorPublicPage:
    "Anyone with the link can open this page, but not this screen's design, so it can't be pinned here. Narrow the page's sharing first.",
  errorUnreadableAnswer:
    "Design sent back something Content can't read. Try again.",
  errorLiveEffects:
    "This screen uses Design's live effects, which only show in the Design editor, so it can't be pinned as a picture.",
  errorLiveApp:
    "This screen shows a running app from its address, which only loads in the Design editor, so it can't be pinned as a picture.",
  errorNavigatedAway:
    "This screen leaves its own page while it loads, so it can't be pinned as a picture.",
  errorTooLarge:
    "This screen is too long to pin as one picture. Split it into shorter screens in Design.",
  errorRenderUnavailable:
    "Design can't take pictures of screens right now. Try again in a minute.",
  errorRenderTimeout:
    "Design took too long to take a picture of this screen. Try again, or split it into shorter screens in Design.",
  pictureAlt:
    "The {{screen}} screen from the {{design}} design in Design, at {{width}} pixels wide.",
  errorStorageUnavailable:
    "Content can't keep pictures right now. Try again in a minute.",
  errorPageMoved:
    "This page moved to another organization while Design was taking the picture. Try again.",
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
    errorUnreachable: "Design no respondió. Inténtalo de nuevo en un minuto.",
    errorRefused:
      "Design no pudo mostrar esta pantalla. Comprueba que todavía puedes abrir el diseño y que la pantalla sigue en él.",
    errorSignedOut: "Inicia sesión para fijar pantallas de Design.",
    errorEditRequired:
      "Solo quienes pueden editar esta página pueden fijar o actualizar sus pantallas.",
    errorPublicPage:
      "Cualquiera con el enlace puede abrir esta página, pero no el diseño de esta pantalla, así que no se puede fijar aquí. Primero limita el uso compartido de la página.",
    errorUnreadableAnswer:
      "Design devolvió algo que Content no puede leer. Inténtalo de nuevo.",
    errorLiveEffects:
      "Esta pantalla usa los efectos en vivo de Design, que solo se ven en el editor de Design, así que no se puede fijar como imagen.",
    errorLiveApp:
      "Esta pantalla muestra una app en ejecución desde su dirección, que solo se carga en el editor de Design, así que no se puede fijar como imagen.",
    errorNavigatedAway:
      "Esta pantalla sale de su propia página mientras carga, así que no se puede fijar como imagen.",
    errorTooLarge:
      "Esta pantalla es demasiado larga para fijarla como una sola imagen. Divídela en pantallas más cortas en Design.",
    errorRenderUnavailable:
      "Design no puede tomar imágenes de pantallas en este momento. Inténtalo de nuevo en un minuto.",
    errorRenderTimeout:
      "Design tardó demasiado en tomar una imagen de esta pantalla. Inténtalo de nuevo o divídela en pantallas más cortas en Design.",
    pictureAlt:
      "La pantalla {{screen}} del diseño {{design}} en Design, de {{width}} píxeles de ancho.",
    errorStorageUnavailable:
      "Content no puede guardar imágenes en este momento. Inténtalo de nuevo en un minuto.",
    errorPageMoved:
      "Esta página se movió a otra organización mientras Design tomaba la imagen. Inténtalo de nuevo.",
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
    errorUnreachable: "Design n'a pas répondu. Réessayez dans une minute.",
    errorRefused:
      "Design n'a pas pu afficher cet écran. Vérifiez que vous pouvez toujours ouvrir le design et que l'écran s'y trouve encore.",
    errorSignedOut: "Connectez-vous pour épingler des écrans de Design.",
    errorEditRequired:
      "Seules les personnes qui peuvent modifier cette page peuvent épingler ou actualiser ses écrans.",
    errorPublicPage:
      "Toute personne disposant du lien peut ouvrir cette page, mais pas le design de cet écran, qui ne peut donc pas être épinglé ici. Restreignez d'abord le partage de la page.",
    errorUnreadableAnswer:
      "Design a renvoyé une réponse que Content ne peut pas lire. Réessayez.",
    errorLiveEffects:
      "Cet écran utilise les effets en direct de Design, qui ne s'affichent que dans l'éditeur Design ; il ne peut donc pas être épinglé comme image.",
    errorLiveApp:
      "Cet écran affiche une application en cours d'exécution depuis son adresse, qui ne se charge que dans l'éditeur Design ; il ne peut donc pas être épinglé comme image.",
    errorNavigatedAway:
      "Cet écran quitte sa propre page pendant son chargement ; il ne peut donc pas être épinglé comme image.",
    errorTooLarge:
      "Cet écran est trop long pour être épinglé en une seule image. Divisez-le en écrans plus courts dans Design.",
    errorRenderUnavailable:
      "Design ne peut pas prendre d'images d'écrans pour le moment. Réessayez dans une minute.",
    errorRenderTimeout:
      "Design a mis trop de temps à prendre une image de cet écran. Réessayez, ou divisez-le en écrans plus courts dans Design.",
    pictureAlt:
      "L'écran {{screen}} du design {{design}} dans Design, de {{width}} pixels de large.",
    errorStorageUnavailable:
      "Content ne peut pas enregistrer d'images pour le moment. Réessayez dans une minute.",
    errorPageMoved:
      "Cette page a été déplacée vers une autre organisation pendant que Design prenait l'image. Réessayez.",
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
    errorUnreachable:
      "Design hat nicht geantwortet. Versuche es in einer Minute erneut.",
    errorRefused:
      "Design konnte diesen Screen nicht anzeigen. Prüfe, ob du das Design noch öffnen kannst und ob der Screen noch darin ist.",
    errorSignedOut: "Melde dich an, um Design-Screens anzuheften.",
    errorEditRequired:
      "Nur Personen, die diese Seite bearbeiten können, können ihre Screens anheften oder aktualisieren.",
    errorPublicPage:
      "Jeder mit dem Link kann diese Seite öffnen, aber nicht das Design dieses Screens, daher kann er hier nicht angeheftet werden. Schränke zuerst die Freigabe der Seite ein.",
    errorUnreadableAnswer:
      "Design hat etwas zurückgeschickt, das Content nicht lesen kann. Versuche es erneut.",
    errorLiveEffects:
      "Dieser Screen nutzt die Live-Effekte von Design, die nur im Design-Editor angezeigt werden, daher kann er nicht als Bild angeheftet werden.",
    errorLiveApp:
      "Dieser Screen zeigt eine laufende App über ihre Adresse, die nur im Design-Editor lädt, daher kann er nicht als Bild angeheftet werden.",
    errorNavigatedAway:
      "Dieser Screen verlässt beim Laden seine eigene Seite, daher kann er nicht als Bild angeheftet werden.",
    errorTooLarge:
      "Dieser Screen ist zu lang, um ihn als ein Bild anzuheften. Teile ihn in Design in kürzere Screens auf.",
    errorRenderUnavailable:
      "Design kann gerade keine Bilder von Screens aufnehmen. Versuche es in einer Minute erneut.",
    errorRenderTimeout:
      "Design hat zu lange gebraucht, um ein Bild dieses Screens aufzunehmen. Versuche es erneut oder teile ihn in Design in kürzere Screens auf.",
    pictureAlt:
      "Der Screen {{screen}} aus dem Design {{design}} in Design, {{width}} Pixel breit.",
    errorStorageUnavailable:
      "Content kann gerade keine Bilder speichern. Versuche es in einer Minute erneut.",
    errorPageMoved:
      "Diese Seite wurde in eine andere Organisation verschoben, während Design das Bild aufgenommen hat. Versuche es erneut.",
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
    errorUnreachable: "O Design não respondeu. Tente novamente em um minuto.",
    errorRefused:
      "O Design não conseguiu mostrar esta tela. Verifique se você ainda consegue abrir o design e se a tela ainda está nele.",
    errorSignedOut: "Entre para fixar telas do Design.",
    errorEditRequired:
      "Só quem pode editar esta página pode fixar ou atualizar as telas dela.",
    errorPublicPage:
      "Qualquer pessoa com o link pode abrir esta página, mas não o design desta tela, então ela não pode ser fixada aqui. Restrinja primeiro o compartilhamento da página.",
    errorUnreadableAnswer:
      "O Design enviou algo que o Content não consegue ler. Tente novamente.",
    errorLiveEffects:
      "Esta tela usa os efeitos ao vivo do Design, que só aparecem no editor do Design, então não pode ser fixada como imagem.",
    errorLiveApp:
      "Esta tela mostra um app em execução a partir do endereço dele, que só carrega no editor do Design, então não pode ser fixada como imagem.",
    errorNavigatedAway:
      "Esta tela sai da própria página enquanto carrega, então não pode ser fixada como imagem.",
    errorTooLarge:
      "Esta tela é longa demais para ser fixada como uma única imagem. Divida-a em telas mais curtas no Design.",
    errorRenderUnavailable:
      "O Design não consegue tirar imagens de telas agora. Tente novamente em um minuto.",
    errorRenderTimeout:
      "O Design demorou demais para tirar uma imagem desta tela. Tente novamente ou divida-a em telas mais curtas no Design.",
    pictureAlt:
      "A tela {{screen}} do design {{design}} no Design, com {{width}} pixels de largura.",
    errorStorageUnavailable:
      "O Content não consegue guardar imagens agora. Tente novamente em um minuto.",
    errorPageMoved:
      "Esta página foi movida para outra organização enquanto o Design tirava a imagem. Tente novamente.",
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
    errorUnreachable: "Design 没有响应。请过一分钟再试。",
    errorRefused:
      "Design 无法显示此画面。请确认你仍能打开该设计，并且该画面仍在其中。",
    errorSignedOut: "登录后才能固定 Design 画面。",
    errorEditRequired: "只有能编辑此页面的人才能固定或刷新其中的画面。",
    errorPublicPage:
      "任何拥有链接的人都能打开此页面，但不能打开此画面所在的设计，因此无法在这里固定它。请先缩小此页面的共享范围。",
    errorUnreadableAnswer: "Design 返回了 Content 无法读取的内容。请重试。",
    errorLiveEffects:
      "此画面使用了 Design 的实时效果，这些效果只在 Design 编辑器中显示，因此无法固定为图片。",
    errorLiveApp:
      "此画面通过地址显示一个正在运行的应用，它只在 Design 编辑器中加载，因此无法固定为图片。",
    errorNavigatedAway: "此画面在加载时会离开自己的页面，因此无法固定为图片。",
    errorTooLarge:
      "此画面太长，无法固定为一张图片。请在 Design 中将它拆分成更短的画面。",
    errorRenderUnavailable: "Design 现在无法为画面拍摄图片。请过一分钟再试。",
    errorRenderTimeout:
      "Design 为此画面拍摄图片的时间太长。请重试，或在 Design 中将它拆分成更短的画面。",
    pictureAlt:
      "Design 中 {{design}} 设计的 {{screen}} 画面，宽 {{width}} 像素。",
    errorStorageUnavailable: "Content 现在无法保存图片。请过一分钟再试。",
    errorPageMoved:
      "在 Design 拍摄图片期间，此页面被移到了另一个组织。请重试。",
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
    errorUnreachable: "Design 沒有回應。請過一分鐘再試。",
    errorRefused:
      "Design 無法顯示此畫面。請確認你仍能開啟該設計，且該畫面仍在其中。",
    errorSignedOut: "登入後才能固定 Design 畫面。",
    errorEditRequired: "只有能編輯此頁面的人才能固定或重新整理其中的畫面。",
    errorPublicPage:
      "任何擁有連結的人都能開啟此頁面，但無法開啟此畫面所屬的設計，因此無法在這裡固定它。請先縮小此頁面的共用範圍。",
    errorUnreadableAnswer: "Design 傳回了 Content 無法讀取的內容。請再試一次。",
    errorLiveEffects:
      "此畫面使用了 Design 的即時效果，這些效果只會在 Design 編輯器中顯示，因此無法固定為圖片。",
    errorLiveApp:
      "此畫面透過網址顯示一個正在執行的應用程式，它只會在 Design 編輯器中載入，因此無法固定為圖片。",
    errorNavigatedAway: "此畫面在載入時會離開自己的頁面，因此無法固定為圖片。",
    errorTooLarge:
      "此畫面太長，無法固定為一張圖片。請在 Design 中將它拆分成較短的畫面。",
    errorRenderUnavailable: "Design 目前無法為畫面拍攝圖片。請過一分鐘再試。",
    errorRenderTimeout:
      "Design 為此畫面拍攝圖片的時間太長。請重試，或在 Design 中將它拆分成較短的畫面。",
    pictureAlt:
      "Design 中 {{design}} 設計的 {{screen}} 畫面，寬 {{width}} 像素。",
    errorStorageUnavailable: "Content 目前無法儲存圖片。請過一分鐘再試。",
    errorPageMoved:
      "在 Design 拍攝圖片期間，此頁面被移到了另一個組織。請再試一次。",
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
    errorUnreachable:
      "Design から応答がありませんでした。1 分ほどしてからもう一度お試しください。",
    errorRefused:
      "Design でこの画面を表示できませんでした。デザインをまだ開けること、そして画面がまだその中にあることを確認してください。",
    errorSignedOut: "Design の画面をピン留めするにはサインインしてください。",
    errorEditRequired:
      "このページを編集できる人だけが、その画面をピン留めまたは更新できます。",
    errorPublicPage:
      "リンクを知っている人は誰でもこのページを開けますが、この画面のデザインは開けないため、ここにピン留めできません。先にページの共有範囲を狭めてください。",
    errorUnreadableAnswer:
      "Design から Content が読み取れない内容が返されました。もう一度お試しください。",
    errorLiveEffects:
      "この画面は Design のライブエフェクトを使っており、Design エディターでしか表示されないため、画像としてピン留めできません。",
    errorLiveApp:
      "この画面はアドレスから実行中のアプリを表示しており、Design エディターでしか読み込まれないため、画像としてピン留めできません。",
    errorNavigatedAway:
      "この画面は読み込み中に自分のページから離れてしまうため、画像としてピン留めできません。",
    errorTooLarge:
      "この画面は長すぎて 1 枚の画像としてピン留めできません。Design で短い画面に分けてください。",
    errorRenderUnavailable:
      "Design は現在、画面の画像を撮影できません。1 分ほどしてからもう一度お試しください。",
    errorRenderTimeout:
      "Design がこの画面の画像の撮影に時間がかかりすぎました。もう一度お試しいただくか、Design で短い画面に分けてください。",
    pictureAlt:
      "Design の {{design}} デザインにある {{screen}} 画面（幅 {{width}} px）。",
    errorStorageUnavailable:
      "Content は現在、画像を保存できません。1 分ほどしてからもう一度お試しください。",
    errorPageMoved:
      "Design が画像を撮影している間に、このページが別の組織に移動されました。もう一度お試しください。",
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
    errorUnreachable: "Design이 응답하지 않았습니다. 1분 후에 다시 시도하세요.",
    errorRefused:
      "Design에서 이 화면을 표시하지 못했습니다. 아직 디자인을 열 수 있는지, 화면이 아직 그 안에 있는지 확인하세요.",
    errorSignedOut: "Design 화면을 고정하려면 로그인하세요.",
    errorEditRequired:
      "이 페이지를 편집할 수 있는 사람만 화면을 고정하거나 새로고침할 수 있습니다.",
    errorPublicPage:
      "링크가 있는 누구나 이 페이지를 열 수 있지만 이 화면의 디자인은 열 수 없으므로 여기에 고정할 수 없습니다. 먼저 페이지의 공유 범위를 좁히세요.",
    errorUnreadableAnswer:
      "Design이 Content에서 읽을 수 없는 내용을 보냈습니다. 다시 시도하세요.",
    errorLiveEffects:
      "이 화면은 Design 편집기에서만 보이는 Design의 라이브 효과를 사용하므로 이미지로 고정할 수 없습니다.",
    errorLiveApp:
      "이 화면은 주소로 실행 중인 앱을 보여 주며, 이 앱은 Design 편집기에서만 로드되므로 이미지로 고정할 수 없습니다.",
    errorNavigatedAway:
      "이 화면은 로드되는 동안 자기 페이지를 벗어나므로 이미지로 고정할 수 없습니다.",
    errorTooLarge:
      "이 화면은 너무 길어서 하나의 이미지로 고정할 수 없습니다. Design에서 더 짧은 화면으로 나누세요.",
    errorRenderUnavailable:
      "Design에서 지금은 화면 이미지를 찍을 수 없습니다. 1분 후에 다시 시도하세요.",
    errorRenderTimeout:
      "Design에서 이 화면의 이미지를 찍는 데 시간이 너무 오래 걸렸습니다. 다시 시도하거나 Design에서 더 짧은 화면으로 나누세요.",
    pictureAlt:
      "Design의 {{design}} 디자인에 있는 {{screen}} 화면, 너비 {{width}}px.",
    errorStorageUnavailable:
      "Content에서 지금은 이미지를 저장할 수 없습니다. 1분 후에 다시 시도하세요.",
    errorPageMoved:
      "Design이 이미지를 찍는 동안 이 페이지가 다른 조직으로 이동되었습니다. 다시 시도하세요.",
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
    errorUnreachable: "Design ने जवाब नहीं दिया। एक मिनट बाद फिर कोशिश करें।",
    errorRefused:
      "Design यह स्क्रीन नहीं दिखा सका। जाँचें कि आप अब भी डिज़ाइन खोल सकते हैं और स्क्रीन अब भी उसमें है।",
    errorSignedOut: "Design स्क्रीन पिन करने के लिए साइन इन करें।",
    errorEditRequired:
      "केवल वे लोग जो इस पेज को संपादित कर सकते हैं, इसकी स्क्रीन पिन या रीफ़्रेश कर सकते हैं।",
    errorPublicPage:
      "लिंक वाला कोई भी व्यक्ति यह पेज खोल सकता है, लेकिन इस स्क्रीन का डिज़ाइन नहीं, इसलिए इसे यहाँ पिन नहीं किया जा सकता। पहले पेज की शेयरिंग सीमित करें।",
    errorUnreadableAnswer:
      "Design ने कुछ ऐसा भेजा जिसे Content पढ़ नहीं सकता। फिर कोशिश करें।",
    errorLiveEffects:
      "यह स्क्रीन Design के लाइव इफ़ेक्ट इस्तेमाल करती है, जो सिर्फ़ Design एडिटर में दिखते हैं, इसलिए इसे तस्वीर के रूप में पिन नहीं किया जा सकता।",
    errorLiveApp:
      "यह स्क्रीन अपने पते से एक चल रहा ऐप दिखाती है, जो सिर्फ़ Design एडिटर में लोड होता है, इसलिए इसे तस्वीर के रूप में पिन नहीं किया जा सकता।",
    errorNavigatedAway:
      "यह स्क्रीन लोड होते समय अपना ही पेज छोड़ देती है, इसलिए इसे तस्वीर के रूप में पिन नहीं किया जा सकता।",
    errorTooLarge:
      "यह स्क्रीन एक तस्वीर के रूप में पिन करने के लिए बहुत लंबी है। इसे Design में छोटी स्क्रीन में बाँटें।",
    errorRenderUnavailable:
      "Design अभी स्क्रीन की तस्वीरें नहीं ले सकता। एक मिनट बाद फिर कोशिश करें।",
    errorRenderTimeout:
      "Design को इस स्क्रीन की तस्वीर लेने में बहुत समय लगा। फिर कोशिश करें, या इसे Design में छोटी स्क्रीन में बाँटें।",
    pictureAlt:
      "Design में {{design}} डिज़ाइन की {{screen}} स्क्रीन, {{width}} px चौड़ी।",
    errorStorageUnavailable:
      "Content अभी तस्वीरें सहेज नहीं सकता। एक मिनट बाद फिर कोशिश करें।",
    errorPageMoved:
      "Design के तस्वीर लेते समय यह पेज किसी दूसरे संगठन में चला गया। फिर कोशिश करें।",
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
    errorUnreachable: "لم يستجب Design. حاول مرة أخرى بعد دقيقة.",
    errorRefused:
      "تعذّر على Design عرض هذه الشاشة. تحقّق من أنك ما زلت تستطيع فتح التصميم وأن الشاشة ما زالت فيه.",
    errorSignedOut: "سجّل الدخول لتثبيت شاشات Design.",
    errorEditRequired:
      "يمكن فقط لمن يستطيع تعديل هذه الصفحة تثبيت شاشاتها أو تحديثها.",
    errorPublicPage:
      "يمكن لأي شخص لديه الرابط فتح هذه الصفحة، لكن ليس تصميم هذه الشاشة، لذا لا يمكن تثبيتها هنا. ضيّق مشاركة الصفحة أولاً.",
    errorUnreadableAnswer:
      "أرسل Design شيئًا لا يستطيع Content قراءته. حاول مرة أخرى.",
    errorLiveEffects:
      "تستخدم هذه الشاشة المؤثرات الحية في Design، وهي لا تظهر إلا في محرر Design، لذا لا يمكن تثبيتها كصورة.",
    errorLiveApp:
      "تعرض هذه الشاشة تطبيقًا قيد التشغيل من عنوانه، وهو لا يُحمَّل إلا في محرر Design، لذا لا يمكن تثبيتها كصورة.",
    errorNavigatedAway:
      "تغادر هذه الشاشة صفحتها أثناء التحميل، لذا لا يمكن تثبيتها كصورة.",
    errorTooLarge:
      "هذه الشاشة أطول من أن تُثبَّت كصورة واحدة. قسّمها إلى شاشات أقصر في Design.",
    errorRenderUnavailable:
      "لا يستطيع Design التقاط صور للشاشات الآن. حاول مرة أخرى بعد دقيقة.",
    errorRenderTimeout:
      "استغرق Design وقتًا طويلًا جدًا لالتقاط صورة لهذه الشاشة. حاول مرة أخرى، أو قسّمها إلى شاشات أقصر في Design.",
    pictureAlt:
      "شاشة {{screen}} من تصميم {{design}} في Design، بعرض {{width}} بكسل.",
    errorStorageUnavailable:
      "لا يستطيع Content حفظ الصور الآن. حاول مرة أخرى بعد دقيقة.",
    errorPageMoved:
      "نُقلت هذه الصفحة إلى مؤسسة أخرى بينما كان Design يلتقط الصورة. حاول مرة أخرى.",
  },
};

export const designScreenMessagesByLocale: Record<
  BuiltinLocaleCode,
  DesignScreenMessages
> = {
  "en-US": en,
  ...translations,
};
