import { useRef, useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";

const thumbnailPathCache = new Map<string, string>();
const pendingRequests = new Map<string, Promise<string>>();

const THUMBNAIL_SIZE = 128;
const MIN_SIDEBAR_WIDTH = 140;
const MAX_SIDEBAR_WIDTH = 500;
const DEFAULT_SIDEBAR_WIDTH = 200;

function loadStoredWidth(): number {
  try {
    const stored = localStorage.getItem("sidebar-width");
    if (stored) {
      const v = parseInt(stored, 10);
      if (v >= MIN_SIDEBAR_WIDTH && v <= MAX_SIDEBAR_WIDTH) return v;
    }
  } catch { /* localStorage unavailable */ }
  return DEFAULT_SIDEBAR_WIDTH;
}

async function loadThumbnailPath(filePath: string): Promise<string> {
  const cached = thumbnailPathCache.get(filePath);
  if (cached) return cached;

  const pending = pendingRequests.get(filePath);
  if (pending) return pending;

  const promise = invoke<string>("get_thumbnail", {
    filePath,
    maxSize: THUMBNAIL_SIZE,
  }).then((cachePath) => {
    thumbnailPathCache.set(filePath, cachePath);
    pendingRequests.delete(filePath);
    return cachePath;
  }).catch((err) => {
    pendingRequests.delete(filePath);
    throw err;
  });

  pendingRequests.set(filePath, promise);
  return promise;
}

function CachedThumbnail({ filePath }: { filePath: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldLoad) return;
    let cancelled = false;
    loadThumbnailPath(filePath).then((cachePath) => {
      if (!cancelled) setSrc(convertFileSrc(cachePath));
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, [filePath, shouldLoad]);

  if (failed) {
    return <div className="sidebar-thumbnail sidebar-thumbnail-error">!</div>;
  }

  if (!src) {
    return <div ref={containerRef} className="sidebar-thumbnail sidebar-thumbnail-loading" />;
  }

  return (
    <div ref={containerRef} className="sidebar-thumbnail">
      <img src={src} alt="" />
    </div>
  );
}

interface ThumbnailItemProps {
  index: number;
  filePath: string;
  isActive: boolean;
  onSelect: (index: number) => void;
}

function ThumbnailItem({ index, filePath, isActive, onSelect }: ThumbnailItemProps) {
  const fileName = filePath.split(/[/\\]/).pop() || filePath;

  return (
    <div
      className={`sidebar-item${isActive ? " active" : ""}`}
      onClick={() => onSelect(index)}
      title={fileName}
    >
      <CachedThumbnail filePath={filePath} />
      <span className="sidebar-filename">{fileName}</span>
    </div>
  );
}

interface SidebarProps {
  images: string[];
  currentIndex: number;
  onSelect: (index: number) => void;
  visible: boolean;
}

export default function Sidebar({ images, currentIndex, onSelect, visible }: SidebarProps) {
  const activeRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(loadStoredWidth);
  const resizing = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  useEffect(() => {
    if (visible && activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [currentIndex, visible]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    resizing.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = sidebarWidth;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [sidebarWidth]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return;
    const delta = e.clientX - dragStartX.current;
    const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, dragStartWidth.current + delta));
    setSidebarWidth(newWidth);
  }, []);

  const handlePointerUp = useCallback(() => {
    if (!resizing.current) return;
    resizing.current = false;
    const finalWidth = sidebarWidth;
    try { localStorage.setItem("sidebar-width", String(finalWidth)); } catch { /* ignore */ }
  }, [sidebarWidth]);

  if (!visible || images.length === 0) return null;

  return (
    <div className="sidebar" style={{ width: sidebarWidth }}>
      <div className="sidebar-list">
        {images.map((filePath, index) => (
          <div
            key={filePath}
            ref={index === currentIndex ? activeRef : undefined}
          >
            <ThumbnailItem
              index={index}
              filePath={filePath}
              isActive={index === currentIndex}
              onSelect={onSelect}
            />
          </div>
        ))}
      </div>
      <div
        className="sidebar-resize-handle"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </div>
  );
}
