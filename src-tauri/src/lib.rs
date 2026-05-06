use std::borrow::Cow;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::process::Command;
use std::sync::{Condvar, Mutex};
use std::time::SystemTime;
use tauri::Emitter;
use tauri::Manager;

static PENDING_FILE: Mutex<Option<String>> = Mutex::new(None);

// Allow up to N concurrent thumbnail generations via sips
const MAX_THUMBNAIL_CONCURRENCY: u32 = 3;
static THUMBNAIL_COUNT: Mutex<u32> = Mutex::new(0);
static THUMBNAIL_CV: Condvar = Condvar::new();

#[derive(serde::Serialize, Clone)]
struct SubdirInfo {
    name: String,
    path: String,
}

#[derive(serde::Serialize)]
struct FileInfo {
    size: u64,
    extension: String,
    modified: u64,
}

#[derive(serde::Serialize, Clone)]
struct ImageMeta {
    path: String,
    size: u64,
    extension: String,
    modified: u64,
}

#[derive(serde::Serialize)]
struct FolderContents {
    parent: Option<String>,
    subdirs: Vec<SubdirInfo>,
    images: Vec<String>,
    image_infos: Vec<ImageMeta>,
}

#[tauri::command]
fn list_folder_contents(folder_path: &str) -> Result<FolderContents, String> {
    let path = Path::new(folder_path);
    if !path.is_dir() {
        return Err("Not a directory".to_string());
    }

    let parent = path
        .parent()
        .and_then(|p| p.to_str())
        .map(|s| s.to_string());

    let valid_extensions = [
        "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "tiff", "tif", "heic", "heif",
    ];

    let mut images: Vec<String> = Vec::new();
    let mut image_infos: Vec<ImageMeta> = Vec::new();
    let mut subdirs: Vec<SubdirInfo> = Vec::new();

    let entries =
        std::fs::read_dir(path).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let entry_path = entry.path();

        if entry_path.is_dir() {
            if let Some(name) = entry_path.file_name().and_then(|n| n.to_str()) {
                if !name.starts_with('.') {
                    subdirs.push(SubdirInfo {
                        name: name.to_string(),
                        path: entry_path.to_string_lossy().to_string(),
                    });
                }
            }
        } else if entry_path.is_file() {
            if let Some(ext) = entry_path.extension().and_then(|e| e.to_str()) {
                if valid_extensions.contains(&ext.to_lowercase().as_str()) {
                    let path_str = entry_path.to_string_lossy().to_string();
                    let (file_size, file_modified) = std::fs::metadata(&entry_path)
                        .map(|m| {
                            let modified = m
                                .modified()
                                .ok()
                                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                                .map(|d| d.as_secs())
                                .unwrap_or(0);
                            (m.len(), modified)
                        })
                        .unwrap_or((0, 0));
                    image_infos.push(ImageMeta {
                        path: path_str.clone(),
                        size: file_size,
                        extension: ext.to_uppercase(),
                        modified: file_modified,
                    });
                    images.push(path_str);
                }
            }
        }
    }

    // Sort by filename by default
    let mut indexed: Vec<(usize, String, ImageMeta)> = images
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let info = image_infos[i].clone();
            (i, p.clone(), info)
        })
        .collect();

    indexed.sort_by(|(_, a, _), (_, b, _)| {
        let a_name = Path::new(a).file_name().map(|n| n.to_string_lossy().to_lowercase());
        let b_name = Path::new(b).file_name().map(|n| n.to_string_lossy().to_lowercase());
        a_name.cmp(&b_name)
    });

    images = indexed.iter().map(|(_, p, _)| p.clone()).collect();
    image_infos = indexed.iter().map(|(_, _, info)| info.clone()).collect();

    subdirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(FolderContents {
        parent,
        subdirs,
        images,
        image_infos,
    })
}

