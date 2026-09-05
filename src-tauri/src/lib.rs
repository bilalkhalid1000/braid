pub mod error;
pub mod git;
mod ipc;
mod registry;
mod library;
mod session;
mod settings;
mod system;
mod watcher;

use std::time::Duration;

use tauri::{Emitter, Manager};

use registry::RepoRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Updating replaces the running executable, which only means anything on a
    // desktop; the plugin does not build for mobile targets at all.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        // The window is created hidden and revealed by the frontend once it has
        // painted, which is what removes the blank white frame at startup.
        // If the frontend never gets there, this shows it anyway: a bug in the
        // UI should not leave the user with a process and no window.
        .setup(|app| {
            let handle = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(5)).await;

                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.show();
                }
            });

            // Forward every git invocation to the window. Through a channel
            // rather than emitting from the call site, so nothing in the git
            // layer needs an AppHandle and the trace stays a no-op wherever
            // one was never installed -- every test, for instance.
            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
            git::trace::install(tx);

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while let Some(command) = rx.recv().await {
                    let _ = handle.emit(git::GIT_COMMAND_EVENT, command);
                }
            });

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(RepoRegistry::default())
        .invoke_handler(tauri::generate_handler![
            ipc::open_repo,
            ipc::init_repo,
            ipc::load_session,
            ipc::load_library,
            ipc::save_library,
            ipc::save_session,
            ipc::load_settings,
            ipc::save_settings,
            ipc::close_repo,
            ipc::list_repos,
            ipc::repo_status,
            ipc::repo_refs,
            ipc::repo_log,
            ipc::file_diff,
            ipc::blame_file,
            ipc::search_repo,
            ipc::clone_repo,
            ipc::publish_branch,
            ipc::delete_remote_branch,
            ipc::commit_detail,
            ipc::commit_file_diff,
            ipc::apply_hunk,
            ipc::stage_paths,
            ipc::unstage_paths,
            ipc::discard_paths,
            ipc::commit,
            ipc::fetch,
            ipc::pull,
            ipc::push,
            ipc::checkout,
            ipc::create_branch,
            ipc::delete_branch,
            ipc::merge_branch,
            ipc::stash_push,
            ipc::stash_apply,
            ipc::stash_drop,
            ipc::list_worktrees,
            ipc::add_worktree,
            ipc::remove_worktree,
            ipc::prune_worktrees,
            ipc::list_submodules,
            ipc::update_submodules,
            ipc::sync_submodules,
            ipc::flow_status,
            ipc::flow_init,
            ipc::flow_start,
            ipc::flow_finish,
            ipc::resolve_with_side,
            ipc::mark_resolved,
            ipc::abort_operation,
            ipc::continue_operation,
            ipc::skip_operation,
            ipc::open_in_file_manager,
            ipc::open_in_terminal,
            ipc::terminal_options,
            ipc::open_in_editor,
            ipc::editor_options,
            ipc::reset_impact,
            ipc::reset_to,
            ipc::revert_commit,
            ipc::drop_impact,
            ipc::drop_commit,
            ipc::fsmonitor_state,
            ipc::add_remote,
            ipc::rename_remote,
            ipc::set_remote_url,
            ipc::remove_remote,
            ipc::fetch_remote,
            ipc::rebase_branch,
            ipc::cherry_pick,
            ipc::create_tag,
            ipc::delete_tag,
            ipc::push_tag,
            ipc::rename_branch,
            ipc::set_upstream,
            ipc::ignore_path,
            ipc::rebase_plan,
            ipc::rebase_run,
            ipc::amend_into,
            ipc::reflog,
            ipc::undo,
            ipc::mergetool,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
