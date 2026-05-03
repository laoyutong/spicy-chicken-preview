import { useRef, useEffect, useLayoutEffect, useState, useCallback, useMemo } from "react";
import { CachedThumbnail } from "./thumbnailCache";

interface FullscreenStripProps {
  images: string[];
  currentIndex: number;
  onSelect: (index: number) => void;
  slideshowActive: boolean;
  slideshowInterval: number;
  onToggleSlideshow: () => void;
  onCycleInterval: () => void;
}

export default function FullscreenStrip({
  images, currentIndex, onSelect,
  slideshowActive, slideshowInterval,
  onToggleSlideshow, onCycleInterval,
}: FullscreenStripProps) {
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const resetHideTimer = useCallback(() => {
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), 2000);
  }, []);

  const mountedRef = useRef(false);

  // Snap to current item on mount (before paint), smooth-scroll on subsequent changes
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const activeItem = strip.children[currentIndex] as HTMLElement | undefined;
    if (!activeItem) return;

    const target = activeItem.offsetLeft - strip.offsetWidth / 2 + activeItem.offsetWidth / 2;

    if (!mountedRef.current) {
      // First mount: snap immediately, no animation
      mountedRef.current = true;
      strip.scrollLeft = target;
      return;
    }

    const start = strip.scrollLeft;
    const distance = target - start;
    if (Math.abs(distance) < 4) return;

    const duration = 300;
    const startTime = performance.now();
    const el = strip;

    function animate(now: number) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.scrollLeft = start + distance * eased;
      if (t < 1) requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
  }, [currentIndex]);

  // Show on mount, start hide timer
  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [resetHideTimer]);

  // Detect mouse near bottom of screen to show the strip (throttled)
  useEffect(() => {
    let lastCheck = 0;
    const handleMouseMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastCheck < 100) return;
      lastCheck = now;
      const threshold = 100; // px from bottom
      if (e.clientY > window.innerHeight - threshold) {
        resetHideTimer();
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [resetHideTimer]);

  const fileNames = useMemo(
    () => images.map((p) => p.split(/[/\\]/).pop() || p),
    [images],
  );

  if (images.length === 0) return null;

  return (
    <div
      className={`fullscreen-strip${visible ? " visible" : ""}`}
      onMouseMove={resetHideTimer}
      onMouseEnter={() => {
        setVisible(true);
        if (hideTimer.current) clearTimeout(hideTimer.current);
      }}
      onMouseLeave={() => {
        hideTimer.current = setTimeout(() => setVisible(false), 1000);
      }}
    >
      <div className="fullscreen-strip-list" ref={stripRef}>
        {images.map((filePath, index) => {
          const fileName = fileNames[index];
          return (
            <div
              key={filePath}
              className={`fullscreen-strip-item${index === currentIndex ? " active" : ""}`}
              onClick={() => onSelect(index)}
              title={fileName}
            >
              <CachedThumbnail filePath={filePath} eager />
              <span className="fullscreen-strip-name">{fileName}</span>
            </div>
          );
        })}
      </div>
      <div className="fullscreen-strip-controls">
        <button
          className="fullscreen-strip-btn"
          onClick={onToggleSlideshow}
          title={slideshowActive ? "Pause" : "Play"}
        >
          {slideshowActive ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <polygon points="6,3 20,12 6,21" />
            </svg>
          )}
        </button>
        <button
          className="fullscreen-strip-btn fullscreen-interval-btn"
          onClick={onCycleInterval}
          title="Change interval"
        >
          <span className="fullscreen-interval-label">{slideshowInterval}s</span>
        </button>
      </div>
    </div>
  );
}