#[tauri::command]
fn list_recursive_images(folder_path: &str) -> Result<FolderContents, String> {
    let path = Path::new(folder_path);
    if !path.is_dir() {
        return Err("Not a directory".to_string());
    }

    let parent = path
        .parent()
        .and_then(|p| p.to_str())
        .map(|s| s.to_string());

    let valid_extensions = [
        "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "tiff", "tif", "heic", "heif",
    ];

    let mut images: Vec<String> = Vec::new();
    let mut image_infos: Vec<ImageMeta> = Vec::new();

    // Recursively collect images from folder_path and all nested subdirs
    let mut dirs_to_visit = vec![path.to_path_buf()];
    while let Some(dir) = dirs_to_visit.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if entry_path.is_dir() {
                if let Some(name) = entry_path.file_name().and_then(|n| n.to_str()) {
                    if !name.starts_with('.') {
                        dirs_to_visit.push(entry_path);
                    }
                }
            } else if entry_path.is_file() {
                if let Some(ext) = entry_path.extension().and_then(|e| e.to_str()) {
                    if valid_extensions.contains(&ext.to_lowercase().as_str()) {
                        let path_str = entry_path.to_string_lossy().to_string();
                        let (file_size, file_modified) = std::fs::metadata(&entry_path)
                            .map(|m| {
                                let modified = m
                                    .modified()
                                    .ok()
                                    .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                                    .map(|d| d.as_secs())
                                    .unwrap_or(0);
                                (m.len(), modified)
                            })
                            .unwrap_or((0, 0));
                        image_infos.push(ImageMeta {
                            path: path_str.clone(),
                            size: file_size,
                            extension: ext.to_uppercase(),
                            modified: file_modified,
                        });
                        images.push(path_str);
                    }
                }
            }
        }
    }

    // Sort by filename
    let mut indexed: Vec<(String, ImageMeta)> = images
        .iter()
        .zip(image_infos.iter().cloned())
        .map(|(p, info)| (p.clone(), info))
        .collect();

    indexed.sort_by(|(a, _), (b, _)| {
        let a_name = Path::new(a).file_name().map(|n| n.to_string_lossy().to_lowercase());
        let b_name = Path::new(b).file_name().map(|n| n.to_string_lossy().to_lowercase());
        a_name.cmp(&b_name)
    });

    images = indexed.iter().map(|(p, _)| p.clone()).collect();
    image_infos = indexed.iter().map(|(_, info)| info.clone()).collect();

    Ok(FolderContents {
        parent,
        subdirs: Vec::new(),
        images,
        image_infos,
    })
}

#[tauri::command]
fn get_file_info(file_path: &str) -> Result<FileInfo, String> {
    let path = Path::new(file_path);
    let metadata = std::fs::metadata(path)
        .map_err(|e| format!("Failed to read file metadata: {}", e))?;
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_uppercase();
    Ok(FileInfo {
        size: metadata.len(),
        extension,
        modified: metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0),
    })
}

#[derive(serde::Serialize)]
struct ImageDimensions {
    path: String,
    width: u32,
    height: u32,
}

/// Read EXIF Orientation tag (0x0112) from a JPEG file.
/// Returns 1-8, or 1 if not found / not a JPEG.
fn read_jpeg_orientation(path: &Path) -> u16 {
    let mut file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return 1,
    };
    let mut buf = vec![0u8; 65536];
    let n = match file.read(&mut buf) {
        Ok(n) if n >= 20 => n,
        _ => return 1,
    };

    // Find APP1 marker (FF E1) containing Exif
    let mut pos = 2usize; // skip SOI (FF D8)
    while pos + 4 < n {
        if buf[pos] != 0xFF {
            return 1;
        }
        let marker = buf[pos + 1];
        if marker == 0xE1 {
            // APP1 — check for "Exif\0\0"
            let len = ((buf[pos + 2] as usize) << 8) | (buf[pos + 3] as usize);
            let data_start = pos + 4;
            let data_end = (data_start + len - 2).min(n);
            if data_end > data_start + 6 && &buf[data_start..data_start + 6] == b"Exif\x00\x00" {
                let tiff_start = data_start + 6;
                if tiff_start + 8 > n {
                    return 1;
                }
                // Read byte order
                let little = &buf[tiff_start..tiff_start + 2] == b"II";
                // Read first IFD offset
                let ifd_offset = read_u32(&buf, tiff_start + 4, little) as usize;
                let ifd_start = tiff_start + ifd_offset;
                if ifd_start + 2 > n {
                    return 1;
                }
                let num_entries = read_u16(&buf, ifd_start, little) as usize;
                for i in 0..num_entries {
                    let entry_start = ifd_start + 2 + i * 12;
                    if entry_start + 12 > n {
                        return 1;
                    }
                    let tag = read_u16(&buf, entry_start, little);
                    let typ = read_u16(&buf, entry_start + 2, little);
                    let count = read_u32(&buf, entry_start + 4, little);
                    if tag == 0x0112 {
                        // Orientation is SHORT (type 3), value in 2 bytes
                        if typ == 3 && count == 1 {
                            return read_u16(&buf, entry_start + 8, little);
                        }
                    }
                }
            }
            return 1;
        }
        if marker == 0xD8 || marker == 0x00 {
            pos += 1;
            continue;
        }
        if marker >= 0xD0 && marker <= 0xD7 {
            // RST markers — no length field
            pos += 2;
            continue;
        }
        // Other markers: skip length field
        if pos + 2 >= n {
            break;
        }
        let seg_len = ((buf[pos + 2] as usize) << 8) | (buf[pos + 3] as usize);
        if seg_len < 2 {
            break;
        }
        pos += 2 + seg_len;
    }
    1
}

