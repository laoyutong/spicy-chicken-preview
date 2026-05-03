import { useRef, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";

export const THUMBNAIL_SIZE = 128;

const MAX_THUMBNAIL_PATH_CACHE = 200;

const thumbnailPathCache = new Map<string, string>();
const pendingRequests = new Map<string, Promise<string>>();

function cacheThumbnailPath(filePath: string, cachePath: string): void {
  // Evict oldest entry if at capacity (Map preserves insertion order)
  if (thumbnailPathCache.size >= MAX_THUMBNAIL_PATH_CACHE) {
    const oldest = thumbnailPathCache.keys().next().value;
    if (oldest !== undefined) thumbnailPathCache.delete(oldest);
  }
  thumbnailPathCache.set(filePath, cachePath);
}

export async function loadThumbnailPath(filePath: string): Promise<string> {
  const cached = thumbnailPathCache.get(filePath);
  if (cached) {
    // Move to end to mark as recently used
    thumbnailPathCache.delete(filePath);
    thumbnailPathCache.set(filePath, cached);
    return cached;
  }

  const pending = pendingRequests.get(filePath);
  if (pending) return pending;

  const promise = invoke<string>("get_thumbnail", {
    filePath,
    maxSize: THUMBNAIL_SIZE,
  }).then((cachePath) => {
    cacheThumbnailPath(filePath, cachePath);
    pendingRequests.delete(filePath);
    return cachePath;
  }).catch((err) => {
    pendingRequests.delete(filePath);
    throw err;
  });

  pendingRequests.set(filePath, promise);
  return promise;
}

interface CachedThumbnailProps {
  filePath: string;
  eager?: boolean;
}

export function CachedThumbnail({ filePath, eager }: CachedThumbnailProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (eager) {
      setShouldLoad(true);
      return;
    }
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
  }, [eager]);

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
    return (
      <div className="sidebar-thumbnail sidebar-thumbnail-error">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      </div>
    );
  }

  if (!src) {
    return (
      <div ref={containerRef} className="sidebar-thumbnail sidebar-thumbnail-loading">
        <svg className="thumbnail-placeholder-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="sidebar-thumbnail">
      <img src={src} alt="" />
    </div>
  );
}
