//! Which repositories were open last time.
//!
//! The registry is in-memory by design — it owns live filesystem watchers, so
//! it cannot outlive the process. That means the list of open tabs has to be
//! written down somewhere, or every launch starts empty.
//!
//! Stored beside the app's own config rather than in webview storage, so it
//! survives a cleared cache and can be inspected or deleted by hand.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, Result};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    /// Worktree roots, in tab order.
    pub repos: Vec<String>,
    /// Id of the tab that was in front.
    pub active: Option<String>,
}

fn store_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::App(format!("no config directory available: {e}")))?;

    Ok(dir.join("session.json"))
}

/// Read the stored session.
///
/// A missing or unreadable file is not an error: it is a first run, or a file
/// written by an older version. Starting empty is the correct recovery, and
/// failing to launch over it would not be.
pub async fn load(app: &AppHandle) -> Session {
    let Ok(path) = store_path(app) else {
        return Session::default();
    };

    let Ok(text) = tokio::fs::read_to_string(&path).await else {
        return Session::default();
    };

    serde_json::from_str(&text).unwrap_or_default()
}

pub async fn save(app: &AppHandle, session: &Session) -> Result<()> {
    let path = store_path(app)?;

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let text = serde_json::to_string_pretty(session)
        .map_err(|e| AppError::App(format!("could not encode the session: {e}")))?;

    tokio::fs::write(&path, text).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(text: &str) -> Session {
        serde_json::from_str(text).unwrap_or_default()
    }

    #[test]
    fn keeps_the_order_tabs_were_shown_in() {
        // The order is the arrangement, not an accident of how they were
        // opened, and restoring it is how the strip comes back the same.
        let back = read(r#"{"repos":["c","a","b"],"active":"a"}"#);

        assert_eq!(back.repos, ["c", "a", "b"]);
        assert_eq!(back.active.as_deref(), Some("a"));
    }

    #[test]
    fn a_session_with_no_active_tab_is_fine() {
        let back = read(r#"{"repos":["a"],"active":null}"#);

        assert_eq!(back.repos.len(), 1);
        assert!(back.active.is_none());
    }

    #[test]
    fn a_corrupt_session_starts_empty_rather_than_failing() {
        assert!(read("{{{").repos.is_empty());
        assert!(read("").repos.is_empty());
    }

    #[test]
    fn round_trips() {
        let session = Session {
            repos: vec!["E:/a".into(), "E:/b".into()],
            active: Some("E:/b".into()),
        };

        let back = read(&serde_json::to_string(&session).unwrap());

        assert_eq!(back.repos, session.repos);
        assert_eq!(back.active, session.active);
    }
}
