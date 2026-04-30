// LRU cache for HTMLImageElement with memory-based eviction.
// Each cache entry tracks the image's pixel count to estimate ~4 bytes/pixel RGBA memory.
// When total estimated memory exceeds the limit, least-recently-used entries are evicted.

interface CacheEntry {
  img: HTMLImageElement;
  pixels: number; // naturalWidth * naturalHeight
}

const MAX_ENTRIES = 12;
const MAX_MEMORY_MB = 300; // ~4 bytes/pixel, so ~75 megapixels

export class LRUImageCache {
  private map = new Map<string, CacheEntry>();
  private totalPixels = 0;

  get(key: string): HTMLImageElement | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    // Move to end (most-recently-used)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.img;
  }

  set(key: string, img: HTMLImageElement): void {
    const pixels = img.naturalWidth * img.naturalHeight;
    const existing = this.map.get(key);

    if (existing) {
      this.totalPixels -= existing.pixels;
      this.map.delete(key);
    }

    this.map.set(key, { img, pixels });
    this.totalPixels += pixels;

    this.evict();
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  delete(key: string): boolean {
    const entry = this.map.get(key);
    if (entry) {
      this.totalPixels -= entry.pixels;
      return this.map.delete(key);
    }
    return false;
  }

  clear(): void {
    this.map.clear();
    this.totalPixels = 0;
  }

  get size(): number {
    return this.map.size;
  }

  private evict(): void {
    const maxPixels = MAX_MEMORY_MB * 250_000; // ~250K pixels per MB at 4 bytes/pixel

    // Evict oldest entries first (head of insertion-ordered Map)
    while (this.map.size > MAX_ENTRIES || this.totalPixels > maxPixels) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      const entry = this.map.get(oldestKey)!;
      this.totalPixels -= entry.pixels;
      this.map.delete(oldestKey);
    }
  }
}
