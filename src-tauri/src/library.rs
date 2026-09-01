//! Every repository the user has added, whether or not a tab is open on it.
//!
//! Separate from the session on purpose. The session is "what was open last
//! time" and is rewritten whenever a tab opens or closes; this is "what I work
//! on", which closing a tab must not touch. Keeping them in one file would make
//! closing the last tab indistinguishable from forgetting the repository.
//!
//! The display name is stored here rather than derived from the path, because
//! a folder called `api` in three different projects is three tabs called `api`.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, Result};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    /// Worktree root. Also the identity: two entries for one path are one
    /// repository, however they were added.
    pub path: String,
    /// What to call it. Empty means "whatever the folder is called", so a name
    /// that was never changed does not go stale when the folder is renamed.
    #[serde(default)]
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    #[serde(default)]
    pub repos: Vec<Bookmark>,
}

fn store_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::App(format!("no config directory available: {e}")))?;

    Ok(dir.join("repositories.json"))
}

/// Read the stored library.
///
/// A missing or unreadable file is a first run, not a failure. Starting empty
/// is the right recovery; refusing to launch over it is not.
pub async fn load(app: &AppHandle) -> Library {
    let Ok(path) = store_path(app) else {
        return Library::default();
    };

    let Ok(text) = tokio::fs::read_to_string(&path).await else {
        return Library::default();
    };

    serde_json::from_str(&text).unwrap_or_default()
}

pub async fn save(app: &AppHandle, library: &Library) -> Result<()> {
    let path = store_path(app)?;

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let text = serde_json::to_string_pretty(library)
        .map_err(|e| AppError::App(format!("could not encode the repository list: {e}")))?;

    tokio::fs::write(&path, text).await?;
    Ok(())
}
