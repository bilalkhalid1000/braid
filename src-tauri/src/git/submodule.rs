use serde::Serialize;

use super::cli::Git;
use crate::error::Result;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SubmoduleState {
    /// Never initialized; the working directory is empty.
    Uninitialized,
    /// Checked out at exactly the commit the superproject records.
    UpToDate,
    /// Checked out at a different commit than the superproject records.
    Modified,
    /// Has merge conflicts.
    Conflicted,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Submodule {
    pub path: String,
    pub oid: String,
    /// `git describe` output for the checked-out commit, when git offers one.
    pub describe: Option<String>,
    pub state: SubmoduleState,
    pub url: Option<String>,
}

pub async fn list(git: &Git) -> Result<Vec<Submodule>> {
    // A repository with no submodules produces no output and exits 0, so no
    // special case is needed for the common path.
    let status = git.run_str(&["submodule", "status"]).await?;

    // URLs live in .gitmodules, which `submodule status` does not report.
    // A repository without the file is normal, so its absence is not an error.
    let config = git
        .run_str_allowing(
            &[
                "config",
                "--file",
                ".gitmodules",
                "--get-regexp",
                r"^submodule\..*\.url$",
            ],
            &[1, 128],
        )
        .await
        .unwrap_or_default();

    let urls = parse_urls(&config);
    let mut submodules = parse(&status);

    for submodule in &mut submodules {
        submodule.url = urls
            .iter()
            .find(|(name, _)| name == &submodule.path)
            .map(|(_, url)| url.clone());
    }

    Ok(submodules)
}

/// Parse `git submodule status`.
///
/// Each line is `<flag><sha1> <path>` with an optional ` (<describe>)` suffix.
/// The flag is a single leading character, and a space there means in sync —
/// so the first character must be read positionally, not by trimming.
pub fn parse(text: &str) -> Vec<Submodule> {
    text.lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let mut chars = line.chars();
            let flag = chars.next()?;

            let state = match flag {
                '-' => SubmoduleState::Uninitialized,
                '+' => SubmoduleState::Modified,
                'U' => SubmoduleState::Conflicted,
                _ => SubmoduleState::UpToDate,
            };

            let rest = &line[1..];
            let (oid, remainder) = rest.split_once(' ')?;

            // The describe suffix is parenthesised at the end; a path may
            // itself contain spaces, so split from the right.
            let (path, describe) = match remainder.rsplit_once(" (") {
                Some((path, describe)) => {
                    (path, Some(describe.trim_end_matches(')').to_string()))
                }
                None => (remainder, None),
            };

            Some(Submodule {
                path: path.to_string(),
                oid: oid.to_string(),
                describe,
                state,
                url: None,
            })
        })
        .collect()
}

/// Turn `submodule.<name>.url <value>` lines into `(name, url)` pairs.
///
/// The config name is used as the lookup key because it matches the submodule
/// path in every layout git creates by default.
fn parse_urls(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|line| {
            let (key, url) = line.split_once(' ')?;
            let name = key
                .strip_prefix("submodule.")?
                .strip_suffix(".url")?
                .to_string();

            Some((name, url.to_string()))
        })
        .collect()
}

/// Initialize and check out submodules.
///
/// An empty `path` updates every submodule, which is what the toolbar action
/// does; a specific path updates just that one.
pub async fn update(git: &Git, path: &str, recursive: bool) -> Result<String> {
    let mut args = vec!["submodule", "update", "--init"];
    if recursive {
        args.push("--recursive");
    }

    if !path.is_empty() {
        args.push("--");
        args.push(path);
    }

    git.run_reported(&args).await
}

/// Re-copy remote URLs from .gitmodules into the local config, which is what
/// you need after someone changes a submodule's remote upstream.
pub async fn sync(git: &Git, recursive: bool) -> Result<String> {
    let mut args = vec!["submodule", "sync"];
    if recursive {
        args.push("--recursive");
    }

    git.run_reported(&args).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn in_sync_submodule_has_a_leading_space() {
        let text = " abc123def vendor/lib (v1.2.0)";
        let subs = parse(text);

        assert_eq!(subs.len(), 1);
        assert_eq!(subs[0].state, SubmoduleState::UpToDate);
        assert_eq!(subs[0].oid, "abc123def");
        assert_eq!(subs[0].path, "vendor/lib");
        assert_eq!(subs[0].describe.as_deref(), Some("v1.2.0"));
    }

    #[test]
    fn reads_every_state_flag() {
        let text = concat!(
            "-abc123 vendor/uninit\n",
            "+def456 vendor/moved (heads/main)\n",
            "Ughi789 vendor/conflict\n",
            " jkl012 vendor/fine\n",
        );

        let subs = parse(text);
        assert_eq!(subs[0].state, SubmoduleState::Uninitialized);
        assert_eq!(subs[1].state, SubmoduleState::Modified);
        assert_eq!(subs[2].state, SubmoduleState::Conflicted);
        assert_eq!(subs[3].state, SubmoduleState::UpToDate);
    }

    #[test]
    fn uninitialized_submodule_has_no_describe() {
        let subs = parse("-abc123 vendor/uninit");
        assert_eq!(subs[0].path, "vendor/uninit");
        assert!(subs[0].describe.is_none());
    }

    #[test]
    fn path_with_spaces_is_not_split_by_the_describe_suffix() {
        let subs = parse(" abc123 vendor/my lib (v1.0)");
        assert_eq!(subs[0].path, "vendor/my lib");
        assert_eq!(subs[0].describe.as_deref(), Some("v1.0"));
    }

    #[test]
    fn empty_output_yields_nothing() {
        assert!(parse("").is_empty());
        assert!(parse("\n\n").is_empty());
    }

    #[test]
    fn reads_urls_from_gitmodules_config() {
        let text = concat!(
            "submodule.vendor/lib.url https://example.com/lib.git\n",
            "submodule.vendor/other.url git@example.com:other.git\n",
        );

        let urls = parse_urls(text);
        assert_eq!(urls.len(), 2);
        assert_eq!(urls[0].0, "vendor/lib");
        assert_eq!(urls[0].1, "https://example.com/lib.git");
        assert_eq!(urls[1].1, "git@example.com:other.git");
    }
}
