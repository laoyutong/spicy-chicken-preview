import { useState, useEffect, useCallback, useRef, type MutableRefObject } from "react";

interface UseSlideshowParams {
  imagesRef: MutableRefObject<string[]>;
  currentIndexRef: MutableRefObject<number>;
  imageCount: number;
  setCurrentIndex: (index: number) => void;
  loadImage: (filePath: string, reset: boolean) => void;
  preloadAdjacent: (index: number) => void;
}

export function useSlideshow({
  imagesRef,
  currentIndexRef,
  imageCount,
  setCurrentIndex,
  loadImage,
  preloadAdjacent,
}: UseSlideshowParams) {
  const [slideshowActive, setSlideshowActive] = useState(false);
  const [slideshowInterval, setSlideshowInterval] = useState(3);

  // Keep refs in sync to avoid stale closures inside setInterval
  const slideshowActiveRef = useRef(slideshowActive);
  useEffect(() => { slideshowActiveRef.current = slideshowActive; }, [slideshowActive]);
  const slideshowIntervalRef = useRef(slideshowInterval);
  useEffect(() => { slideshowIntervalRef.current = slideshowInterval; }, [slideshowInterval]);

  const cycleSlideshowInterval = useCallback(() => {
    const intervals = [2, 3, 5, 10];
    const idx = intervals.indexOf(slideshowIntervalRef.current);
    setSlideshowInterval(intervals[(idx + 1) % intervals.length]);
  }, []);

  const toggleSlideshow = useCallback(() => {
    setSlideshowActive((a) => !a);
  }, []);

  const slideshowAdvance = useCallback(() => {
    const imgs = imagesRef.current;
    if (imgs.length === 0) return;
    const newIndex = (currentIndexRef.current + 1) % imgs.length;
    currentIndexRef.current = newIndex;
    setCurrentIndex(newIndex);
    preloadAdjacent(newIndex);
    loadImage(imgs[newIndex], true);
  }, [imagesRef, currentIndexRef, setCurrentIndex, loadImage, preloadAdjacent]);

  // Slideshow auto-advance timer
  useEffect(() => {
    if (!slideshowActive || imageCount === 0) return;
    const timer = setInterval(() => {
      slideshowAdvance();
    }, slideshowInterval * 1000);
    return () => clearInterval(timer);
  }, [slideshowActive, slideshowInterval, imageCount, slideshowAdvance]);

  return {
    slideshowActive,
    setSlideshowActive,
    slideshowInterval,
    setSlideshowInterval,
    toggleSlideshow,
    cycleSlideshowInterval,
  };
}