fn read_u16(buf: &[u8], offset: usize, little: bool) -> u16 {
    let b0 = buf[offset] as u16;
    let b1 = buf[offset + 1] as u16;
    if little {
        b0 | (b1 << 8)
    } else {
        (b0 << 8) | b1
    }
}

fn read_u32(buf: &[u8], offset: usize, little: bool) -> u32 {
    let b0 = buf[offset] as u32;
    let b1 = buf[offset + 1] as u32;
    let b2 = buf[offset + 2] as u32;
    let b3 = buf[offset + 3] as u32;
    if little {
        b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)
    } else {
        (b0 << 24) | (b1 << 16) | (b2 << 8) | b3
    }
}

#[tauri::command]
fn get_images_dimensions(file_paths: Vec<String>) -> Result<Vec<ImageDimensions>, String> {
    if file_paths.is_empty() {
        return Ok(Vec::new());
    }

    // For small batches, avoid thread creation overhead
    const MIN_BATCH_FOR_THREADS: usize = 8;
    if file_paths.len() < MIN_BATCH_FOR_THREADS {
        let mut results = Vec::with_capacity(file_paths.len());
        for path_str in &file_paths {
            let path = Path::new(path_str);
            let orientation = read_jpeg_orientation(path);
            let (mut w, mut h) = if let Ok(reader) = image::ImageReader::open(path) {
                if let Ok(reader) = reader.with_guessed_format() {
                    if let Ok(dimensions) = reader.into_dimensions() {
                        (dimensions.0, dimensions.1)
                    } else {
                        (0, 0)
                    }
                } else {
                    (0, 0)
                }
            } else {
                (0, 0)
            };
            // HEIC/HEIF fallback: use macOS sips when image crate cannot decode
            if w == 0 || h == 0 {
                if let Ok(output) = Command::new("sips")
                    .arg("-g").arg("pixelWidth")
                    .arg("-g").arg("pixelHeight")
                    .arg(path_str)
                    .output()
                {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    for line in stdout.lines() {
                        if let Some(val) = line.trim().strip_prefix("pixelWidth: ") {
                            w = val.parse().unwrap_or(0);
                        } else if let Some(val) = line.trim().strip_prefix("pixelHeight: ") {
                            h = val.parse().unwrap_or(0);
                        }
                    }
                }
            }
            // Swap dimensions if EXIF orientation includes 90° rotation (5-8)
            if orientation >= 5 && orientation <= 8 && w > 0 && h > 0 {
                (w, h) = (h, w);
            }
            results.push(ImageDimensions {
                path: path_str.clone(),
                width: w,
                height: h,
            });
        }
        return Ok(results);
    }

    let paths: std::sync::Arc<[String]> = std::sync::Arc::from(file_paths.into_boxed_slice());
    let num_threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(paths.len());

    let chunk_size = (paths.len() + num_threads - 1) / num_threads;

    std::thread::scope(|s| {
        let mut handles = Vec::with_capacity(num_threads);

        for t in 0..num_threads {
            let paths = std::sync::Arc::clone(&paths);
            let start = t * chunk_size;
            let end = ((t + 1) * chunk_size).min(paths.len());
            if start >= end {
                break;
            }
            handles.push((start, s.spawn(move || {
                let mut results = Vec::with_capacity(end - start);
                for idx in start..end {
                    let path_str = &paths[idx];
                    let path = Path::new(path_str);
                    let orientation = read_jpeg_orientation(path);
                    let (mut w, mut h) = if let Ok(reader) = image::ImageReader::open(path) {
                        if let Ok(reader) = reader.with_guessed_format() {
                            if let Ok(dimensions) = reader.into_dimensions() {
                                (dimensions.0, dimensions.1)
                            } else {
                                (0, 0)
                            }
                        } else {
                            (0, 0)
                        }
                    } else {
                        (0, 0)
                    };
                    // HEIC/HEIF fallback: use macOS sips when image crate cannot decode
                    if w == 0 || h == 0 {
                        if let Ok(output) = Command::new("sips")
                            .arg("-g").arg("pixelWidth")
                            .arg("-g").arg("pixelHeight")
                            .arg(path_str)
                            .output()
                        {
                            let stdout = String::from_utf8_lossy(&output.stdout);
                            for line in stdout.lines() {
                                if let Some(val) = line.trim().strip_prefix("pixelWidth: ") {
                                    w = val.parse().unwrap_or(0);
                                } else if let Some(val) = line.trim().strip_prefix("pixelHeight: ") {
                                    h = val.parse().unwrap_or(0);
                                }
                            }
                        }
                    }
                    if orientation >= 5 && orientation <= 8 && w > 0 && h > 0 {
                        (w, h) = (h, w);
                    }
                    results.push(ImageDimensions {
                        path: path_str.clone(),
                        width: w,
                        height: h,
                    });
                }
                results
            })));
        }

        // Sort handles by start index to preserve original order
        handles.sort_by_key(|(start, _)| *start);
        let mut all_results = Vec::with_capacity(paths.len());
        for (_, handle) in handles {
            all_results.extend(handle.join().unwrap());
        }
        Ok(all_results)
    })
}

