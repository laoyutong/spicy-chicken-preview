import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import Sidebar from "./Sidebar";
import FullscreenStrip from "./FullscreenStrip";
import { loadLanguage, t, translate, type Language } from "./i18n";
import "./App.css";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 10;
const ZOOM_STEP = 0.1;
const PAN_DEAD_ZONE = 3;

function loadTheme(): "dark" | "light" {
  try {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch { /* localStorage unavailable */ }
  return "dark";
}

function getFittedSize(
  imgW: number, imgH: number, cw: number, ch: number,
): { fw: number; fh: number } {
  if (imgW <= 0 || imgH <= 0) return { fw: cw, fh: ch };
  const imgAspect = imgW / imgH;
  const containerAspect = cw / ch;
  if (imgAspect > containerAspect) {
    return { fw: cw, fh: cw / imgAspect };
  }
  return { fw: ch * imgAspect, fh: ch };
}

interface SubdirInfo {
  name: string;
  path: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function clampPan(
  px: number, py: number, zoomVal: number,
  imgW: number, imgH: number, cw: number, ch: number,
): { x: number; y: number } {
  if (imgW <= 0 || imgH <= 0 || cw <= 0 || ch <= 0) return { x: 0, y: 0 };
  const { fw, fh } = getFittedSize(imgW, imgH, cw, ch);
  const sw = fw * zoomVal;
  const sh = fh * zoomVal;
  const maxX = Math.abs(sw - cw) / 2;
  const maxY = Math.abs(sh - ch) / 2;
  return {
    x: Math.max(-maxX, Math.min(maxX, px)),
    y: Math.max(-maxY, Math.min(maxY, py)),
  };
}

function App() {
  const [images, setImages] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [subdirs, setSubdirs] = useState<SubdirInfo[]>([]);
  const [theme, setTheme] = useState<"dark" | "light">(loadTheme);
  const [language, setLanguage] = useState<Language>(loadLanguage);
  const [fullscreen, setFullscreen] = useState(false);
  const [slideshowActive, setSlideshowActive] = useState(false);
  const [slideshowInterval, setSlideshowInterval] = useState(3);

  // Image preload cache
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());

  // Zoom & pan
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [dragging, setDragging] = useState(false);

  // File info for status bar
  const [imageDimensions, setImageDimensions] = useState<{ w: number; h: number } | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [fileFormat, setFileFormat] = useState<string | null>(null);

  const zoomRef = useRef(zoom);
  const panXRef = useRef(panX);
  const panYRef = useRef(panY);
  const imgW = useRef(0);
  const imgH = useRef(0);
  const sourceImg = useRef<HTMLImageElement | null>(null);
  const isPanning = useRef(false);
  const hasPanned = useRef(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const imageAreaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panXRef.current = panX; }, [panX]);
  useEffect(() => { panYRef.current = panY; }, [panY]);

  // Refs for slideshow auto-advance (avoid stale closures in setInterval)
  const imagesRef = useRef(images);
  useEffect(() => { imagesRef.current = images; }, [images]);
  const currentIndexRef = useRef(currentIndex);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);

  // ── Canvas rendering ──────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = imageAreaRef.current;
    const img = sourceImg.current;
    if (!canvas || !container || !img) return;

    const rect = container.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    if (cw <= 0 || ch <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(cw * dpr);
    const bh = Math.round(ch * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
      canvas.style.width = cw + "px";
      canvas.style.height = ch + "px";
    }

    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    const iw = imgW.current;
    const ih = imgH.current;
    if (iw <= 0 || ih <= 0) return;

    const z = zoomRef.current;
    const px = panXRef.current;
    const py = panYRef.current;

    const { fw, fh } = getFittedSize(iw, ih, cw, ch);
    const sw = fw * z;
    const sh = fh * z;

    // Top-left of the scaled image in viewport coordinates
    const imgLeft = cw / 2 - sw / 2 + px;
    const imgTop = ch / 2 - sh / 2 + py;

    // Clipped visible rectangle in viewport
    const vL = Math.max(0, imgLeft);
    const vT = Math.max(0, imgTop);
    const vR = Math.min(cw, imgLeft + sw);
    const vB = Math.min(ch, imgTop + sh);
    const vW = vR - vL;
    const vH = vB - vT;
    if (vW <= 0 || vH <= 0) return;

    // Map visible rectangle back to source-image coordinates
    const sL = (vL - imgLeft) / sw * iw;
    const sT = (vT - imgTop) / sh * ih;
    const sW = vW / sw * iw;
    const sH = vH / sh * ih;

    ctx.drawImage(img, sL, sT, sW, sH, vL, vT, vW, vH);
  }, []);

  // Redraw whenever zoom / pan / image / container changes
  useEffect(() => { draw(); }, [zoom, panX, panY, imageUrl, draw]);

  // Redraw on resize (container size changes)
  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  // ── Zoom helper ────────────────────────────────────────────────

  const zoomToward = useCallback((cx: number, cy: number, step: number) => {
    const container = imageAreaRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    if (cw <= 0 || ch <= 0) return;

    const oldZ = zoomRef.current;
    const newZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZ + step * oldZ));
    if (newZ === oldZ) return;

    const ratio = newZ / oldZ;
    const px = panXRef.current;
    const py = panYRef.current;
    const newPx = (cx - cw / 2) * (1 - ratio) + px * ratio;
    const newPy = (cy - ch / 2) * (1 - ratio) + py * ratio;

    const c = clampPan(newPx, newPy, newZ, imgW.current, imgH.current, cw, ch);
    setZoom(newZ);
    setPanX(c.x);
    setPanY(c.y);
  }, []);

  function getParentDir(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    const lastSlash = normalized.lastIndexOf("/");
    return lastSlash >= 0 ? normalized.substring(0, lastSlash) : normalized;
  }

  // ── Image loading ─────────────────────────────────────────────

  const resetView = useCallback(() => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }, []);

  // Preload adjacent images into cache for instant navigation
  const preloadAdjacent = useCallback(
    (index: number) => {
      const targets = [index - 1, index + 1];
      for (const i of targets) {
        if (i >= 0 && i < images.length) {
          const path = images[i];
          if (!imageCache.current.has(path)) {
            const img = new Image();
            img.src = convertFileSrc(path);
            imageCache.current.set(path, img);
          }
        }
      }
    },
    [images],
  );

  const loadImage = useCallback(
    async (filePath: string, reset: boolean) => {
      try {
        const url = convertFileSrc(filePath);
        setImageUrl(url);
        setCurrentFile(filePath);
        setError(null);
        if (reset) {
          resetView();
        }

        // Check cache first for instant display
        const cached = imageCache.current.get(filePath);
        if (cached && cached.complete && cached.naturalWidth > 0) {
          sourceImg.current = cached;
          imgW.current = cached.naturalWidth;
          imgH.current = cached.naturalHeight;
          setImageDimensions({ w: cached.naturalWidth, h: cached.naturalHeight });
          draw();
          invoke<{ size: number; extension: string }>("get_file_info", { filePath })
            .then((info) => { setFileSize(info.size); setFileFormat(info.extension); })
            .catch(() => { setFileSize(null); setFileFormat(null); });
          return;
        }

        // Load new image
        const img = new Image();
        img.onload = () => {
          sourceImg.current = img;
          imgW.current = img.naturalWidth;
          imgH.current = img.naturalHeight;
          setImageDimensions({ w: img.naturalWidth, h: img.naturalHeight });
          imageCache.current.set(filePath, img);
          draw();
          // Fetch file metadata for status bar
          invoke<{ size: number; extension: string }>("get_file_info", { filePath })
            .then((info) => { setFileSize(info.size); setFileFormat(info.extension); })
            .catch(() => { setFileSize(null); setFileFormat(null); });
          // Preload neighbours after current image loads
          const idx = images.indexOf(filePath);
          if (idx !== -1) preloadAdjacent(idx);
        };
        img.onerror = () => {
          setError("error.loadFailed");
          sourceImg.current = null;
        };
        img.src = url;
        sourceImg.current = null;
      } catch {
        setError("error.loadFailed");
      }
    },
    [resetView, draw, images, preloadAdjacent]
  );

  const loadFolder = useCallback(
    async (folderPath: string, selectFile?: string) => {
      try {
        const result: {
          parent: string | null;
          subdirs: SubdirInfo[];
          images: string[];
        } = await invoke("list_folder_contents", { folderPath });
        setCurrentFolder(folderPath);
        setImages(result.images);
        setSubdirs(result.subdirs);
        imgW.current = 0;
        imgH.current = 0;
        sourceImg.current = null;
        imageCache.current.clear();

        if (selectFile && result.images.includes(selectFile)) {
          const idx = result.images.indexOf(selectFile);
          setCurrentIndex(idx);
          await loadImage(selectFile, true);
        } else if (result.images.length > 0) {
          setCurrentIndex(0);
          await loadImage(result.images[0], true);
        } else {
          setCurrentIndex(0);
          setCurrentFile(null);
          setImageUrl(null);
        }
      } catch {
        setError("error.listFailed");
      }
    },
    [loadImage]
  );

  const openFile = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{
        name: "Images",
        extensions: [
          "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "tiff", "tif",
        ],
      }],
    });

    if (selected) {
      const folderPath = getParentDir(selected as string);
      await loadFolder(folderPath, selected as string);
    }
  }, [loadFolder]);

  const navigate = useCallback(
    (delta: number) => {
      if (images.length === 0) return;
      const newIndex = (currentIndex + delta + images.length) % images.length;
      setCurrentIndex(newIndex);
      imgW.current = 0;
      imgH.current = 0;
      sourceImg.current = null;
      loadImage(images[newIndex], true);
    },
    [images, currentIndex, loadImage]
  );

  const jumpTo = useCallback(
    (index: number) => {
      if (images.length === 0 || index === currentIndex) return;
      setCurrentIndex(index);
      imgW.current = 0;
      imgH.current = 0;
      sourceImg.current = null;
      loadImage(images[index], true);
    },
    [images, currentIndex, loadImage]
  );

  const navigateToFolder = useCallback(
    async (folderPath: string) => {
      await loadFolder(folderPath);
    },
    [loadFolder]
  );

  const navigateUp = useCallback(async () => {
    if (!currentFolder) return;
    const parentPath = getParentDir(currentFolder);
    if (parentPath && parentPath !== currentFolder) {
      await loadFolder(parentPath);
    }
  }, [currentFolder, loadFolder]);

  // Auto-show sidebar when a folder is loaded
  useEffect(() => {
    if (images.length > 0 || currentFolder) {
      setSidebarVisible(true);
    }
  }, [images, currentFolder]);

  // Sync theme attribute and meta tag
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("theme", theme); } catch { /* ignore */ }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", theme === "dark" ? "#080808" : "#faf8f5");
    }
  }, [theme]);

  // Sync language attribute and localStorage
  useEffect(() => {
    document.documentElement.lang = language;
    try { localStorage.setItem("language", language); } catch { /* ignore */ }
  }, [language]);

  // Slideshow auto-advance
  useEffect(() => {
    if (!slideshowActive || images.length === 0) return;
    const timer = setInterval(() => {
      const imgs = imagesRef.current;
      if (imgs.length === 0) return;
      const newIndex = (currentIndexRef.current + 1) % imgs.length;
      currentIndexRef.current = newIndex;
      setCurrentIndex(newIndex);
      imgW.current = 0;
      imgH.current = 0;
      sourceImg.current = null;
      loadImage(imgs[newIndex], true);
    }, slideshowInterval * 1000);
    return () => clearInterval(timer);
  }, [slideshowActive, slideshowInterval, images.length, loadImage]);

  // Sync fullscreen state with Tauri native window
  useEffect(() => {
    const win = getCurrentWebviewWindow();
    const setup = async () => {
      try {
        // Check initial fullscreen state on load
        const initial = await win.isFullscreen();
        setFullscreen(initial);

        // Listen for state changes (e.g., via native green button)
        const unlisten = await win.listen("tauri://resize", async () => {
          const fs = await win.isFullscreen();
          setFullscreen(fs);
        });
        return unlisten;
      } catch (e) {
        console.error("Fullscreen setup error:", e);
      }
    };
    const promise = setup();
    return () => {
      promise.then((unlisten) => unlisten?.());
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      const win = getCurrentWebviewWindow();
      const current = await win.isFullscreen();
      await win.setFullscreen(!current);
      setFullscreen(!current);
    } catch (e) {
      console.error("Toggle fullscreen error:", e);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  const cycleSlideshowInterval = useCallback(() => {
    const intervals = [2, 3, 5, 10];
    const idx = intervals.indexOf(slideshowInterval);
    setSlideshowInterval(intervals[(idx + 1) % intervals.length]);
  }, [slideshowInterval]);

  const toggleSlideshow = useCallback(() => {
    setSlideshowActive((a) => !a);
  }, []);

  // Keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Space: toggle slideshow (only if an image is loaded)
      if (e.key === " ") {
        if (imageUrl) {
          e.preventDefault();
          setSlideshowActive((a) => !a);
        }
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSlideshowActive(false);
        navigate(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setSlideshowActive(false);
        navigate(1);
      } else if (e.key === "0") {
        // 0 or Cmd/Ctrl+0: reset zoom
        e.preventDefault();
        resetView();
      } else if ((e.key === "=" || e.key === "+") && (e.metaKey || e.ctrlKey)) {
        // Cmd/Ctrl + =/+ : zoom in
        e.preventDefault();
        const el = imageAreaRef.current;
        if (el) {
          const r = el.getBoundingClientRect();
          zoomToward(r.width / 2, r.height / 2, ZOOM_STEP * 2);
        }
      } else if (e.key === "-" && (e.metaKey || e.ctrlKey)) {
        // Cmd/Ctrl + - : zoom out
        e.preventDefault();
        const el = imageAreaRef.current;
        if (el) {
          const r = el.getBoundingClientRect();
          zoomToward(r.width / 2, r.height / 2, -ZOOM_STEP * 2);
        }
      } else if (e.key === "b" && (e.metaKey || e.ctrlKey)) {
        // Cmd/Ctrl + B : toggle sidebar
        e.preventDefault();
        setSidebarVisible(v => !v);
      } else if (e.key === "f" || e.key === "F") {
        // F: toggle fullscreen
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, resetView, zoomToward, toggleFullscreen, imageUrl]);

  const loadOpenedFile = useCallback(
    async (filePath: string) => {
      const folderPath = getParentDir(filePath);
      await loadFolder(folderPath, filePath);
    },
    [loadFolder]
  );

  // File opened from outside (e.g., macOS "Open With")
  useEffect(() => {
    // Cold start: check for a file that was opened before the frontend was ready
    invoke<string | null>("get_pending_file").then(async (pendingPath) => {
      if (pendingPath) {
        await loadOpenedFile(pendingPath);
      }
    });

    // Warm start: listen for files opened while the app is already running
    const unlisten = listen<string>("file-opened", async (event) => {
      await loadOpenedFile(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [loadImage, loadOpenedFile]);

  // ── Wheel: zoom / pan ─────────────────────────────────────────

  useEffect(() => {
    const el = imageAreaRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (isPanning.current) return;
      if (!imageAreaRef.current) return;
      e.preventDefault();

      const isPinch = e.ctrlKey || e.metaKey;

      if (isPinch) {
        const step = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        zoomToward(e.clientX, e.clientY, step);
      } else {
        const rect = imageAreaRef.current.getBoundingClientRect();
        const newX = panXRef.current - e.deltaX;
        const newY = panYRef.current - e.deltaY;
        const c = clampPan(newX, newY, zoomRef.current, imgW.current, imgH.current, rect.width, rect.height);
        setPanX(c.x);
        setPanY(c.y);
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [zoomToward]);

  // ── Pointer: drag to pan ──────────────────────────────────────

  const panHandlers = useRef({
    handlePointerDown(e: React.PointerEvent) {
      e.preventDefault();
      isPanning.current = true;
      hasPanned.current = false;
      panStart.current = {
        x: e.clientX, y: e.clientY,
        panX: panXRef.current, panY: panYRef.current,
      };
      imageAreaRef.current?.setPointerCapture(e.pointerId);
    },

    handlePointerMove(e: React.PointerEvent) {
      if (!isPanning.current) return;
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (!hasPanned.current && dist < PAN_DEAD_ZONE) return;
      if (!hasPanned.current) { hasPanned.current = true; setDragging(true); }

      const el = imageAreaRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const newX = panStart.current.panX + dx;
      const newY = panStart.current.panY + dy;
      const c = clampPan(newX, newY, zoomRef.current, imgW.current, imgH.current, rect.width, rect.height);
      setPanX(c.x);
      setPanY(c.y);
    },

    handlePointerUp() {
      if (!isPanning.current) return;
      isPanning.current = false;
      hasPanned.current = false;
      setDragging(false);
    },
  }).current;

  const handleDoubleClick = () => toggleFullscreen();

  const fileName = currentFile
    ? currentFile.split(/[/\\]/).pop() || currentFile
    : "";

  const zoomPercent = Math.round(zoom * 100);
  const areaClass = "image-area" + (dragging ? " dragging" : imageUrl ? " grab" : "");

  return (
    <div className={`viewer${fullscreen ? " fullscreen" : ""}`}>
      <Sidebar
        images={images}
        currentIndex={currentIndex}
        onSelect={(index) => { setSlideshowActive(false); jumpTo(index); }}
        visible={sidebarVisible}
        currentFolder={currentFolder}
        subdirs={subdirs}
        parentPath={currentFolder ? getParentDir(currentFolder) : null}
        onNavigateFolder={navigateToFolder}
        onNavigateUp={navigateUp}
        language={language}
      />
      <div className="viewer-right">
        <div className="toolbar">
        <div className="toolbar-left">
          <button className="toolbar-btn" onClick={openFile} title={t("toolbar.openImage", language)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </button>
          {(images.length > 0 || currentFolder) && (
            <button
              className={`toolbar-btn${sidebarVisible ? " active" : ""}`}
              onClick={() => setSidebarVisible((v) => !v)}
              title={t("toolbar.toggleSidebar", language)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M10 3v18" />
                <rect x="5" y="7" width="3" height="3" fill="currentColor" />
                <rect x="5" y="12" width="3" height="3" fill="currentColor" />
                <rect x="5" y="17" width="3" height="1" fill="currentColor" />
              </svg>
            </button>
          )}
          {fileName && <span className="toolbar-filename">{fileName}</span>}
        </div>

        {images.length > 1 && (
          <div className="toolbar-center">
            <button className="toolbar-btn" onClick={() => navigate(-1)} title={t("toolbar.previous", language)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <span className="toolbar-counter">
              {currentIndex + 1} / {images.length}
            </span>
            <button className="toolbar-btn" onClick={() => navigate(1)} title={t("toolbar.next", language)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            <button
              className="toolbar-btn"
              onClick={toggleSlideshow}
              title={slideshowActive ? t("slideshow.pause", language) : t("slideshow.play", language)}
            >
              {slideshowActive ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <polygon points="6,3 20,12 6,21" />
                </svg>
              )}
            </button>
            <button
              className="toolbar-btn interval-btn"
              onClick={cycleSlideshowInterval}
              title={t("slideshow.interval", language)}
            >
              <span className="interval-label">{slideshowInterval}s</span>
            </button>
          </div>
        )}

        <div className="toolbar-right">
          <button className="toolbar-btn" onClick={() => setLanguage((l) => (l === "en" ? "zh" : "en"))} title={t("toolbar.switchLang", language)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </button>
          <button className="toolbar-btn" onClick={toggleTheme} title={theme === "dark" ? t("toolbar.switchToLight", language) : t("toolbar.switchToDark", language)}>
            {theme === "dark" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          <button
            className="toolbar-btn"
            onClick={toggleFullscreen}
            title={fullscreen ? t("toolbar.exitFullscreen", language) : t("toolbar.fullscreen", language)}
          >
            {fullscreen ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </button>
          {imageUrl && (
            <div className="zoom-controls">
              <button className="toolbar-btn" onClick={() => {
                const el = imageAreaRef.current;
                if (el) {
                  const r = el.getBoundingClientRect();
                  zoomToward(r.width / 2, r.height / 2, -ZOOM_STEP * 2);
                }
              }} title={t("toolbar.zoomOut", language)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" />
                </svg>
              </button>
              <span className="zoom-label" onClick={resetView} title={t("toolbar.resetZoom", language)}>{zoomPercent}%</span>
              <button className="toolbar-btn" onClick={() => {
                const el = imageAreaRef.current;
                if (el) {
                  const r = el.getBoundingClientRect();
                  zoomToward(r.width / 2, r.height / 2, ZOOM_STEP * 2);
                }
              }} title={t("toolbar.zoomIn", language)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      <div
        ref={imageAreaRef}
        className={areaClass}
        onDoubleClick={handleDoubleClick}
        onPointerDown={panHandlers.handlePointerDown}
        onPointerMove={panHandlers.handlePointerMove}
        onPointerUp={panHandlers.handlePointerUp}
        onPointerLeave={panHandlers.handlePointerUp}
        onPointerCancel={panHandlers.handlePointerUp}
      >
        {error ? (
          <div className="state-message">
            <p className="state-error">{translate(error, language)}</p>
            <p className="state-hint">{t("error.openAnother", language)}</p>
          </div>
        ) : imageUrl ? (
          <canvas ref={canvasRef} className="preview-canvas" />
        ) : currentFolder ? (
          <div className="state-message">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="state-icon">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <p className="state-text">{t("empty.noImages", language)}</p>
            {subdirs.length > 0 && (
              <p className="state-hint">{t("empty.selectSubfolder", language)}</p>
            )}
          </div>
        ) : (
          <div className="state-message">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="state-icon">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <p className="state-text">{t("empty.openPrompt", language)}</p>
            <p className="state-hint">{t("empty.hint", language)}</p>
          </div>
        )}
      </div>

      {imageUrl && !error && (
        <div className="status-bar">
          <div className="status-bar-left">
            {imageDimensions && (
              <span className="status-item">
                {imageDimensions.w} × {imageDimensions.h}
              </span>
            )}
            {fileSize !== null && (
              <span className="status-item">{formatFileSize(fileSize)}</span>
            )}
            {fileFormat && (
              <span className="status-item status-format">{fileFormat}</span>
            )}
          </div>
          <div className="status-bar-right">
            <span className="status-item status-zoom" onClick={resetView} title={t("toolbar.resetZoom", language)}>
              {zoomPercent}%
            </span>
          </div>
        </div>
      )}

      {fullscreen && images.length > 0 && (
        <FullscreenStrip
          images={images}
          currentIndex={currentIndex}
          onSelect={(index) => { setSlideshowActive(false); jumpTo(index); }}
          slideshowActive={slideshowActive}
          slideshowInterval={slideshowInterval}
          onToggleSlideshow={toggleSlideshow}
          onCycleInterval={cycleSlideshowInterval}
        />
      )}
      </div>
    </div>
  );
}

export default App;
