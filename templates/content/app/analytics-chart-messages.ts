import type { BuiltinLocaleCode } from "@agent-native/core/client/i18n";

const en = {
  openInAnalytics: "Open in Analytics",
  dashboard: "{{dashboard}} dashboard",
  copiedOn: "Copied {{date}}",
  refresh: "Refresh",
  refreshing: "Refreshing…",
  refreshed: "Chart refreshed",
  refreshFailed: "This chart didn't refresh.",
  changed: "This panel changed in Analytics after this copy was made.",
  changedRefresh:
    "This panel changed in Analytics after this copy was made. Refresh to update it.",
  panelGone:
    "This panel no longer exists in Analytics. This copy keeps the numbers it had.",
  shareDetailUnread:
    "This page has Analytics charts not yet checked against their dashboards. Everyone who can open the page will see their numbers.",
  truncated: "Shows part of the panel's rows.",
  unreadable: "This chart's saved copy can't be read, so it isn't drawn.",
  adding: "Adding the chart from Analytics…",
  added: "Chart added",
  addFailed: "This chart couldn't be added.",
  confirmWider:
    "More people can open this page than the {{dashboard}} dashboard. Everyone who can open the page will see this chart's numbers.",
  addAnyway: "Add chart",
  keepLink: "Keep the link",
  blockedPublic:
    "Anyone with the link can open this page, but not the {{dashboard}} dashboard, so its panels can't be added here.",
  blockedTable:
    "A table can't go in a page more people can open than its dashboard.",
  shareDetailOne:
    "This page has a chart from a dashboard fewer people can open ({{dashboards}}). Everyone who can open the page will see its numbers.",
  shareDetail:
    "This page has {{count}} charts from dashboards fewer people can open ({{dashboards}}). Everyone who can open the page will see their numbers.",
} as const;

type AnalyticsChartMessages = Record<keyof typeof en, string>;

const translations: Record<
  Exclude<BuiltinLocaleCode, "en-US">,
  AnalyticsChartMessages