#[tauri::command]
fn get_pending_file() -> Option<String> {
    let mut pending = PENDING_FILE.lock().unwrap();
    pending.take()
}

// RAII guard that releases a thumbnail concurrency slot on drop
struct ThumbnailSlot;

impl ThumbnailSlot {
    fn acquire() -> Self {
        let mut count = THUMBNAIL_COUNT.lock().unwrap();
        while *count >= MAX_THUMBNAIL_CONCURRENCY {
            count = THUMBNAIL_CV.wait(count).unwrap();
        }
        *count += 1;
        ThumbnailSlot
    }
}

impl Drop for ThumbnailSlot {
    fn drop(&mut self) {
        let mut count = THUMBNAIL_COUNT.lock().unwrap();
        *count -= 1;
        THUMBNAIL_CV.notify_one();
    }
}

#[tauri::command]
fn get_thumbnail(app: tauri::AppHandle, file_path: &str, max_size: u32) -> Result<String, String> {
    // Acquire a concurrency slot (up to MAX_THUMBNAIL_CONCURRENCY simultaneous sips),
    // then release it automatically when this function returns.
    let _slot = ThumbnailSlot::acquire();

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Failed to get cache dir: {}", e))?
        .join("thumbnails");

    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create cache dir: {}", e))?;

    // Hash the file path to create a stable cache key (xxh3 is stable across Rust versions)
    let hash = xxhash_rust::xxh3::xxh3_64(file_path.as_bytes());
    let cache_file = cache_dir.join(format!("{:x}_{}.jpg", hash, max_size));

    // Return cached thumbnail path if it already exists
    if cache_file.exists() {
        return Ok(cache_file.to_string_lossy().to_string());
    }

    // Generate thumbnail using macOS sips (hardware-accelerated, no full decode)
    let sips_size = max_size.to_string();
    let output = Command::new("sips")
        .arg("-Z")
        .arg(&sips_size)
        .arg(file_path)
        .arg("--out")
        .arg(&cache_file)
        .output()
        .map_err(|e| format!("Failed to run sips: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("sips failed: {}", stderr));
    }

    Ok(cache_file.to_string_lossy().to_string())
}

#[tauri::command]
fn copy_image_to_clipboard(file_path: &str) -> Result<(), String> {
    let path = std::path::Path::new(file_path);
    let is_heic = path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("heic") || e.eq_ignore_ascii_case("heif"))
        .unwrap_or(false);

    let img = if is_heic {
        // HEIC/HEIF: convert to temp PNG via sips, then decode with image crate
        let temp_path = std::env::temp_dir()
            .join(format!("spicy_clipboard_{}.png", std::process::id()));
        let output = Command::new("sips")
            .arg("-s").arg("format").arg("png")
            .arg(file_path)
            .arg("--out").arg(&temp_path)
            .output()
            .map_err(|e| format!("Failed to run sips: {}", e))?;
        if !output.status.success() {
            let _ = std::fs::remove_file(&temp_path);
            return Err(format!("sips conversion failed: {}",
                String::from_utf8_lossy(&output.stderr)));
        }
        let result = image::ImageReader::open(&temp_path)
            .map_err(|e| format!("Failed to open converted image: {}", e))?
            .decode()
            .map_err(|e| format!("Failed to decode converted image: {}", e))?;
        let _ = std::fs::remove_file(&temp_path);
        result
    } else {
        image::ImageReader::open(file_path)
            .map_err(|e| format!("Failed to open image: {}", e))?
            .decode()
            .map_err(|e| format!("Failed to decode image: {}", e))?
    };
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let data = rgba.into_raw();

    let mut clipboard = arboard::Clipboard::new()
        .map_err(|e| format!("Failed to access clipboard: {}", e))?;
    clipboard
        .set_image(arboard::ImageData {
            width: width as usize,
            height: height as usize,
            bytes: Cow::Owned(data),
        })
        .map_err(|e| format!("Failed to set clipboard image: {}", e))?;
    Ok(())
}

