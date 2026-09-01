use std::path::Path;
use std::sync::Arc;

use dashmap::DashMap;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, Result};
use crate::git::Git;
use crate::watcher::RepoWatcher;

/// Emitted when a repo's on-disk state may have changed. The payload carries
/// only the id; the frontend decides what to refetch, so a change to a repo in
/// a background tab costs nothing until that tab is looked at.
pub const REPO_CHANGED_EVENT: &str = "repo://changed";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub id: String,
    pub name: String,
    pub root: String,
}

/// One open repository. Holds the live watcher, so dropping the session stops
/// all background work for that repo.
pub struct RepoSession {
    pub info: RepoInfo,
    pub git: Git,
    _watcher: RepoWatcher,
}

/// All open repositories, in a single process.
///
/// This is the structural reason the app should stay fast with many repos open:
/// each additional repo adds a map entry and one filesystem watch, not a
/// runtime, a process tree, or a polling timer.
#[derive(Default)]
pub struct RepoRegistry {
    repos: DashMap<String, Arc<RepoSession>>,
}

impl RepoRegistry {
    /// Open the repo containing `path`, or return the existing session if it is
    /// already open. Idempotent, so the UI can call it freely.
    pub async fn open(&self, app: &AppHandle, path: &Path) -> Result<RepoInfo> {
        let root = Git::discover(path).await?;
        let id = repo_id(&root);

        if let Some(existing) = self.repos.get(&id) {
            return Ok(existing.info.clone());
        }

        let name = root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| root.display().to_string());

        let info = RepoInfo {
            id: id.clone(),
            name,
            root: root.display().to_string(),
        };

        let watcher = {
            let app = app.clone();
            let id = id.clone();
            RepoWatcher::start(root.clone(), move || {
                let _ = app.emit(REPO_CHANGED_EVENT, &id);
            })?
        };

        let session = Arc::new(RepoSession {
            info: info.clone(),
            git: Git::new(&root),
            _watcher: watcher,
        });

        self.repos.insert(id, session);
        Ok(info)
    }

    pub fn get(&self, id: &str) -> Result<Arc<RepoSession>> {
        self.repos
            .get(id)
            .map(|r| Arc::clone(&r))
            .ok_or_else(|| AppError::UnknownRepo(id.to_string()))
    }

    pub fn close(&self, id: &str) {
        self.repos.remove(id);
    }

    pub fn list(&self) -> Vec<RepoInfo> {
        let mut repos: Vec<RepoInfo> = self.repos.iter().map(|r| r.info.clone()).collect();
        repos.sort_by(|a, b| a.name.cmp(&b.name));
        repos
    }
}

/// Use the normalized worktree root as the id. Opening the same repo twice
/// then naturally resolves to one session instead of two watchers on one tree.
fn repo_id(root: &Path) -> String {
    let s = root.to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        s.to_lowercase()
    } else {
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A path with the platform's own separator, built rather than written.
    fn path(text: &str) -> PathBuf {
        PathBuf::from(text.replace('/', std::path::MAIN_SEPARATOR_STR))
    }

    #[test]
    fn the_same_repository_gets_the_same_id_whatever_the_separators() {
        // Opening a repository twice must resolve to one session, or the
        // second open starts a second filesystem watcher on the same tree.
        let a = repo_id(&PathBuf::from("E:/Projects/api"));
        let b = repo_id(&PathBuf::from("E:\\Projects\\api"));

        assert_eq!(a, b);
    }

    #[test]
    fn different_repositories_keep_different_ids() {
        assert_ne!(
            repo_id(&PathBuf::from("E:/Projects/api")),
            repo_id(&PathBuf::from("E:/Projects/api2")),
        );
    }

    #[test]
    #[cfg(windows)]
    fn case_is_ignored_where_the_filesystem_ignores_it() {
        // The frontend's own path comparison lowercases too. If these two
        // disagree, one repository ends up with two entries in the list.
        assert_eq!(
            repo_id(&PathBuf::from("E:/Projects/API")),
            repo_id(&PathBuf::from("e:/projects/api")),
        );
    }

    #[test]
    #[cfg(not(windows))]
    fn case_is_kept_where_the_filesystem_keeps_it() {
        assert_ne!(
            repo_id(&PathBuf::from("/srv/API")),
            repo_id(&PathBuf::from("/srv/api")),
        );
    }

    #[test]
    fn an_id_never_contains_a_backslash() {
        // It travels to the frontend and back as a string, and is compared
        // there against paths written with forward slashes.
        let id = repo_id(&path("E:/Projects/api"));

        assert!(!id.contains('\\'), "got {id}");
    }
}
