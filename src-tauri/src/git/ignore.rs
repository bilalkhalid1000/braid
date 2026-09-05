//! Telling git to overlook a path: for everyone, or only here.

use tokio::fs;

use super::cli::Git;
use crate::error::Result;

/// Appends `path` to the repository's `.gitignore`, or with `local` to
/// `.git/info/exclude`, which has the same effect and is shared with nobody.
///
/// Written with a leading slash, so `README.md` ignores that file at the
/// root rather than every README.md in the tree.
pub async fn ignore(git: &Git, path: &str, local: bool) -> Result<String> {
    let file = if local {
        // Asked rather than assumed: in a worktree `.git` is a file and the
        // real directory is elsewhere.
        let relative = git
            .run_str(&["rev-parse", "--git-path", "info/exclude"])
            .await?;
        git.workdir().join(relative.trim())
    } else {
        git.workdir().join(".gitignore")
    };

    let existing = fs::read_to_string(&file).await.unwrap_or_default();
    let line = format!("/{}", path.trim_start_matches('/'));

    if existing.lines().any(|l| l == line) {
        return Ok(format!("{path} is already ignored"));
    }

    let mut out = existing;
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(&line);
    out.push('\n');

    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).await?;
    }
    fs::write(&file, out).await?;

    // An ignore does nothing for a file git already tracks, so the tracking
    // is dropped too: the file stays on disk, and its removal is staged.
    let tracked = git
        .run(&["ls-files", "--error-unmatch", "--", path])
        .await
        .is_ok();
    if tracked {
        git.run(&["rm", "--cached", "--quiet", "--", path]).await?;
    }

    Ok(format!(
        "Ignored {path} in {}{}",
        if local {
            ".git/info/exclude"
        } else {
            ".gitignore"
        },
        if tracked {
            " and stopped tracking it"
        } else {
            ""
        }
    ))
}
