use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;

use serde::Serialize;
use tokio::sync::mpsc::UnboundedSender;

/// Every git process the app starts, reported as it starts and as it ends.
///
/// The point is not debugging. This client is a face over the user's own git,
/// and a face is exactly the kind of thing that can quietly do something other
/// than what it said. Showing the argv is how someone checks — and how anyone
/// who knows git can work out what went wrong without our error text having to
/// anticipate it.

pub const GIT_COMMAND_EVENT: &str = "git://command";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitCommand {
    /// Pairs the end with the start it belongs to.
    pub id: u64,
    /// The arguments, without the leading `git`.
    pub args: Vec<String>,
    /// Absent while the command is still running.
    pub duration_ms: Option<u64>,
    /// Absent while running; the process exit code once finished.
    pub code: Option<i32>,
}

static SINK: OnceLock<UnboundedSender<GitCommand>> = OnceLock::new();
static NEXT: AtomicU64 = AtomicU64::new(1);

/// Point the trace at a channel. Called once, when the window is set up.
///
/// Nothing installs one in tests, and `record` is a no-op until something
/// does — a git call must not depend on a UI being attached.
pub fn install(sink: UnboundedSender<GitCommand>) {
    let _ = SINK.set(sink);
}

/// A running command. Report its end with `finished`.
pub struct Running {
    id: u64,
    args: Vec<String>,
    started: std::time::Instant,
}

/// Announce a command that is about to run.
pub fn started(args: &[&str]) -> Running {
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    let args: Vec<String> = args.iter().map(|a| (*a).to_string()).collect();

    send(GitCommand {
        id,
        args: args.clone(),
        duration_ms: None,
        code: None,
    });

    Running {
        id,
        args,
        started: std::time::Instant::now(),
    }
}

impl Running {
    /// Announce that it finished, with how long it took and how it exited.
    pub fn finished(self, code: i32) {
        send(GitCommand {
            id: self.id,
            args: self.args,
            duration_ms: Some(self.started.elapsed().as_millis() as u64),
            code: Some(code),
        });
    }
}

fn send(command: GitCommand) {
    if let Some(sink) = SINK.get() {
        // A closed channel means the window is gone. Losing a trace line is
        // not a reason to fail the git command it describes.
        let _ = sink.send(command);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recording_without_a_sink_is_harmless() {
        // Every integration test runs git with no window attached.
        let run = started(&["status", "--porcelain=v2"]);
        run.finished(0);
    }

    #[test]
    fn each_command_gets_its_own_id() {
        let a = started(&["status"]);
        let b = started(&["log"]);

        assert_ne!(a.id, b.id, "the end has to find the start it belongs to");
    }

    #[test]
    fn the_arguments_are_kept_as_given() {
        let run = started(&["commit", "-m", "a message with spaces"]);

        assert_eq!(run.args, ["commit", "-m", "a message with spaces"]);
    }
}
