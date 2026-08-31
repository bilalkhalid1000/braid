pub mod error;
pub mod git;
mod ipc;
mod registry;
mod session;
mod settings;
mod system;
mod watcher;

use std::time::Duration;

use tauri::Manager;

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

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(RepoRegistry::default())
        .invoke_handler(tauri::generate_handler![
            ipc::open_repo,
            ipc::init_repo,
            ipc::load_session,
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
            ipc::fsmonitor_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
