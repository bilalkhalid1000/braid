// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    low_memory_rendering();

    braid_lib::run()
}

/// Honour the "draw with the CPU" setting before GTK and WebKit start.
///
/// Both read their renderer from the environment once, at initialisation,
/// which is before any app code with a settings store runs -- so the file is
/// read here, by the path the store uses. Measured with nine repositories
/// open: about 50 MB less resident, and no GPU allocations at all. A value
/// the user already set in their own environment is left alone.
#[cfg(target_os = "linux")]
fn low_memory_rendering() {
    use std::path::PathBuf;

    let config = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")));
    let Some(config) = config else { return };

    // The same identifier and file as `settings::store_path`.
    let path = config.join("com.sbkbk.braid").join("settings.json");
    let Ok(text) = std::fs::read_to_string(path) else { return };
    let Ok(settings) = serde_json::from_str::<serde_json::Value>(&text) else { return };

    if settings["lowMemoryRendering"].as_bool() != Some(true) {
        return;
    }

    for (key, value) in [
        ("WEBKIT_DISABLE_COMPOSITING_MODE", "1"),
        ("GSK_RENDERER", "cairo"),
    ] {
        if std::env::var_os(key).is_none() {
            std::env::set_var(key, value);
        }
    }
}
