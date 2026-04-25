use std::path::Path;
use std::sync::Mutex;
use tauri::Emitter;

static PENDING_FILE: Mutex<Option<String>> = Mutex::new(None);

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
fn get_pending_file() -> Option<String> {
    let mut pending = PENDING_FILE.lock().unwrap();
    pending.take()
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
        .invoke_handler(tauri::generate_handler![list_images_in_folder, get_pending_file])
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
