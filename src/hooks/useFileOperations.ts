import { useState, useEffect, useCallback, type Dispatch, type SetStateAction, type MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LRUImageCache } from "../lruImageCache";
import type { ImageMetaRecord } from "../utils/sorting";

interface UseFileOperationsParams {
  currentFile: string | null;
  selectedIndices: Set<number>;
  setSelectedIndices: Dispatch<SetStateAction<Set<number>>>;
  imagesRef: MutableRefObject<string[]>;
  currentIndexRef: MutableRefObject<number>;
  imageMetaMapRef: MutableRefObject<Map<string, ImageMetaRecord>>;
  imageIndexMapRef: MutableRefObject<Map<string, number>>;
  imageCache: MutableRefObject<LRUImageCache>;
  loadImage: (filePath: string, reset: boolean) => void;
  setImages: Dispatch<SetStateAction<string[]>>;
  setCurrentIndex: Dispatch<SetStateAction<number>>;
  setImageUrl: Dispatch<SetStateAction<string | null>>;
  setCurrentFile: Dispatch<SetStateAction<string | null>>;
  imgW: MutableRefObject<number>;
  imgH: MutableRefObject<number>;
  sourceImg: MutableRefObject<HTMLImageElement | null>;
}

export function useFileOperations({
  currentFile, selectedIndices, setSelectedIndices,
  imagesRef, currentIndexRef,
  imageMetaMapRef, imageIndexMapRef, imageCache, loadImage,
  setImages, setCurrentIndex, setImageUrl, setCurrentFile,
  imgW, imgH, sourceImg,
}: UseFileOperationsParams) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!currentFile) return;
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    [currentFile],
  );

  const copyImage = useCallback(async () => {
    if (!currentFile) return;
    setContextMenu(null);
    try {
      await invoke("copy_image_to_clipboard", { filePath: currentFile });
    } catch (err) {
      console.error("Failed to copy image:", err);
    }
  }, [currentFile]);

  const setDesktopBackground = useCallback(async () => {
    if (!currentFile) return;
    setContextMenu(null);
    try {
      await invoke("set_desktop_background", { filePath: currentFile });
    } catch (err) {
      console.error("Failed to set desktop background:", err);
    }
  }, [currentFile]);

  const revealInFinder = useCallback(async () => {
    if (!currentFile) return;
    setContextMenu(null);
    try {
      await invoke("reveal_in_finder", { filePath: currentFile });
    } catch (err) {
      console.error("Failed to reveal in Finder:", err);
    }
  }, [currentFile]);

  const handleMoveToTrash = useCallback(async () => {
    if (!currentFile) return;
    const imgs = imagesRef.current;
    if (imgs.length === 0) return;
    setContextMenu(null);
    try {
      await invoke("move_to_trash", { filePath: currentFile });
    } catch (err) {
      console.error("Failed to move to trash:", err);
      return;
    }
    imageMetaMapRef.current.delete(currentFile);
    imageCache.current.delete(currentFile);

    const idx = imageIndexMapRef.current.get(currentFile) ?? -1;
    if (idx < 0) return; // file not in list
    const newImages = imgs.filter((_, i) => i !== idx);

    if (newImages.length === 0) {
      setImages([]);
      setCurrentIndex(0);
      setImageUrl(null);
      setCurrentFile(null);
      sourceImg.current = null;
      return;
    }

    const newIdx = idx >= newImages.length
      ? Math.max(0, newImages.length - 1)
      : idx;
    setImages(newImages);
    setCurrentIndex(newIdx);
    imgW.current = 0;
    imgH.current = 0;
    sourceImg.current = null;
    loadImage(newImages[newIdx], true);
  }, [currentFile, imagesRef, currentIndexRef, imageMetaMapRef, imageCache, loadImage, setImages, setCurrentIndex, setImageUrl, setCurrentFile, imgW, imgH, sourceImg]);

  const handleBatchDelete = useCallback(async () => {
    if (selectedIndices.size === 0) return;
    const imgs = imagesRef.current;
    const toDelete = [...selectedIndices].sort((a, b) => b - a);
    let hadErrors = false;
    for (const idx of toDelete) {
      if (idx < 0 || idx >= imgs.length) continue;
      const path = imgs[idx];
      try {
        await invoke("move_to_trash", { filePath: path });
      } catch {
        hadErrors = true;
        continue;
      }
      imageMetaMapRef.current.delete(path);
      imageCache.current.delete(path);
    }
    setSelectedIndices(new Set());
    if (hadErrors) return;

    const remaining = imgs.filter((_, i) => !selectedIndices.has(i));
    if (remaining.length === 0) {
      setImages([]);
      setCurrentIndex(0);
      setImageUrl(null);
      setCurrentFile(null);
      sourceImg.current = null;
      return;
    }
    const currentPath = currentFile;
    let newIdx = currentPath ? remaining.indexOf(currentPath) : -1;
    if (newIdx < 0) newIdx = Math.min(currentIndexRef.current, remaining.length - 1);
    setImages(remaining);
    setCurrentIndex(newIdx);
    imgW.current = 0; imgH.current = 0; sourceImg.current = null;
    loadImage(remaining[newIdx], true);
  }, [selectedIndices, currentFile, imagesRef, currentIndexRef, imageMetaMapRef, imageCache, loadImage, setImages, setCurrentIndex, setImageUrl, setCurrentFile, imgW, imgH, sourceImg, setSelectedIndices]);

  // Close context menu on outside interaction
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener("click", close);
    document.addEventListener("contextmenu", close);
    window.addEventListener("scroll", close, { capture: true });
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("contextmenu", close);
      window.removeEventListener("scroll", close, { capture: true });
    };
  }, [contextMenu]);

  return {
    contextMenu, setContextMenu,
    handleContextMenu, copyImage, setDesktopBackground,
    revealInFinder, handleMoveToTrash, handleBatchDelete,
  };
}
