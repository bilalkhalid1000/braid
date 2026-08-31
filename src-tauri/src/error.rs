use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("git exited with code {code}: {stderr}")]
    Git { code: i32, stderr: String },

    #[error("no repository open with id {0}")]
    UnknownRepo(String),

    #[error("not a git repository: {0}")]
    NotARepo(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("watch error: {0}")]
    Watch(String),

    #[error("{0}")]
    App(String),
}

/// Tauri requires command errors to be serializable. The frontend only ever
/// needs the message, so flatten to a string rather than leaking the variants.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
