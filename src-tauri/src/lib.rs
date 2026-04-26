use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use tauri::Emitter;
use tauri::Manager;

static PENDING_FILE: Mutex<Option<String>> = Mutex::new(None);
static THUMBNAIL_LOCK: Mutex<()> = Mutex::new(());

#[derive(serde::Serialize)]
struct SubdirInfo {
    name: String,
    path: String,
}

#[derive(serde::Serialize)]
struct FileInfo {
    size: u64,
    extension: String,
}

#[derive(serde::Serialize)]
struct FolderContents {
    parent: Option<String>,
    subdirs: Vec<SubdirInfo>,
    images: Vec<String>,
}

#[tauri::command]
fn list_images_in_folder(file_path: &str) -> Result<Vec<String>, String> {
    let path = Path::new(file_path);
    let parent_dir = path
        .parent()
        .ok_or_else(|| "Cannot find parent directory".to_string())?;

    let valid_extensions = [
        "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "tiff", "tif",
    ];

    let mut images: Vec<String> = Vec::new();

    let entries = std::fs::read_dir(parent_dir)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let entry_path = entry.path();

        if entry_path.is_file() {
            if let Some(ext) = entry_path.extension().and_then(|e| e.to_str()) {
                if valid_extensions.contains(&ext.to_lowercase().as_str()) {
                    images.push(entry_path.to_string_lossy().to_string());
                }
            }
        }
    }

    // Sort by filename for consistent navigation order
    images.sort_by(|a, b| {
        let a_name = Path::new(a).file_name().map(|n| n.to_string_lossy().to_lowercase());
        let b_name = Path::new(b).file_name().map(|n| n.to_string_lossy().to_lowercase());
        a_name.cmp(&b_name)
    });

    Ok(images)
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
        "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "tiff", "tif",
    ];

    let mut images: Vec<String> = Vec::new();
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
                    images.push(entry_path.to_string_lossy().to_string());
                }
            }
        }
    }

    subdirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    images.sort_by(|a, b| {
        let a_name = Path::new(a)
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase());
        let b_name = Path::new(b)
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase());
        a_name.cmp(&b_name)
    });

    Ok(FolderContents {
        parent,
        subdirs,
        images,
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
    })
}

#[tauri::command]
fn get_pending_file() -> Option<String> {
    let mut pending = PENDING_FILE.lock().unwrap();
    pending.take()
}

#[tauri::command]
fn get_thumbnail(app: tauri::AppHandle, file_path: &str, max_size: u32) -> Result<String, String> {
    // Serialize thumbnail generation — only one at a time to limit memory
    let _guard = THUMBNAIL_LOCK.lock().unwrap();

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Failed to get cache dir: {}", e))?
        .join("thumbnails");

    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create cache dir: {}", e))?;

    // Hash the file path to create a stable cache key
    let mut hasher = DefaultHasher::new();
    file_path.hash(&mut hasher);
    let hash = hasher.finish();
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_images_in_folder,
            list_folder_contents,
            get_file_info,
            get_pending_file,
            get_thumbnail
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