#[tauri::command]
fn reveal_in_finder(file_path: &str) -> Result<(), String> {
    Command::new("open")
        .arg("-R")
        .arg(file_path)
        .output()
        .map_err(|e| format!("Failed to reveal in Finder: {}", e))?;
    Ok(())
}

#[tauri::command]
fn move_to_trash(file_path: &str) -> Result<(), String> {
    trash::delete(file_path).map_err(|e| format!("Failed to move to trash: {}", e))?;
    Ok(())
}

#[tauri::command]
fn set_desktop_background(file_path: &str) -> Result<(), String> {
    let escaped = file_path.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "tell application \"Finder\" to set desktop picture to POSIX file \"{}\"",
        escaped
    );
    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("Failed to run osascript: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to set desktop background: {}", stderr));
    }
    Ok(())
}

fn url_to_file_path(url_str: &str) -> Option<String> {
    // Handle file:// URLs (macOS)
    if let Some(path) = url_str.strip_prefix("file://") {
        let decoded = urlencoding::decode(path).ok()?;
        return Some(decoded.into_owned());
    }
    // Already a file path
    if Path::new(url_str).exists() {
        return Some(url_str.to_string());
    }
    None
}

// Keep the display awake (macOS: spawn/kill caffeinate)
static CAFFEINATE: Mutex<Option<std::process::Child>> = Mutex::new(None);

#[tauri::command]
fn keep_awake(enable: bool) -> Result<(), String> {
    let mut guard = CAFFEINATE.lock().unwrap();
    if enable {
        // Check if the existing caffeinate process is still alive
        let needs_spawn = match guard.as_mut() {
            Some(child) => child.try_wait().map(|s| s.is_some()).unwrap_or(true),
            None => true,
        };
        if needs_spawn {
            // Drop any dead handle before spawning a new one
            *guard = None;
            let child = Command::new("/usr/bin/caffeinate")
                .arg("-dimsu")
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .map_err(|e| format!("caffeinate spawn failed: {}", e))?;
            *guard = Some(child);
        }
    } else {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_folder_contents,
            list_recursive_images,
            get_file_info,
            get_pending_file,
            get_thumbnail,
            get_images_dimensions,
            copy_image_to_clipboard,
            reveal_in_finder,
            move_to_trash,
            set_desktop_background,
            keep_awake
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::DragDrop(drag_event) = event {
                        if let tauri::DragDropEvent::Drop { paths, .. } = drag_event {
                            if let Some(path) = paths.first() {
                                let file_path = path.to_string_lossy().to_string();
                                *PENDING_FILE.lock().unwrap() = Some(file_path.clone());
                                let _ = app_handle.emit("file-opened", file_path);
                            }
                        }
                    }
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Opened { urls } = event {
                for url in &urls {
                    if let Some(file_path) = url_to_file_path(url.as_str()) {
                        // Store for cold start (frontend calls get_pending_file on mount)
                        let mut pending = PENDING_FILE.lock().unwrap();
                        *pending = Some(file_path.clone());

                        // Also emit for warm start (frontend already listening)
                        let _ = app_handle.emit("file-opened", file_path);
                    }
                }
            }
        });
}
