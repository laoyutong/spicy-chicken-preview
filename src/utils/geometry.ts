export function getFittedSize(
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

export function clampPan(
  px: number, py: number, zoomVal: number,
  imgW: number, imgH: number, cw: number, ch: number,
  rotation: number = 0,
): { x: number; y: number } {
  if (imgW <= 0 || imgH <= 0 || cw <= 0 || ch <= 0) return { x: 0, y: 0 };
  // For 90/270 rotation, the canvas coordinate system is rotated so the
  // visual container appears swapped. Fit original image into swapped container
  // to match the draw logic in App.tsx.
  const isSwapped = rotation === 90 || rotation === 270;
  const fitW = isSwapped ? ch : cw;
  const fitH = isSwapped ? cw : ch;
  const { fw, fh } = getFittedSize(imgW, imgH, fitW, fitH);
  const sw = fw * zoomVal;
  const sh = fh * zoomVal;
  const maxX = Math.abs(sw - cw) / 2;
  const maxY = Math.abs(sh - ch) / 2;
  return {
    x: Math.max(-maxX, Math.min(maxX, px)),
    y: Math.max(-maxY, Math.min(maxY, py)),
  };
}
