//! User preferences.
//!
//! Stored as an opaque JSON document rather than a typed struct. Every setting
//! here belongs to the frontend — themes, keybindings, how many lines of diff
//! context to show — and giving the backend a mirrored type would mean editing
//! Rust to add a checkbox. The backend's job is to put the document somewhere
//! durable and give it back.

use std::path::PathBuf;

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, Result};

pub(crate) fn store_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::App(format!("no config directory available: {e}")))?;

    Ok(dir.join("settings.json"))
}

/// Read stored settings, or an empty document.
///
/// A missing file is a first run and a corrupt one is a file we should not have
/// written. Both recover to defaults rather than blocking the app from opening,
/// because settings are never worth failing a launch over.
pub async fn load(app: &AppHandle) -> Value {
    let Ok(path) = store_path(app) else {
        return Value::Object(Default::default());
    };

    let Ok(text) = tokio::fs::read_to_string(&path).await else {
        return Value::Object(Default::default());
    };

    serde_json::from_str(&text).unwrap_or_else(|_| Value::Object(Default::default()))
}

/// Whether the window should carry a title bar of its own.
///
/// GTK on Wayland always draws one, a strip with the app's name over a
/// window that already has a tab strip there. On a compositor that draws
/// its own decorations, or none, the bar is only in the way, so "auto" drops
/// it where the desktop says it is one of those. GNOME and the like keep it,
/// since without it there would be no close button. The setting overrides
/// either way; it is read before the window is shown.
pub fn wants_title_bar(settings: &Value, desktop: Option<&str>) -> bool {
    match settings["titleBar"].as_str() {
        Some("shown") => true,
        Some("hidden") => false,
        _ => !decorates_itself(desktop.unwrap_or_default()),
    }
}

/// Desktops whose compositor tiles and frames windows on its own.
fn decorates_itself(desktop: &str) -> bool {
    desktop
        .split(':')
        .map(|d| d.trim().to_ascii_lowercase())
        .any(|d| matches!(d.as_str(), "hyprland" | "sway" | "river" | "niri" | "dwl" | "mango" | "labwc"))
}

/// The stored settings, read synchronously: for the moment before the window
/// exists, when the async store is not yet convenient.
pub fn load_blocking(app: &AppHandle) -> Value {
    store_path(app)
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_else(|| Value::Object(Default::default()))
}

pub async fn save(app: &AppHandle, settings: &Value) -> Result<()> {
    let path = store_path(app)?;

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let text = serde_json::to_string_pretty(settings)
        .map_err(|e| AppError::App(format!("could not encode settings: {e}")))?;

    tokio::fs::write(&path, text).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_drops_the_bar_only_where_the_desktop_frames_windows_itself() {
        let auto = serde_json::json!({});
        assert!(!wants_title_bar(&auto, Some("Hyprland")));
        assert!(!wants_title_bar(&auto, Some("sway")));
        assert!(wants_title_bar(&auto, Some("GNOME")));
        assert!(wants_title_bar(&auto, Some("KDE")));
        assert!(wants_title_bar(&auto, None));
    }

    #[test]
    fn the_setting_overrides_the_desktop() {
        assert!(wants_title_bar(&serde_json::json!({"titleBar": "shown"}), Some("Hyprland")));
        assert!(!wants_title_bar(&serde_json::json!({"titleBar": "hidden"}), Some("GNOME")));
    }
}
