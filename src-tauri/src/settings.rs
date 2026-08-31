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

fn store_path(app: &AppHandle) -> Result<PathBuf> {
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
