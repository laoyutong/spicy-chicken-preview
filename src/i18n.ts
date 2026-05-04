export type Language = "en" | "zh";

const dict = {
  en: {
    "error.loadFailed": "Failed to load image",
    "error.listFailed": "Failed to list folder contents",
    "error.openAnother": "Use the toolbar button to open another image",
    "toolbar.openImage": "Open image",
    "toolbar.toggleSidebar": "Toggle sidebar (Cmd+B)",
    "toolbar.previous": "Previous (←)",
    "toolbar.next": "Next (→)",
    "toolbar.switchToLight": "Switch to light theme",
    "toolbar.switchToDark": "Switch to dark theme",
    "toolbar.switchLang": "Switch language",
    "toolbar.zoomOut": "Zoom out (Cmd+−)",
    "toolbar.zoomIn": "Zoom in (Cmd+=)",
    "toolbar.resetZoom": "Reset zoom (0 or Cmd+0)",
    "empty.noImages": "This folder contains no images",
    "empty.selectSubfolder": "Select a subfolder from the sidebar",
    "empty.openPrompt": "Click the folder icon to open an image",
    "empty.hint":
      "Scroll or Cmd+/− to zoom · Drag to pan · Double-click for immersive · F for fullscreen · 0 to reset · ← → to navigate",
    "toolbar.fullscreen": "Immersive (Double-click)",
    "toolbar.exitFullscreen": "Exit immersive (Esc or Double-click)",
    "toolbar.exitRecursive": "Exit recursive mode",
    "filter.all": "All",
    "filter.landscape": "Landscape",
    "filter.portrait": "Portrait",
    "slideshow.play": "Play slideshow (Space)",
    "slideshow.pause": "Pause slideshow (Space)",
    "slideshow.interval": "Change interval",
    "sidebar.upTo": "Up to {name}",
    "sidebar.recentFolders": "Recent",
    "sidebar.recursivePlay": "Recursive slideshow",
    "context.copyImage": "Copy Image",
    "context.rotate": "Rotate (R)",
    "context.setDesktopBackground": "Set as Desktop",
    "context.revealInFinder": "Show in Finder",
    "context.moveToTrash": "Move to Trash",
    "sort.name": "Name",
    "sort.size": "Size",
    "sort.dimensions": "Dimensions",
    "sort.aspect-ratio": "Aspect",
    "sort.format": "Format",
    "sort.modified": "Modified",
    "sort.ascending": "Ascending",
    "sort.descending": "Descending",
    "settings.title": "Settings",
    "settings.theme": "Theme",
    "settings.theme.dark": "Dark",
    "settings.theme.light": "Light",
    "settings.language": "Language",
    "settings.language.en": "English",
    "settings.language.zh": "中文",
    "settings.slideshow": "Slideshow interval",
    "settings.slideshow.2s": "2s",
    "settings.slideshow.3s": "3s",
    "settings.slideshow.5s": "5s",
    "settings.slideshow.10s": "10s",
    "settings.close": "Close",
  },
  zh: {
    "error.loadFailed": "图片加载失败",
    "error.listFailed": "文件夹内容读取失败",
    "error.openAnother": "使用工具栏按钮打开其他图片",
    "toolbar.openImage": "打开图片",
    "toolbar.toggleSidebar": "切换侧边栏 (Cmd+B)",
    "toolbar.previous": "上一张 (←)",
    "toolbar.next": "下一张 (→)",
    "toolbar.switchToLight": "切换到浅色主题",
    "toolbar.switchToDark": "切换到深色主题",
    "toolbar.switchLang": "切换语言",
    "toolbar.zoomOut": "缩小 (Cmd+−)",
    "toolbar.zoomIn": "放大 (Cmd+=)",
    "toolbar.resetZoom": "重置缩放 (0 或 Cmd+0)",
    "empty.noImages": "此文件夹中没有图片",
    "empty.selectSubfolder": "从侧边栏选择子文件夹",
    "empty.openPrompt": "点击文件夹图标打开图片",
    "empty.hint":
      "滚轮或 Cmd+/− 缩放 · 拖拽平移 · 双击沉浸 · F 窗口全屏 · 0 重置 · ← → 导航",
    "toolbar.fullscreen": "沉浸模式（双击）",
    "toolbar.exitFullscreen": "退出沉浸（Esc 或双击）",
    "toolbar.exitRecursive": "退出递归模式",
    "filter.all": "全部",
    "filter.landscape": "横图",
    "filter.portrait": "竖图",
    "slideshow.play": "播放幻灯片（空格）",
    "slideshow.pause": "暂停幻灯片（空格）",
    "slideshow.interval": "切换间隔",
    "sidebar.upTo": "返回 {name}",
    "sidebar.recentFolders": "最近访问",
    "sidebar.recursivePlay": "递归幻灯片",
    "context.copyImage": "拷贝图片",
    "context.rotate": "旋转 (R)",
    "context.setDesktopBackground": "设为桌面背景",
    "context.revealInFinder": "在访达中显示",
    "context.moveToTrash": "移到废纸篓",
    "sort.name": "名称",
    "sort.size": "文件大小",
    "sort.dimensions": "尺寸",
    "sort.aspect-ratio": "比例",
    "sort.format": "格式",
    "sort.modified": "修改时间",
    "sort.ascending": "升序",
    "sort.descending": "降序",
    "settings.title": "设置",
    "settings.theme": "主题",
    "settings.theme.dark": "深色",
    "settings.theme.light": "浅色",
    "settings.language": "语言",
    "settings.language.en": "English",
    "settings.language.zh": "中文",
    "settings.slideshow": "幻灯片间隔",
    "settings.slideshow.2s": "2 秒",
    "settings.slideshow.3s": "3 秒",
    "settings.slideshow.5s": "5 秒",
    "settings.slideshow.10s": "10 秒",
    "settings.close": "关闭",
  },
};

export function t(key: keyof typeof dict.en, lang: Language): string {
  return dict[lang][key];
}

export function translate(key: string | null, lang: Language): string {
  if (!key) return "";
  return (dict[lang] as Record<string, string>)[key] ?? key;
}

export function loadLanguage(): Language {
  try {
    const stored = localStorage.getItem("language");
    if (stored === "en" || stored === "zh") return stored;
  } catch {
    /* localStorage unavailable */
  }
  return "en";
}
