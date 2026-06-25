const messages = {
  root: {
    commandVideos: "视频",
    searchCompositions: "搜索合成",
    commandAppearance: "外观",
    toggleTheme: "切换主题",
  },
  header: {
    videos: "视频",
    components: "组件",
    designSystems: "设计系统",
    team: "团队",
    settings: "设置",
    extensions: "扩展",
    newComposition: "新建合成",
    studio: "工作室",
  },
  navigation: {
    settings: "设置",
    brand: "Videos",
    animations: "动画",
    components: "组件",
    designSystems: "设计系统",
    team: "团队",
  },
  settings: {
    title: "设置",
    description: "此应用的语言和工作区偏好设置。",
    languageTitle: "语言",
    languageDescription: "选择界面语言。此偏好会保存到你的账户。",
    languageLabel: "界面语言",
    workspaceTitle: "工作区",
    workspaceDescription: "管理团队成员、组织访问权限和共享工作区偏好。",
    openTeamSettings: "打开团队设置",
    openResourceSettings: "打开资源设置",
    agentTitle: "代理设置",
    agentDescription:
      "打开代理侧边栏设置，管理模型、API 密钥、自动化、语音和其他代理控制项。",
    openAgentSettings: "打开代理设置",
  },
  agent: {
    emptyState: "可以询问我任何关于视频的问题",
    suggestionLogo: "为 Acme 制作标志揭示动画",
    suggestionZoom: "给这个场景添加镜头缩放",
    suggestionSlow: "放慢开场动画",
  },
  sidebar: {
    navigation: "导航",
    openNavigation: "打开导航",
  },
  studio: {
    closeSidebar: "关闭侧边栏",
    openSidebar: "打开侧边栏",
    share: "分享",
    shareVideos: "分享视频",
    shareVideosDescription:
      "若要分享或导出视频，请连接云数据库，让你的合成可从任何地方访问。",
    compositions: "合成",
    properties: "属性",
  },
  newComposition: {
    runFailed: "代理运行失败，合成尚未创建。",
    readFailed: "无法读取附件。",
    startFailed: "无法启动合成请求。",
    button: "新建合成",
    title: "新建合成",
    description: "描述你想创建的视频",
    placeholder: "描述你想创建的视频...",
    timedOut:
      "The composition request timed out. Please try again from the sidebar.",
    generating: "Generating...",
  },
  notFound: {
    message: "This page doesn't exist yet. Continue prompting to build it out.",
    backToStudio: "Back to Studio",
  },
  designSystems: {
    new: "New Design System",
    setupBrand: "Set up your brand",
    emptyTitle: "Set up your brand identity",
    emptyDescription:
      "Create a design system with your brand colors, typography, and logos. Every new composition will follow your visual identity.",
  },
};

export default messages;
