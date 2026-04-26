import { useRef, useEffect, useState, useCallback } from "react";
import { CachedThumbnail } from "./thumbnailCache";

interface FullscreenStripProps {
  images: string[];
  currentIndex: number;
  onSelect: (index: number) => void;
}

export default function FullscreenStrip({ images, currentIndex, onSelect }: FullscreenStripProps) {
  const [visible, setVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const resetHideTimer = useCallback(() => {
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), 2000);
  }, []);

  // Auto-scroll to active item
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const activeItem = strip.children[currentIndex] as HTMLElement | undefined;
    if (activeItem) {
      activeItem.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [currentIndex]);

  // Show on mount, start hide timer
  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [resetHideTimer]);

  // Detect mouse near bottom of screen to show the strip
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const threshold = 100; // px from bottom
      if (e.clientY > window.innerHeight - threshold) {
        resetHideTimer();
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [resetHideTimer]);

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
          const fileName = filePath.split(/[/\\]/).pop() || filePath;
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
    </div>
  );
}
