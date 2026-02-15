use std::path::Path;
use std::sync::Mutex;
use tauri::State;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|err| format!("Failed to read '{}': {}", path, err))
}

struct PendingFile(Mutex<Option<String>>);

fn is_supported_model_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lower = ext.to_ascii_lowercase();
            lower == "stl" || lower == "3mf"
        })
        .unwrap_or(false)
}

fn startup_file_from_args() -> Option<String> {
    std::env::args_os()
        .skip(1)
        .map(|arg| arg.to_string_lossy().to_string())
        .find(|arg| is_supported_model_path(arg))
}

#[tauri::command]
fn consume_pending_file(state: State<'_, PendingFile>) -> Option<String> {
    let mut pending = state.0.lock().ok()?;
    pending.take()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pending_file = startup_file_from_args();

    tauri::Builder::default()
        .manage(PendingFile(Mutex::new(pending_file)))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            read_file_bytes,
            consume_pending_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
