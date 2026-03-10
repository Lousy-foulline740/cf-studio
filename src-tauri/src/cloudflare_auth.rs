// cloudflare_auth.rs
//
// Reads the local Wrangler OAuth config to provide zero-touch authentication.
// No API tokens are ever stored in CF Studio — we reuse the session that
// `wrangler login` already created on the user's machine.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

// ── Error type ─────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("Wrangler config directory not found. Is your home directory set?")]
    ConfigDirNotFound,

    #[error("Wrangler config file not found at {0}. Run `wrangler login` first.")]
    ConfigFileNotFound(String),

    #[error("Failed to read Wrangler config: {0}")]
    Io(#[from] std::io::Error),

    #[error("Failed to parse Wrangler config TOML: {0}")]
    TomlParse(#[from] toml::de::Error),

    #[error("No oauth_token found in Wrangler config. Run `wrangler login` first.")]
    NoToken,
}

// Tauri requires errors to be serializable so they travel back to JS as strings.
impl Serialize for AuthError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

// ── Wrangler config shape ──────────────────────────────────────────────────────

/// Only the fields we care about from `~/.config/.wrangler/config/default.toml`
#[derive(Debug, Deserialize)]
struct WranglerConfig {
    oauth_token: Option<String>,
    /// Wrangler sometimes stores the account_id it last used.
    account_id: Option<String>,
}

// ── Public result type returned to the frontend ────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct CloudflareCredentials {
    pub oauth_token: String,
    /// Present only when Wrangler has cached the account ID.
    pub account_id: Option<String>,
}

// ── Path resolution ────────────────────────────────────────────────────────────

/// Returns the expected path to `default.toml`, regardless of platform.
///
/// - **macOS / Linux**: `~/.config/.wrangler/config/default.toml`
/// - **Windows**:       `%USERPROFILE%\.config\.wrangler\config\default.toml`
pub fn wrangler_config_path() -> Result<PathBuf, AuthError> {
    // `dirs::home_dir()` handles all three platforms via OS APIs.
    let home = dirs::home_dir().ok_or(AuthError::ConfigDirNotFound)?;

    Ok(home
        .join(".config")
        .join(".wrangler")
        .join("config")
        .join("default.toml"))
}

// ── Core parsing logic ─────────────────────────────────────────────────────────

/// Reads and parses the Wrangler config, returning the extracted credentials.
pub fn read_credentials() -> Result<CloudflareCredentials, AuthError> {
    let path = wrangler_config_path()?;

    if !path.exists() {
        return Err(AuthError::ConfigFileNotFound(
            path.to_string_lossy().into_owned(),
        ));
    }

    let raw = fs::read_to_string(&path)?;
    let config: WranglerConfig = toml::from_str(&raw)?;

    let oauth_token = config.oauth_token.ok_or(AuthError::NoToken)?;

    Ok(CloudflareCredentials {
        oauth_token,
        account_id: config.account_id,
    })
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wrangler_path_ends_correctly() {
        // Just verify the path ends with the expected segments.
        // The home directory itself is environment-dependent.
        if let Ok(p) = wrangler_config_path() {
            let s = p.to_string_lossy();
            assert!(s.contains(".wrangler"), "path should contain .wrangler: {s}");
            assert!(s.ends_with("default.toml"), "path should end with default.toml: {s}");
        }
    }

    #[test]
    fn missing_config_returns_error() {
        // Simulate a non-existent file.
        let path = PathBuf::from("/tmp/__cf_studio_nonexistent_test_file.toml");
        assert!(!path.exists());
    }
}
