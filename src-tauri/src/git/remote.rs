//! Remotes as things in their own right: named, with a URL.
//!
//! The branch list only knows a remote through the branches fetched from it,
//! so a remote just added, or one that has never been fetched, would not
//! appear at all. `git remote -v` is the list of what is actually configured.

use super::cli::Git;
use crate::error::Result;

/// Every configured remote with its fetch URL, in git's order.
pub async fn urls(git: &Git) -> Result<Vec<(String, String)>> {
    let out = git.run_str(&["remote", "-v"]).await?;
    Ok(parse_urls(&out))
}

/// `git remote -v` prints two lines per remote, fetch and push. The fetch one
/// is what people mean by "the URL"; a separate push URL is rare and is left
/// to the terminal.
pub fn parse_urls(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|line| {
            let (name, rest) = line.split_once('\t')?;
            let url = rest.strip_suffix(" (fetch)")?;
            Some((name.to_string(), url.to_string()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_one_fetch_url_per_remote() {
        let text = "origin\tgit@github.com:a/b.git (fetch)\n\
                    origin\tgit@github.com:a/b.git (push)\n\
                    upstream\thttps://github.com/c/d.git (fetch)\n\
                    upstream\thttps://github.com/c/d.git (push)\n";

        assert_eq!(
            parse_urls(text),
            vec![
                ("origin".to_string(), "git@github.com:a/b.git".to_string()),
                (
                    "upstream".to_string(),
                    "https://github.com/c/d.git".to_string()
                ),
            ]
        );
    }
}