> = {
  "es-ES": {
    openInAnalytics: "Abrir en Analytics",
    dashboard: "Panel {{dashboard}}",
    copiedOn: "Copiado el {{date}}",
    refresh: "Actualizar",
    refreshing: "Actualizando…",
    refreshed: "Gráfico actualizado",
    refreshFailed: "Este gráfico no se actualizó.",
    changed: "Este panel cambió en Analytics después de hacer esta copia.",
    changedRefresh:
      "Este panel cambió en Analytics después de hacer esta copia. Actualízalo para ponerlo al día.",
    panelGone:
      "Este panel ya no existe en Analytics. Esta copia conserva los datos que tenía.",
    shareDetailUnread:
      "Esta página tiene gráficos de Analytics que aún no se han comprobado con sus paneles. Todos los que puedan abrir la página verán sus datos.",
    truncated: "Muestra parte de las filas del panel.",
    unreadable:
      "No se puede leer la copia guardada de este gráfico, así que no se muestra.",
    adding: "Añadiendo el gráfico desde Analytics…",
    added: "Gráfico añadido",
    addFailed: "No se pudo añadir este gráfico.",
    confirmWider:
      "Más personas pueden abrir esta página que el panel {{dashboard}}. Todos los que puedan abrir la página verán los datos de este gráfico.",
    addAnyway: "Añadir gráfico",
    keepLink: "Conservar el enlace",
    blockedPublic:
      "Cualquiera con el enlace puede abrir esta página, pero no el panel {{dashboard}}, así que sus gráficos no se pueden añadir aquí.",
    blockedTable:
      "Una tabla no puede ir en una página que pueden abrir más personas que su panel.",
    shareDetailOne:
      "Esta página tiene un gráfico de un panel que pueden abrir menos personas ({{dashboards}}). Todos los que puedan abrir la página verán sus datos.",
    shareDetail:
      "Esta página tiene {{count}} gráficos de paneles que pueden abrir menos personas ({{dashboards}}). Todos los que puedan abrir la página verán sus datos.",
  },
  "fr-FR": {
    openInAnalytics: "Ouvrir dans Analytics",
    dashboard: "Tableau de bord {{dashboard}}",
    copiedOn: "Copié le {{date}}",
    refresh: "Actualiser",
    refreshing: "Actualisation…",
    refreshed: "Graphique actualisé",
    refreshFailed: "Ce graphique n'a pas été actualisé.",
    changed:
      "Ce panneau a changé dans Analytics depuis que cette copie a été faite.",
    changedRefresh:
      "Ce panneau a changé dans Analytics depuis que cette copie a été faite. Actualisez-le pour le mettre à jour.",
    panelGone:
      "Ce panneau n'existe plus dans Analytics. Cette copie garde les chiffres qu'elle avait.",
    shareDetailUnread:
      "Cette page contient des graphiques Analytics pas encore vérifiés par rapport à leurs tableaux de bord. Toutes les personnes qui peuvent ouvrir la page verront leurs chiffres.",
    truncated: "Affiche une partie des lignes du panneau.",
    unreadable:
      "La copie enregistrée de ce graphique est illisible, il n'est donc pas affiché.",
    adding: "Ajout du graphique depuis Analytics…",
    added: "Graphique ajouté",
    addFailed: "Ce graphique n'a pas pu être ajouté.",
    confirmWider:
      "Plus de personnes peuvent ouvrir cette page que le tableau de bord {{dashboard}}. Toutes les personnes qui peuvent ouvrir la page verront les chiffres de ce graphique.",
    addAnyway: "Ajouter le graphique",
    keepLink: "Garder le lien",
    blockedPublic:
      "Toute personne disposant du lien peut ouvrir cette page, mais pas le tableau de bord {{dashboard}} : ses panneaux ne peuvent donc pas être ajoutés ici.",
    blockedTable:
      "Un tableau ne peut pas aller dans une page que plus de personnes peuvent ouvrir que son tableau de bord.",
    shareDetailOne:
      "Cette page contient un graphique d'un tableau de bord que moins de personnes peuvent ouvrir ({{dashboards}}). Toutes les personnes qui peuvent ouvrir la page verront ses chiffres.",
    shareDetail:
      "Cette page contient {{count}} graphiques de tableaux de bord que moins de personnes peuvent ouvrir ({{dashboards}}). Toutes les personnes qui peuvent ouvrir la page verront leurs chiffres.",
  },
  "de-DE": {
    openInAnalytics: "In Analytics öffnen",
    dashboard: "Dashboard {{dashboard}}",
    copiedOn: "Kopiert am {{date}}",
    refresh: "Aktualisieren",
    refreshing: "Wird aktualisiert…",
    refreshed: "Diagramm aktualisiert",
    refreshFailed: "Dieses Diagramm wurde nicht aktualisiert.",
    changed:
      "Dieses Panel hat sich in Analytics geändert, nachdem diese Kopie erstellt wurde.",
    changedRefresh:
      "Dieses Panel hat sich in Analytics geändert, nachdem diese Kopie erstellt wurde. Aktualisiere es, um es auf den neuesten Stand zu bringen.",
    panelGone:
      "Dieses Panel gibt es in Analytics nicht mehr. Diese Kopie behält ihre bisherigen Zahlen.",
    shareDetailUnread:
      "Diese Seite enthält Analytics-Diagramme, die noch nicht mit ihren Dashboards abgeglichen wurden. Alle, die die Seite öffnen können, sehen ihre Zahlen.",
    truncated: "Zeigt einen Teil der Zeilen des Panels.",
    unreadable:
      "Die gespeicherte Kopie dieses Diagramms ist nicht lesbar und wird daher nicht angezeigt.",
    adding: "Diagramm wird aus Analytics hinzugefügt…",
    added: "Diagramm hinzugefügt",
    addFailed: "Dieses Diagramm konnte nicht hinzugefügt werden.",
    confirmWider:
      "Mehr Personen können diese Seite öffnen als das Dashboard {{dashboard}}. Alle, die die Seite öffnen können, sehen die Zahlen dieses Diagramms.",
    addAnyway: "Diagramm hinzufügen",
    keepLink: "Link behalten",
    blockedPublic:
      "Jeder mit dem Link kann diese Seite öffnen, aber nicht das Dashboard {{dashboard}}, daher können seine Panels hier nicht hinzugefügt werden.",
    blockedTable:
      "Eine Tabelle kann nicht in eine Seite, die mehr Personen öffnen können als ihr Dashboard.",
    shareDetailOne:
      "Diese Seite enthält ein Diagramm aus einem Dashboard, das weniger Personen öffnen können ({{dashboards}}). Alle, die die Seite öffnen können, sehen seine Zahlen.",
    shareDetail:
      "Diese Seite enthält {{count}} Diagramme aus Dashboards, die weniger Personen öffnen können ({{dashboards}}). Alle, die die Seite öffnen können, sehen ihre Zahlen.",
  },
  "pt-BR": {
    openInAnalytics: "Abrir no Analytics",
    dashboard: "Painel {{dashboard}}",
    copiedOn: "Copiado em {{date}}",
    refresh: "Atualizar",
    refreshing: "Atualizando…",
    refreshed: "Gráfico atualizado",
    refreshFailed: "Este gráfico não foi atualizado.",
    changed: "Este painel mudou no Analytics depois que esta cópia foi feita.",
    changedRefresh:
      "Este painel mudou no Analytics depois que esta cópia foi feita. Atualize para trazê-lo em dia.",
    panelGone:
      "Este painel não existe mais no Analytics. Esta cópia mantém os números que tinha.",
    shareDetailUnread:
      "Esta página tem gráficos do Analytics ainda não verificados com seus painéis. Todos que podem abrir a página verão os números deles.",
    truncated: "Mostra parte das linhas do painel.",
    unreadable:
      "Não é possível ler a cópia salva deste gráfico, por isso ele não é exibido.",
    adding: "Adicionando o gráfico do Analytics…",
    added: "Gráfico adicionado",
    addFailed: "Não foi possível adicionar este gráfico.",
    confirmWider:
      "Mais pessoas podem abrir esta página do que o painel {{dashboard}}. Todos que podem abrir a página verão os números deste gráfico.",
    addAnyway: "Adicionar gráfico",
    keepLink: "Manter o link",
    blockedPublic:
      "Qualquer pessoa com o link pode abrir esta página, mas não o painel {{dashboard}}, então os gráficos dele não podem ser adicionados aqui.",
    blockedTable:
      "Uma tabela não pode ir para uma página que mais pessoas podem abrir do que o painel dela.",
    shareDetailOne:
      "Esta página tem um gráfico de um painel que menos pessoas podem abrir ({{dashboards}}). Todos que podem abrir a página verão os números dele.",
    shareDetail:
      "Esta página tem {{count}} gráficos de painéis que menos pessoas podem abrir ({{dashboards}}). Todos que podem abrir a página verão os números deles.",
  },
  "zh-CN": {
    openInAnalytics: "在 Analytics 中打开",
    dashboard: "{{dashboard}} 仪表板",
    copiedOn: "复制于 {{date}}",
    refresh: "刷新",
    refreshing: "正在刷新…",
    refreshed: "图表已刷新",
    refreshFailed: "此图表未能刷新。",
    changed: "此副本创建后，该面板在 Analytics 中已更改。",
    changedRefresh: "此副本创建后，该面板在 Analytics 中已更改。刷新即可更新。",
    panelGone: "该面板在 Analytics 中已不存在。此副本保留原有的数据。",
    shareDetailUnread:
      "此页面包含尚未与其仪表板核对的 Analytics 图表。所有能打开此页面的人都会看到它们的数据。",
    truncated: "仅显示该面板的部分行。",
    unreadable: "无法读取此图表保存的副本，因此不显示。",
    adding: "正在从 Analytics 添加图表…",
    added: "图表已添加",
    addFailed: "无法添加此图表。",
    confirmWider:
      "能打开此页面的人比能打开 {{dashboard}} 仪表板的人多。所有能打开此页面的人都会看到此图表的数据。",
    addAnyway: "添加图表",
    keepLink: "保留链接",
    blockedPublic:
      "任何拥有链接的人都能打开此页面，但不能打开 {{dashboard}} 仪表板，因此无法在此添加它的面板。",
    blockedTable: "表格不能放入比其仪表板有更多人能打开的页面。",
    shareDetailOne:
      "此页面包含一个来自较少人能打开的仪表板的图表（{{dashboards}}）。所有能打开此页面的人都会看到它的数据。",
    shareDetail:
      "此页面包含 {{count}} 个来自较少人能打开的仪表板的图表（{{dashboards}}）。所有能打开此页面的人都会看到它们的数据。",
  },
  "zh-TW": {
    openInAnalytics: "在 Analytics 中開啟",
    dashboard: "{{dashboard}} 儀表板",
    copiedOn: "複製於 {{date}}",
    refresh: "重新整理",
    refreshing: "正在重新整理…",
    refreshed: "圖表已重新整理",
    refreshFailed: "此圖表未能重新整理。",
    changed: "建立此副本後，該面板在 Analytics 中已變更。",
    changedRefresh:
      "建立此副本後，該面板在 Analytics 中已變更。重新整理即可更新。",
    panelGone: "該面板在 Analytics 中已不存在。此副本保留原有的數字。",
    shareDetailUnread:
      "此頁面有尚未與其儀表板核對的 Analytics 圖表。所有能開啟此頁面的人都會看到它們的數字。",
    truncated: "僅顯示該面板的部分列。",
    unreadable: "無法讀取此圖表儲存的副本，因此不顯示。",
    adding: "正在從 Analytics 新增圖表…",
    added: "圖表已新增",
    addFailed: "無法新增此圖表。",
    confirmWider:
      "能開啟此頁面的人比能開啟 {{dashboard}} 儀表板的人多。所有能開啟此頁面的人都會看到此圖表的數字。",
    addAnyway: "新增圖表",
    keepLink: "保留連結",
    blockedPublic:
      "任何擁有連結的人都能開啟此頁面，但不能開啟 {{dashboard}} 儀表板，因此無法在此新增它的面板。",
    blockedTable: "表格不能放入比其儀表板有更多人能開啟的頁面。",
    shareDetailOne:
      "此頁面有一個來自較少人能開啟之儀表板的圖表（{{dashboards}}）。所有能開啟此頁面的人都會看到它的數字。",
    shareDetail:
      "此頁面有 {{count}} 個來自較少人能開啟之儀表板的圖表（{{dashboards}}）。所有能開啟此頁面的人都會看到它們的數字。",
  },
  "ja-JP": {
    openInAnalytics: "Analytics で開く",
    dashboard: "{{dashboard}} ダッシュボード",
    copiedOn: "{{date}} にコピー",
    refresh: "更新",
    refreshing: "更新中…",
    refreshed: "グラフを更新しました",
    refreshFailed: "このグラフを更新できませんでした。",
    changed:
      "このコピーを作成した後に、このパネルは Analytics で変更されました。",
    changedRefresh:
      "このコピーを作成した後に、このパネルは Analytics で変更されました。更新すると最新になります。",
    panelGone:
      "このパネルは Analytics にもう存在しません。このコピーには元の数値が残っています。",
    shareDetailUnread:
      "このページには、まだダッシュボードと照合していない Analytics のグラフがあります。ページを開ける全員がその数値を見られるようになります。",
    truncated: "パネルの行の一部を表示しています。",
    unreadable:
      "このグラフの保存済みコピーを読み取れないため、表示されません。",
    adding: "Analytics からグラフを追加しています…",
    added: "グラフを追加しました",
    addFailed: "このグラフを追加できませんでした。",
    confirmWider:
      "このページは {{dashboard}} ダッシュボードより多くの人が開けます。ページを開ける全員がこのグラフの数値を見られるようになります。",
    addAnyway: "グラフを追加",
    keepLink: "リンクのままにする",
    blockedPublic:
      "このページはリンクを知っている全員が開けますが、{{dashboard}} ダッシュボードはそうではないため、そのパネルはここに追加できません。",
    blockedTable:
      "表は、そのダッシュボードより多くの人が開けるページには追加できません。",
    shareDetailOne:
      "このページには、開ける人がより少ないダッシュボードのグラフがあります（{{dashboards}}）。ページを開ける全員がその数値を見られるようになります。",
    shareDetail:
      "このページには、開ける人がより少ないダッシュボードのグラフが {{count}} 件あります（{{dashboards}}）。ページを開ける全員がそれらの数値を見られるようになります。",
  },
  "ko-KR": {
    openInAnalytics: "Analytics에서 열기",
    dashboard: "{{dashboard}} 대시보드",
    copiedOn: "{{date}}에 복사됨",
    refresh: "새로고침",
    refreshing: "새로고침 중…",
    refreshed: "차트를 새로고침했습니다",
    refreshFailed: "이 차트를 새로고침하지 못했습니다.",
    changed: "이 사본을 만든 뒤 Analytics에서 이 패널이 변경되었습니다.",
    changedRefresh:
      "이 사본을 만든 뒤 Analytics에서 이 패널이 변경되었습니다. 새로고침하면 최신으로 바뀝니다.",
    panelGone:
      "이 패널은 Analytics에 더 이상 없습니다. 이 사본에는 기존 수치가 남아 있습니다.",
    shareDetailUnread:
      "이 페이지에는 아직 대시보드와 대조하지 않은 Analytics 차트가 있습니다. 페이지를 열 수 있는 모든 사람이 그 수치를 보게 됩니다.",
    truncated: "패널의 행 중 일부만 표시합니다.",
    unreadable: "이 차트의 저장된 사본을 읽을 수 없어 표시하지 않습니다.",
    adding: "Analytics에서 차트를 추가하는 중…",
    added: "차트를 추가했습니다",
    addFailed: "이 차트를 추가할 수 없습니다.",
    confirmWider:
      "이 페이지는 {{dashboard}} 대시보드보다 더 많은 사람이 열 수 있습니다. 페이지를 열 수 있는 모든 사람이 이 차트의 수치를 보게 됩니다.",
    addAnyway: "차트 추가",
    keepLink: "링크 유지",
    blockedPublic:
      "링크가 있는 누구나 이 페이지를 열 수 있지만 {{dashboard}} 대시보드는 열 수 없으므로 해당 패널을 여기에 추가할 수 없습니다.",
    blockedTable:
      "표는 해당 대시보드보다 더 많은 사람이 열 수 있는 페이지에 넣을 수 없습니다.",
    shareDetailOne:
      "이 페이지에는 더 적은 사람이 열 수 있는 대시보드의 차트가 있습니다({{dashboards}}). 페이지를 열 수 있는 모든 사람이 그 수치를 보게 됩니다.",
    shareDetail:
      "이 페이지에는 더 적은 사람이 열 수 있는 대시보드의 차트가 {{count}}개 있습니다({{dashboards}}). 페이지를 열 수 있는 모든 사람이 그 수치를 보게 됩니다.",
  },
  "hi-IN": {
    openInAnalytics: "Analytics में खोलें",
    dashboard: "{{dashboard}} डैशबोर्ड",
    copiedOn: "{{date}} को कॉपी किया गया",
    refresh: "रीफ़्रेश करें",
    refreshing: "रीफ़्रेश हो रहा है…",
    refreshed: "चार्ट रीफ़्रेश हुआ",
    refreshFailed: "यह चार्ट रीफ़्रेश नहीं हुआ।",
    changed: "यह कॉपी बनने के बाद Analytics में यह पैनल बदल गया।",
    changedRefresh:
      "यह कॉपी बनने के बाद Analytics में यह पैनल बदल गया। इसे अपडेट करने के लिए रीफ़्रेश करें।",
    panelGone:
      "यह पैनल अब Analytics में मौजूद नहीं है। इस कॉपी में पहले वाले आँकड़े बने रहते हैं।",
    shareDetailUnread:
      "इस पेज में Analytics के ऐसे चार्ट हैं जिन्हें अभी उनके डैशबोर्ड से जाँचा नहीं गया है। पेज खोल सकने वाले सभी लोग उनके आँकड़े देखेंगे।",
    truncated: "पैनल की कुछ ही पंक्तियाँ दिखाता है।",
    unreadable:
      "इस चार्ट की सहेजी गई कॉपी पढ़ी नहीं जा सकती, इसलिए यह नहीं दिखाया गया है।",
    adding: "Analytics से चार्ट जोड़ा जा रहा है…",
    added: "चार्ट जोड़ा गया",
    addFailed: "यह चार्ट नहीं जोड़ा जा सका।",
    confirmWider:
      "इस पेज को {{dashboard}} डैशबोर्ड से ज़्यादा लोग खोल सकते हैं। पेज खोल सकने वाला हर व्यक्ति इस चार्ट के आँकड़े देखेगा।",
    addAnyway: "चार्ट जोड़ें",
    keepLink: "लिंक रहने दें",
    blockedPublic:
      "लिंक वाला कोई भी व्यक्ति यह पेज खोल सकता है, लेकिन {{dashboard}} डैशबोर्ड नहीं, इसलिए उसके पैनल यहाँ नहीं जोड़े जा सकते।",
    blockedTable: "टेबल ऐसे पेज में नहीं जा सकती जिसे उसके डैशबोर्ड से ज़्यादा लोग खोल सकें।",
    shareDetailOne:
      "इस पेज में एक ऐसे डैशबोर्ड का चार्ट है जिसे कम लोग खोल सकते हैं ({{dashboards}})। पेज खोल सकने वाला हर व्यक्ति उसके आँकड़े देखेगा।",
    shareDetail:
      "इस पेज में ऐसे डैशबोर्ड के {{count}} चार्ट हैं जिन्हें कम लोग खोल सकते हैं ({{dashboards}})। पेज खोल सकने वाला हर व्यक्ति उनके आँकड़े देखेगा।",
  },
  "ar-SA": {
    openInAnalytics: "فتح في Analytics",
    dashboard: "لوحة {{dashboard}}",
    copiedOn: "نُسخ في {{date}}",
    refresh: "تحديث",
    refreshing: "جارٍ التحديث…",
    refreshed: "تم تحديث المخطط",
    refreshFailed: "لم يتم تحديث هذا المخطط.",
    changed: "تغيّرت هذه اللوحة في Analytics بعد إنشاء هذه النسخة.",
    changedRefresh:
      "تغيّرت هذه اللوحة في Analytics بعد إنشاء هذه النسخة. حدّثها لتصبح محدّثة.",
    panelGone:
      "لم تعد هذه اللوحة موجودة في Analytics. تحتفظ هذه النسخة بالأرقام التي كانت لديها.",
    shareDetailUnread:
      "تحتوي هذه الصفحة على مخططات من Analytics لم يتم التحقق منها بعد مقابل لوحاتها. سيرى كل من يمكنه فتح الصفحة أرقامها.",
    truncated: "يعرض جزءًا من صفوف اللوحة.",
    unreadable: "تعذّرت قراءة النسخة المحفوظة من هذا المخطط، لذا لا يُعرض.",
    adding: "جارٍ إضافة المخطط من Analytics…",
    added: "تمت إضافة المخطط",
    addFailed: "تعذّرت إضافة هذا المخطط.",
    confirmWider:
      "يمكن لعدد أكبر من الأشخاص فتح هذه الصفحة مقارنةً بلوحة {{dashboard}}. سيرى كل من يمكنه فتح الصفحة أرقام هذا المخطط.",
    addAnyway: "إضافة المخطط",
    keepLink: "الإبقاء على الرابط",
    blockedPublic:
      "يمكن لأي شخص لديه الرابط فتح هذه الصفحة، ولكن ليس لوحة {{dashboard}}، لذا لا يمكن إضافة مخططاتها هنا.",
    blockedTable:
      "لا يمكن وضع جدول في صفحة يمكن لعدد أكبر من الأشخاص فتحها مقارنةً بلوحته.",
    shareDetailOne:
      "تحتوي هذه الصفحة على مخطط من لوحة يمكن لعدد أقل من الأشخاص فتحها ({{dashboards}}). سيرى كل من يمكنه فتح الصفحة أرقامه.",
    shareDetail:
      "تحتوي هذه الصفحة على {{count}} مخططات من لوحات يمكن لعدد أقل من الأشخاص فتحها ({{dashboards}}). سيرى كل من يمكنه فتح الصفحة أرقامها.",
  },
};

export const analyticsChartMessagesByLocale: Record<
  BuiltinLocaleCode,
  AnalyticsChartMessages
> = {
  "en-US": en,
  ...translations,
};
