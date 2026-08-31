/** Turning git's error output into something you can act on.
 *
 *  Git's messages are accurate and often unhelpful: "Updates were rejected
 *  because the tip of your current branch is behind" is a correct description
 *  of a situation whose answer is simply "pull first". The full text is always
 *  kept and shown — this only adds a sentence and, where there is an obvious
 *  next step, a button that takes it.
 *
 *  Nothing here guesses. Every rule matches a specific message git emits, and
 *  when nothing matches the raw output stands on its own.
 */

export type HintAction = "pull" | "fetch" | "stash" | "resolve";

export interface GitHint {
  /** One sentence, in the app's voice, saying what to do. */
  message: string;
  action?: { label: string; kind: HintAction };
}

interface Rule {
  match: RegExp;
  hint: GitHint;
}

/** Order matters: the first match wins, so the more specific rules lead. */
const RULES: Rule[] = [
  {
    // Push rejected because the remote moved on.
    match: /non-fast-forward|Updates were rejected|tip of your current branch is behind|fetch first/i,
    hint: {
      message:
        "The remote has commits you do not have yet. Pull to combine them, then push again.",
      action: { label: "Pull", kind: "pull" },
    },
  },
  {
    // The classic mid-merge stop.
    match: /Automatic merge failed|CONFLICT \(|fix conflicts and then commit/i,
    hint: {
      message:
        "The merge stopped on conflicting files. Resolve them, stage each one, then continue the merge.",
      action: { label: "Show conflicts", kind: "resolve" },
    },
  },
  {
    match: /You have unmerged files|Exiting because of an unresolved conflict|unresolved conflict/i,
    hint: {
      message: "Some files are still conflicted. Resolve and stage them before carrying on.",
      action: { label: "Show conflicts", kind: "resolve" },
    },
  },
  {
    // Git refuses to clobber uncommitted work.
    match: /local changes.*would be overwritten|Please commit your changes or stash them/i,
    hint: {
      message:
        "Uncommitted changes are in the way. Stash or commit them first, then try again.",
      action: { label: "Stash changes", kind: "stash" },
    },
  },
  {
    // Git 2.27+ refuses to guess merge vs rebase.
    match: /divergent branches|Need to specify how to reconcile|pull\.rebase/i,
    hint: {
      message:
        "Your branch and the remote have both moved on, and git will not guess whether to merge or rebase. Set pull.rebase in your git config to choose.",
    },
  },
  {
    match: /refusing to merge unrelated histories/i,
    hint: {
      message:
        "These two branches share no common commit. That usually means the wrong remote or branch, rather than something to force through.",
    },
  },
  {
    // Credentials. Terminal prompting is off on purpose, so this is what a
    // missing or rejected credential looks like.
    match: /could not read Username|Authentication failed|terminal prompts disabled|Permission denied \(publickey\)|Invalid username or password/i,
    hint: {
      message:
        "Git could not authenticate with the remote. Check your credential helper or SSH key — Braid never prompts for a password itself, it uses the same credentials your terminal does.",
    },
  },
  {
    match: /Could not resolve host|Failed to connect|Connection timed out|unable to access/i,
    hint: {
      message: "The remote could not be reached. Check the network and the remote URL.",
    },
  },
  {
    match: /does not appear to be a git repository|Repository not found|couldn't find remote ref/i,
    hint: {
      message:
        "The remote rejected the reference. Check the remote URL and that the branch exists on it.",
      action: { label: "Fetch", kind: "fetch" },
    },
  },
  {
    match: /not something we can merge|did not match any file\(s\) known to git|unknown revision/i,
    hint: {
      message:
        "Git does not recognise that name. If it only exists on a remote, fetch first so the reference is known locally.",
      action: { label: "Fetch", kind: "fetch" },
    },
  },
  {
    match: /branch .* is not fully merged/i,
    hint: {
      message:
        "That branch has commits that are not merged anywhere else. Deleting it makes them unreachable — force the delete only if you meant to lose them.",
    },
  },
  {
    match: /index\.lock|Another git process seems to be running/i,
    hint: {
      message:
        "Another git process holds the index lock. Wait for it to finish; if nothing is running, a stale .git/index.lock is left behind and can be deleted.",
    },
  },
  {
    match: /pre-commit hook|hook declined|commit-msg hook/i,
    hint: {
      message:
        "A git hook rejected this. The hook's own output is above — the commit message has been kept.",
    },
  },
  {
    match: /nothing to commit|no changes added to commit/i,
    hint: {
      message: "Nothing is staged, so there is nothing to commit.",
    },
  },
];

export function hintFor(detail: string): GitHint | undefined {
  return RULES.find((rule) => rule.match.test(detail))?.hint;
}
