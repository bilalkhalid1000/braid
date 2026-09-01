use serde::{Deserialize, Serialize};

use super::cli::Git;
use crate::error::{AppError, Result};

/// Git flow, implemented directly on top of plain git rather than by shelling
/// out to the `git-flow` extension.
///
/// The extension is not installed by default anywhere, and requiring it would
/// make the button fail for most people who press it. Configuration is read and
/// written using the extension's own `gitflow.*` keys, so a repository set up
/// here works with the command line tool and vice versa.

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FlowKind {
    Feature,
    Bugfix,
    Release,
    Hotfix,
    Support,
}

impl FlowKind {
    fn prefix<'a>(&self, config: &'a FlowConfig) -> &'a str {
        match self {
            FlowKind::Feature => &config.feature,
            FlowKind::Bugfix => &config.bugfix,
            FlowKind::Release => &config.release,
            FlowKind::Hotfix => &config.hotfix,
            FlowKind::Support => &config.support,
        }
    }

    /// Where a new branch of this kind is cut from.
    ///
    /// Hotfixes and support branches start from the production branch, because
    /// they exist to repair what is released. Everything else starts from
    /// develop.
    fn base<'a>(&self, config: &'a FlowConfig) -> &'a str {
        match self {
            FlowKind::Hotfix | FlowKind::Support => &config.master,
            _ => &config.develop,
        }
    }

    /// Whether finishing lands on the production branch and gets a tag.
    fn is_release(&self) -> bool {
        matches!(self, FlowKind::Release | FlowKind::Hotfix)
    }

    pub fn label(&self) -> &'static str {
        match self {
            FlowKind::Feature => "feature",
            FlowKind::Bugfix => "bugfix",
            FlowKind::Release => "release",
            FlowKind::Hotfix => "hotfix",
            FlowKind::Support => "support",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FlowConfig {
    pub master: String,
    pub develop: String,
    pub feature: String,
    pub bugfix: String,
    pub release: String,
    pub hotfix: String,
    pub support: String,
    /// Prepended to the version when tagging a finished release or hotfix.
    /// Commonly empty or "v".
    pub versiontag: String,
}

impl Default for FlowConfig {
    fn default() -> Self {
        Self {
            master: "main".into(),
            develop: "develop".into(),
            feature: "feature/".into(),
            bugfix: "bugfix/".into(),
            release: "release/".into(),
            hotfix: "hotfix/".into(),
            support: "support/".into(),
            versiontag: String::new(),
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CurrentFlow {
    pub kind: FlowKind,
    /// The part after the prefix: "login" for "feature/login".
    pub name: String,
    pub branch: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FlowStatus {
    pub initialized: bool,
    pub config: FlowConfig,
    /// Set when HEAD is sitting on a flow branch, which is what makes a
    /// "finish" action available.
    pub current: Option<CurrentFlow>,
    /// Whether the configured develop and production branches actually exist.
    pub develop_exists: bool,
    pub master_exists: bool,
}

/// Tagging is the default for a release or hotfix: it is the point of
/// finishing one, and a settings file written before the option existed still
/// means "tag it".
fn yes() -> bool {
    true
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FinishOptions {
    pub delete_branch: bool,
    /// Delete even if git thinks the branch is not fully merged. The ordinary
    /// delete refuses in that case, which is usually right and occasionally
    /// just in the way.
    #[serde(default)]
    pub force_delete: bool,
    pub push: bool,
    /// Whether to tag at all. A release or hotfix is tagged by default because
    /// that is the point of finishing one, but git flow can skip it and so can
    /// this.
    #[serde(default = "yes")]
    pub tag: bool,
    /// Used as the annotated tag message on a release or hotfix. Falls back to
    /// the version when empty.
    pub tag_message: String,
}

pub async fn status(git: &Git) -> Result<FlowStatus> {
    let (config, initialized) = read_config(git).await?;

    let branch = git
        .run_str(&["rev-parse", "--abbrev-ref", "HEAD"])
        .await
        .unwrap_or_default();

    let current = if initialized {
        detect(&config, &branch)
    } else {
        None
    };

    Ok(FlowStatus {
        develop_exists: branch_exists(git, &config.develop).await?,
        master_exists: branch_exists(git, &config.master).await?,
        initialized,
        current,
        config,
    })
}

/// Read `gitflow.*` config, falling back to the extension's own defaults.
///
/// Returns whether the repository has been initialized: both branch names must
/// be recorded, since the prefixes alone carry no meaning.
async fn read_config(git: &Git) -> Result<(FlowConfig, bool)> {
    // Exit code 1 simply means no key matched, which is an uninitialized repo.
    let raw = git
        .run_str_allowing(&["config", "--get-regexp", r"^gitflow\."], &[1])
        .await
        .unwrap_or_default();

    let mut config = FlowConfig::default();
    let mut has_master = false;
    let mut has_develop = false;

    for line in raw.lines() {
        // An empty value is legitimate — `versiontag` usually is — and git
        // prints those with nothing after the key.
        let (key, value) = line.split_once(' ').unwrap_or((line, ""));

        match key {
            "gitflow.branch.master" => {
                config.master = value.to_string();
                has_master = true;
            }
            "gitflow.branch.develop" => {
                config.develop = value.to_string();
                has_develop = true;
            }
            "gitflow.prefix.feature" => config.feature = value.to_string(),
            "gitflow.prefix.bugfix" => config.bugfix = value.to_string(),
            "gitflow.prefix.release" => config.release = value.to_string(),
            "gitflow.prefix.hotfix" => config.hotfix = value.to_string(),
            "gitflow.prefix.support" => config.support = value.to_string(),
            "gitflow.prefix.versiontag" => config.versiontag = value.to_string(),
            _ => {}
        }
    }

    let initialized = has_master && has_develop;

    // Offer the branch they are actually on as the production branch, so the
    // setup dialog does not propose "main" to someone whose trunk is "master".
    if !initialized {
        if let Ok(branch) = git.run_str(&["rev-parse", "--abbrev-ref", "HEAD"]).await {
            if !branch.is_empty() && branch != "HEAD" {
                config.master = branch;
            }
        }
    }

    Ok((config, initialized))
}

/// Match a branch name against the configured prefixes.
///
/// The longest match wins, so a configuration where one prefix begins with
/// another still resolves to the more specific kind.
fn detect(config: &FlowConfig, branch: &str) -> Option<CurrentFlow> {
    let kinds = [
        FlowKind::Feature,
        FlowKind::Bugfix,
        FlowKind::Release,
        FlowKind::Hotfix,
        FlowKind::Support,
    ];

    kinds
        .into_iter()
        .map(|kind| (kind, kind.prefix(config)))
        .filter(|(_, prefix)| !prefix.is_empty() && branch.starts_with(*prefix))
        .max_by_key(|(_, prefix)| prefix.len())
        .map(|(kind, prefix)| CurrentFlow {
            kind,
            name: branch[prefix.len()..].to_string(),
            branch: branch.to_string(),
        })
}

pub async fn init(git: &Git, config: &FlowConfig) -> Result<String> {
    let mut log = Vec::new();

    for (key, value) in [
        ("gitflow.branch.master", &config.master),
        ("gitflow.branch.develop", &config.develop),
        ("gitflow.prefix.feature", &config.feature),
        ("gitflow.prefix.bugfix", &config.bugfix),
        ("gitflow.prefix.release", &config.release),
        ("gitflow.prefix.hotfix", &config.hotfix),
        ("gitflow.prefix.support", &config.support),
        ("gitflow.prefix.versiontag", &config.versiontag),
    ] {
        git.run(&["config", key, value]).await?;
    }

    log.push(format!(
        "Production branch {}, development branch {}",
        config.master, config.develop
    ));

    if !branch_exists(git, &config.develop).await? {
        let base = if branch_exists(git, &config.master).await? {
            config.master.as_str()
        } else {
            // A repository whose trunk is not yet named as configured: branch
            // from wherever HEAD is instead of refusing to set up.
            "HEAD"
        };

        run_step(
            git,
            &["branch", &config.develop, base],
            &format!("Create {} from {}", config.develop, base),
            &mut log,
        )
        .await?;
    }

    Ok(log.join("\n"))
}

pub async fn start(git: &Git, kind: FlowKind, name: &str) -> Result<String> {
    let (config, initialized) = read_config(git).await?;
    require_initialized(initialized)?;

    let branch = format!("{}{}", kind.prefix(&config), name);
    let base = kind.base(&config);

    if !branch_exists(git, base).await? {
        return Err(AppError::Git {
            code: 1,
            stderr: format!(
                "Cannot start a {}: the branch it is cut from, {base}, does not exist.",
                kind.label()
            ),
        });
    }

    let mut log = Vec::new();
    run_step(
        git,
        &["checkout", "-b", &branch, base],
        &format!("Create {branch} from {base}"),
        &mut log,
    )
    .await?;

    Ok(log.join("\n"))
}

/// Merge a finished branch back where it belongs, tag it if it is a release,
/// and clean it up.
///
/// Every step reports what it did, and a failure carries the steps that already
/// succeeded — half-finished is the normal outcome of a merge conflict here,
/// and the user needs to know exactly where it stopped.
pub async fn finish(
    git: &Git,
    kind: FlowKind,
    name: &str,
    options: &FinishOptions,
) -> Result<String> {
    let (config, initialized) = read_config(git).await?;
    require_initialized(initialized)?;

    if kind == FlowKind::Support {
        return Err(AppError::Git {
            code: 1,
            stderr: "Support branches are long-lived and are never finished.".into(),
        });
    }

    let branch = format!("{}{}", kind.prefix(&config), name);
    let mut log = Vec::new();
    let mut pushed: Vec<String> = Vec::new();

    // A release or hotfix lands on production first, gets tagged there, and is
    // then merged back so develop keeps the fix.
    let tagging = kind.is_release() && options.tag;

    if kind.is_release() {
        run_step(git, &["checkout", &config.master], &format!("Check out {}", config.master), &mut log).await?;
        run_step(
            git,
            &["merge", "--no-ff", "--no-edit", &branch],
            &format!("Merge {branch} into {}", config.master),
            &mut log,
        )
        .await?;

        if tagging {
            let tag = format!("{}{}", config.versiontag, name);
            let message = if options.tag_message.is_empty() {
                tag.clone()
            } else {
                options.tag_message.clone()
            };

            run_step(git, &["tag", "-a", &tag, "-m", &message], &format!("Tag {tag}"), &mut log)
                .await?;
        }

        pushed.push(config.master.clone());
    }

    run_step(git, &["checkout", &config.develop], &format!("Check out {}", config.develop), &mut log).await?;
    run_step(
        git,
        &["merge", "--no-ff", "--no-edit", &branch],
        &format!("Merge {branch} into {}", config.develop),
        &mut log,
    )
    .await?;
    pushed.push(config.develop.clone());

    if options.delete_branch {
        // `-d` refuses if anything is unmerged, which after the merges above
        // can only mean something went wrong. Let it refuse, unless the user
        // has said otherwise.
        let flag = if options.force_delete { "-D" } else { "-d" };
        run_step(git, &["branch", flag, &branch], &format!("Delete {branch}"), &mut log).await?;
    }

    if options.push {
        let mut args = vec!["push", "origin"];
        args.extend(pushed.iter().map(String::as_str));

        let tag = format!("{}{}", config.versiontag, name);
        if tagging {
            args.push(&tag);
        }

        run_step(git, &args, "Push to origin", &mut log).await?;
    }

    Ok(log.join("\n"))
}

fn require_initialized(initialized: bool) -> Result<()> {
    if initialized {
        return Ok(());
    }

    Err(AppError::Git {
        code: 1,
        stderr: "Git flow is not set up for this repository yet.".into(),
    })
}

async fn branch_exists(git: &Git, name: &str) -> Result<bool> {
    if name.is_empty() {
        return Ok(false);
    }

    let out = git
        .run_str_allowing(
            &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{name}")],
            &[1],
        )
        .await?;

    Ok(!out.is_empty())
}

/// Run one step of a multi-step operation, recording it, and on failure
/// reporting everything that already happened alongside the error.
async fn run_step(git: &Git, args: &[&str], label: &str, log: &mut Vec<String>) -> Result<()> {
    match git.run_reported(args).await {
        Ok(out) => {
            log.push(if out.is_empty() {
                label.to_string()
            } else {
                format!("{label}\n{out}")
            });
            Ok(())
        }
        Err(AppError::Git { code, stderr }) => {
            let mut context = log.clone();
            context.push(format!("{label} — failed"));
            context.push(stderr);

            Err(AppError::Git {
                code,
                stderr: context.join("\n"),
            })
        }
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> FlowConfig {
        FlowConfig::default()
    }

    #[test]
    fn recognises_each_kind_of_branch() {
        let c = config();

        assert_eq!(detect(&c, "feature/login").unwrap().kind, FlowKind::Feature);
        assert_eq!(detect(&c, "bugfix/crash").unwrap().kind, FlowKind::Bugfix);
        assert_eq!(detect(&c, "release/1.2.0").unwrap().kind, FlowKind::Release);
        assert_eq!(detect(&c, "hotfix/1.2.1").unwrap().kind, FlowKind::Hotfix);
        assert_eq!(detect(&c, "support/1.x").unwrap().kind, FlowKind::Support);
    }

    #[test]
    fn strips_the_prefix_to_get_the_name() {
        let current = detect(&config(), "feature/login").unwrap();

        assert_eq!(current.name, "login");
        assert_eq!(current.branch, "feature/login");
    }

    #[test]
    fn keeps_slashes_inside_the_name() {
        assert_eq!(
            detect(&config(), "feature/team/login").unwrap().name,
            "team/login"
        );
    }

    #[test]
    fn ordinary_branches_are_not_flow_branches() {
        assert!(detect(&config(), "main").is_none());
        assert!(detect(&config(), "develop").is_none());
        assert!(detect(&config(), "my-feature").is_none());
    }

    #[test]
    fn the_longest_matching_prefix_wins() {
        // A configuration where one prefix contains another must resolve to
        // the more specific kind, not whichever was checked first.
        let mut c = config();
        c.feature = "f/".into();
        c.bugfix = "f/bug/".into();

        assert_eq!(detect(&c, "f/bug/crash").unwrap().kind, FlowKind::Bugfix);
        assert_eq!(detect(&c, "f/bug/crash").unwrap().name, "crash");
        assert_eq!(detect(&c, "f/login").unwrap().kind, FlowKind::Feature);
    }

    #[test]
    fn an_empty_prefix_never_matches() {
        let mut c = config();
        c.support = String::new();

        // Otherwise every branch would look like a support branch.
        assert!(detect(&c, "anything").is_none());
    }

    #[test]
    fn hotfixes_branch_from_production_and_features_from_develop() {
        let c = config();

        assert_eq!(FlowKind::Hotfix.base(&c), "main");
        assert_eq!(FlowKind::Support.base(&c), "main");
        assert_eq!(FlowKind::Feature.base(&c), "develop");
        assert_eq!(FlowKind::Bugfix.base(&c), "develop");
        assert_eq!(FlowKind::Release.base(&c), "develop");
    }

    #[test]
    fn only_releases_and_hotfixes_get_tagged() {
        assert!(FlowKind::Release.is_release());
        assert!(FlowKind::Hotfix.is_release());
        assert!(!FlowKind::Feature.is_release());
        assert!(!FlowKind::Bugfix.is_release());
        assert!(!FlowKind::Support.is_release());
    }
}
