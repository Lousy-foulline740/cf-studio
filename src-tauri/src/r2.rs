// CF Studio — Cloudflare R2 file management via AWS S3–compatible API
//
// Architecture:
//   • Pre-signed PUT URLs let the frontend upload large files directly to R2,
//     bypassing the Tauri IPC bridge entirely.
//   • ListObjectsV2 with Delimiter="/" simulates a traditional folder structure
//     using S3 prefixes + CommonPrefixes.

use std::time::Duration;

use aws_credential_types::provider::SharedCredentialsProvider;
use aws_credential_types::Credentials;
use aws_sdk_s3::config::{BehaviorVersion, Region};
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::Client;
use serde::Serialize;
use tokio::sync::OnceCell;

// ── Singleton R2 Client ────────────────────────────────────────────────────────

/// Lazily-initialized S3 client configured for Cloudflare R2.
static R2_CLIENT: OnceCell<Client> = OnceCell::const_new();

/// Bucket name resolved once from `R2_BUCKET_NAME` env var.
static R2_BUCKET: OnceCell<String> = OnceCell::const_new();

/// Build and cache the S3 client targeting the R2 endpoint.
///
/// Required environment variables:
///   R2_ACCOUNT_ID        — Cloudflare account ID (used to form the endpoint)
///   R2_ACCESS_KEY_ID     — R2 API token key ID
///   R2_SECRET_ACCESS_KEY — R2 API token secret
///   R2_BUCKET_NAME       — Target R2 bucket
async fn get_client() -> Result<&'static Client, R2Error> {
    R2_CLIENT
        .get_or_try_init(|| async {
            let account_id = std::env::var("R2_ACCOUNT_ID")
                .map_err(|_| R2Error::MissingEnv("R2_ACCOUNT_ID"))?;
            let access_key = std::env::var("R2_ACCESS_KEY_ID")
                .map_err(|_| R2Error::MissingEnv("R2_ACCESS_KEY_ID"))?;
            let secret_key = std::env::var("R2_SECRET_ACCESS_KEY")
                .map_err(|_| R2Error::MissingEnv("R2_SECRET_ACCESS_KEY"))?;

            // Cache the bucket name while we're reading env vars.
            let bucket = std::env::var("R2_BUCKET_NAME")
                .map_err(|_| R2Error::MissingEnv("R2_BUCKET_NAME"))?;
            let _ = R2_BUCKET.set(bucket);

            // R2 endpoint format: https://<account_id>.r2.cloudflarestorage.com
            let endpoint = format!("https://{account_id}.r2.cloudflarestorage.com");

            let creds = Credentials::new(access_key, secret_key, None, None, "cf-studio-r2");

            let config = aws_sdk_s3::Config::builder()
                .behavior_version(BehaviorVersion::latest())
                // R2 uses a custom endpoint — not real AWS.
                .endpoint_url(&endpoint)
                // R2 ignores the region, but the SDK requires one; "auto" is the R2 convention.
                .region(Region::new("auto"))
                .credentials_provider(SharedCredentialsProvider::new(creds))
                // R2 requires path-style addressing (bucket in the path, not subdomain).
                .force_path_style(true)
                .build();

            Ok(Client::from_conf(config))
        })
        .await
}

async fn get_bucket() -> Result<&'static str, R2Error> {
    // Ensure the client (and bucket) are initialized.
    let _ = get_client().await?;
    R2_BUCKET
        .get()
        .map(|s| s.as_str())
        .ok_or(R2Error::MissingEnv("R2_BUCKET_NAME"))
}

// ── Error Type ─────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error, Serialize)]
pub enum R2Error {
    #[error("Missing environment variable: {0}")]
    MissingEnv(&'static str),

    #[error("R2 operation failed: {0}")]
    S3(String),

    #[error("Presigning failed: {0}")]
    Presign(String),
}

// ── Response Types ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct PresignedUploadUrl {
    /// The pre-signed PUT URL that the frontend can upload to directly.
    pub url: String,
    /// Validity period in seconds.
    pub expires_in: u64,
}

#[derive(Serialize)]
pub struct R2Object {
    /// Full object key, e.g. "projects/assets/logo.png"
    pub key: String,
    /// Object size in bytes.
    pub size: i64,
    /// ISO-8601 last-modified timestamp.
    pub last_modified: String,
}

#[derive(Serialize)]
pub struct FolderListing {
    /// Objects at this prefix level (files).
    pub files: Vec<R2Object>,
    /// Common prefixes at this level (sub-folders).
    pub folders: Vec<String>,
}

// ── Tauri Commands ─────────────────────────────────────────────────────────────

/// Generate a pre-signed PUT URL for direct-to-R2 uploads.
///
/// `file_path` is the R2 object key, e.g. "projects/video.mp4".
/// Returns a URL valid for 15 minutes.
#[tauri::command]
pub async fn get_upload_url(file_path: String) -> Result<PresignedUploadUrl, R2Error> {
    let client = get_client().await?;
    let bucket = get_bucket().await?;

    let expires_in = Duration::from_secs(15 * 60); // 15 minutes

    let presigning_config = PresigningConfig::builder()
        .expires_in(expires_in)
        .build()
        .map_err(|e| R2Error::Presign(e.to_string()))?;

    let presigned = client
        .put_object()
        .bucket(bucket)
        .key(&file_path)
        .presigned(presigning_config)
        .await
        .map_err(|e| R2Error::Presign(e.to_string()))?;

    Ok(PresignedUploadUrl {
        url: presigned.uri().to_string(),
        expires_in: 15 * 60,
    })
}

/// List the contents of a "folder" in R2 using prefix + delimiter.
///
/// `prefix` should end with "/" to list a directory, e.g. "projects/".
/// Pass an empty string to list the bucket root.
#[tauri::command]
pub async fn list_folder(prefix: String) -> Result<FolderListing, R2Error> {
    let client = get_client().await?;
    let bucket = get_bucket().await?;

    let response = client
        .list_objects_v2()
        .bucket(bucket)
        .prefix(&prefix)
        // Delimiter "/" causes S3 to group keys under shared prefixes,
        // effectively simulating sub-folders in CommonPrefixes.
        .delimiter("/")
        .send()
        .await
        .map_err(|e| R2Error::S3(e.to_string()))?;

    // Map S3 Objects → R2Object structs (files at this level).
    let files = response
        .contents()
        .iter()
        .filter_map(|obj| {
            let key = obj.key()?.to_string();
            // Skip the prefix itself if it appears as an object (folder marker).
            if key == prefix {
                return None;
            }
            Some(R2Object {
                key,
                size: obj.size().unwrap_or(0),
                last_modified: obj
                    .last_modified()
                    .map(|dt| dt.fmt(aws_sdk_s3::primitives::DateTimeFormat::DateTime).unwrap_or_default())
                    .unwrap_or_default(),
            })
        })
        .collect();

    // Map CommonPrefixes → folder name strings.
    let folders = response
        .common_prefixes()
        .iter()
        .filter_map(|cp| cp.prefix().map(|p| p.to_string()))
        .collect();

    Ok(FolderListing { files, folders })
}
