// r2_pro.rs
//
// Cloudflare R2 — PRO tier commands.
// This module is only compiled when the `pro` Cargo feature flag is active:
//   cargo build --features pro
//
// Pro commands: create_r2_bucket, delete_r2_bucket, empty_r2_bucket,
//               upload_r2_object, cancel_upload_r2_object, download_r2_object,
//               update_r2_bucket_managed_domain, add_r2_bucket_custom_domain,
//               remove_r2_bucket_custom_domain, get_r2_bucket_domains_list

use serde::Serialize;
use reqwest::header::CONTENT_TYPE;

use crate::cloudflare_auth::read_credentials;
use crate::cloudflare_client::{CfResponse, CloudflareClient};
use crate::r2::{R2Error, resolve_account_id, delete_r2_object};
use crate::UploadState;

use tauri::Emitter;
use tokio_util::codec::{BytesCodec, FramedRead};
use futures_util::stream::StreamExt;

// ── Pro-only event payload types ───────────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct UploadProgress {
    upload_id: String,
    bytes_uploaded: u64,
    total_bytes: u64,
}

#[derive(Clone, Serialize)]
pub struct EmptyBucketProgress {
    pub bucket_name: String,
    pub deleted: u32,
    pub total: u32,
}

#[derive(Serialize)]
pub struct BucketDomainsInfo {
    managed: serde_json::Value,
    custom: Vec<serde_json::Value>,
}
// ── Zone types ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, serde::Deserialize)]
pub struct CfZone {
    pub id: String,
    pub name: String,
}

// ── Pro Tauri Commands ─────────────────────────────────────────────────────────

/// Lists all DNS zones in the user's Cloudflare account.
/// Used by the Settings modal to auto-resolve which zone a custom domain belongs to.
#[tauri::command]
pub async fn fetch_cloudflare_zones() -> Result<Vec<CfZone>, R2Error> {
    let creds = tokio::task::spawn_blocking(read_credentials)
        .await
        .map_err(|e| R2Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))??;
    let client = CloudflareClient::new(&creds.oauth_token)?;

    let mut all_zones = Vec::new();
    let mut page = 1u32;

    loop {
        let url = format!("zones?per_page=50&page={}", page);
        let resp = client
            .get(&url)
            .send()
            .await?
            .json::<CfResponse<Vec<CfZone>>>()
            .await?;

        if !resp.success {
            return Err(R2Error::Api(
                resp.errors.iter().map(|e| format!("[{}] {}", e.code, e.message)).collect::<Vec<_>>().join("; "),
            ));
        }

        let zones = resp.result.unwrap_or_default();
        let count = zones.len();
        all_zones.extend(zones);

        if count < 50 { break; }
        page += 1;
    }

    Ok(all_zones)
}

#[tauri::command]
pub async fn create_r2_bucket(bucket_name: String) -> Result<(), R2Error> {
    let creds = tokio::task::spawn_blocking(read_credentials)
        .await
        .map_err(|e| R2Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))??;
    let client = CloudflareClient::new(&creds.oauth_token)?;
    let account_id = match creds.account_id { Some(id) => id, None => resolve_account_id(&client).await? };
    let url = format!("accounts/{}/r2/buckets", account_id);
    let body = serde_json::json!({ "name": bucket_name });
    let resp = client.post(&url).json(&body).send().await?.json::<CfResponse<serde_json::Value>>().await?;
    if !resp.success {
        return Err(R2Error::Api(
            resp.errors.iter().map(|e| format!("[{}] {}", e.code, e.message)).collect::<Vec<_>>().join("; "),
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_r2_bucket(bucket_name: String) -> Result<(), R2Error> {
    let creds = tokio::task::spawn_blocking(read_credentials)
        .await
        .map_err(|e| R2Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))??;
    let client = CloudflareClient::new(&creds.oauth_token)?;
    let account_id = match creds.account_id { Some(id) => id, None => resolve_account_id(&client).await? };
    let url = format!("accounts/{}/r2/buckets/{}", account_id, bucket_name);
    let resp = client.delete(&url).send().await?;
    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(R2Error::Api(format!("Delete bucket failed: {}", text)));
    }
    Ok(())
}

#[tauri::command]
pub async fn empty_r2_bucket(
    app: tauri::AppHandle,
    bucket_name: String,
) -> Result<(), R2Error> {
    let creds = tokio::task::spawn_blocking(read_credentials)
        .await
        .map_err(|e| R2Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))??;

    let client = CloudflareClient::new(&creds.oauth_token)?;
    let account_id = match creds.account_id {
        Some(id) => id,
        None => resolve_account_id(&client).await?,
    };

    let mut cursor: Option<String> = None;
    let mut all_keys = Vec::new();

    loop {
        let mut url = format!("accounts/{}/r2/buckets/{}/objects", account_id, bucket_name);
        if let Some(c) = &cursor {
            url = format!("{}?cursor={}", url, urlencoding::encode(c));
        }

        let resp = client
            .get(&url)
            .send()
            .await?
            .json::<CfResponse<Vec<serde_json::Value>>>()
            .await?;

        if !resp.success {
            return Err(R2Error::Api(
                resp.errors.iter().map(|e| format!("[{}] {}", e.code, e.message)).collect::<Vec<_>>().join("; "),
            ));
        }

        if let Some(objects) = resp.result {
            for obj in objects {
                if let Some(k) = obj["key"].as_str() {
                    all_keys.push(k.to_string());
                }
            }
        }

        let mut is_truncated = false;
        if let Some(info) = resp.result_info {
            if let Some(trunc) = info.get("truncated").and_then(|v| v.as_bool()) {
                is_truncated = trunc;
            } else if let Some(trunc) = info.get("is_truncated").and_then(|v| v.as_bool()) {
                is_truncated = trunc;
            }
            cursor = info.get("cursor").and_then(|v| v.as_str()).map(String::from);
        }

        if !is_truncated || cursor.is_none() || all_keys.is_empty() {
            break;
        }
    }

    let total = all_keys.len() as u32;
    let mut deleted = 0;

    let _ = app.emit("empty-bucket-progress", EmptyBucketProgress {
        bucket_name: bucket_name.clone(),
        deleted,
        total,
    });

    for key in all_keys {
        let url = format!(
            "accounts/{}/r2/buckets/{}/objects/{}",
            account_id, bucket_name, urlencoding::encode(&key)
        );
        let _ = client.delete(&url).send().await?;
        deleted += 1;
        let _ = app.emit("empty-bucket-progress", EmptyBucketProgress {
            bucket_name: bucket_name.clone(),
            deleted,
            total,
        });
    }

    Ok(())
}

#[tauri::command]
pub async fn upload_r2_object(
    app: tauri::AppHandle,
    state: tauri::State<'_, UploadState>,
    upload_id: String,
    bucket_name: String,
    key: String,
    local_path: String,
) -> Result<(), R2Error> {
    let creds = tokio::task::spawn_blocking(read_credentials)
        .await
        .map_err(|e| R2Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))??;

    let client = CloudflareClient::new(&creds.oauth_token)?;
    let account_id = match creds.account_id {
        Some(id) => id,
        None => resolve_account_id(&client).await?,
    };

    let metadata = tokio::fs::metadata(&local_path).await?;
    let total_bytes = metadata.len();
    let mime_type = mime_guess::from_path(&local_path).first_or_octet_stream();

    let token = tokio_util::sync::CancellationToken::new();
    {
        let mut map = state.cancel_tokens.lock().await;
        map.insert(upload_id.clone(), token.clone());
    }

    let file = tokio::fs::File::open(&local_path).await?;
    let mut framed = FramedRead::new(file, BytesCodec::new());

    let mut uploaded = 0u64;
    let app_clone = app.clone();
    let uid_clone = upload_id.clone();
    let token_clone = token.clone();

    let stream = async_stream::stream! {
        while let Some(res) = framed.next().await {
            if token_clone.is_cancelled() {
                yield Err(std::io::Error::new(std::io::ErrorKind::Interrupted, "Upload cancelled"));
                break;
            }
            match res {
                Ok(bytes) => {
                    let chunk_len = bytes.len() as u64;
                    uploaded += chunk_len;
                    let _ = app_clone.emit("upload-progress", UploadProgress {
                        upload_id: uid_clone.clone(),
                        bytes_uploaded: uploaded,
                        total_bytes,
                    });
                    yield Ok(bytes.freeze());
                }
                Err(e) => {
                    yield Err(e);
                }
            }
        }
    };

    let body = reqwest::Body::wrap_stream(stream);
    let url = format!(
        "accounts/{}/r2/buckets/{}/objects/{}",
        account_id, bucket_name, urlencoding::encode(&key)
    );

    let resp = client
        .put(&url)
        .header(CONTENT_TYPE, mime_type.as_ref())
        .body(body)
        .send()
        .await;

    {
        let mut map = state.cancel_tokens.lock().await;
        map.remove(&upload_id);
    }

    if token.is_cancelled() {
        return Err(R2Error::Api("Cancelled by user".into()));
    }

    let resp = resp?;
    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(R2Error::Api(format!("Upload failed: {}", text)));
    }

    Ok(())
}

/// Cancels an active upload and attempts to delete the partial object.
#[tauri::command]
pub async fn cancel_upload_r2_object(
    state: tauri::State<'_, UploadState>,
    upload_id: String,
    bucket_name: String,
    key: String,
) -> Result<(), R2Error> {
    {
        let map = state.cancel_tokens.lock().await;
        if let Some(token) = map.get(&upload_id) {
            token.cancel();
        }
    }
    let _ = delete_r2_object(bucket_name, key).await;
    Ok(())
}

/// Downloads an object from R2 to the local disk.
#[tauri::command]
pub async fn download_r2_object(
    bucket_name: String,
    key: String,
    destination_path: String,
) -> Result<(), R2Error> {
    let creds = tokio::task::spawn_blocking(read_credentials)
        .await
        .map_err(|e| R2Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))??;

    let client = CloudflareClient::new(&creds.oauth_token)?;
    let account_id = match creds.account_id {
        Some(id) => id,
        None => resolve_account_id(&client).await?,
    };

    let url = format!("accounts/{}/r2/buckets/{}/objects/{}", account_id, bucket_name, urlencoding::encode(&key));

    let resp = client.get(&url).send().await?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(R2Error::Api(format!("Download failed: {}", text)));
    }

    let bytes = resp.bytes().await?;
    tokio::fs::write(&destination_path, bytes).await?;

    Ok(())
}

#[tauri::command]
pub async fn update_r2_bucket_managed_domain(bucket_name: String, enabled: bool) -> Result<(), R2Error> {
    let creds = tokio::task::spawn_blocking(read_credentials)
        .await
        .map_err(|e| R2Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))??;
    let client = CloudflareClient::new(&creds.oauth_token)?;
    let account_id = match creds.account_id { Some(id) => id, None => resolve_account_id(&client).await? };
    let url = format!("accounts/{}/r2/buckets/{}/domains/managed", account_id, bucket_name);
    let body = serde_json::json!({ "enabled": enabled });
    let resp = client.put(&url).json(&body).send().await?;
    if !resp.status().is_success() {
        return Err(R2Error::Api(resp.text().await.unwrap_or_default()));
    }
    Ok(())
}

#[tauri::command]
pub async fn add_r2_bucket_custom_domain(bucket_name: String, domain: String, zone_id: String, zone_name: String) -> Result<(), R2Error> {
    let creds = tokio::task::spawn_blocking(read_credentials)
        .await
        .map_err(|e| R2Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))??;
    let client = CloudflareClient::new(&creds.oauth_token)?;
    let account_id = match creds.account_id { Some(id) => id, None => resolve_account_id(&client).await? };
    let url = format!("accounts/{}/r2/buckets/{}/domains/custom", account_id, bucket_name);
    let body = serde_json::json!({
        "domain": domain,
        "zoneId": zone_id,
        "enabled": true
    });
    let resp = client.post(&url).json(&body).send().await?;
    if !resp.status().is_success() {
        return Err(R2Error::Api(resp.text().await.unwrap_or_default()));
    }
    Ok(())
}

#[tauri::command]
pub async fn remove_r2_bucket_custom_domain(bucket_name: String, domain: String) -> Result<(), R2Error> {
    let creds = tokio::task::spawn_blocking(read_credentials)
        .await
        .map_err(|e| R2Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))??;
    let client = CloudflareClient::new(&creds.oauth_token)?;
    let account_id = match creds.account_id { Some(id) => id, None => resolve_account_id(&client).await? };
    let url = format!("accounts/{}/r2/buckets/{}/domains/custom/{}", account_id, bucket_name, domain);
    let resp = client.delete(&url).send().await?;
    if !resp.status().is_success() {
        return Err(R2Error::Api(resp.text().await.unwrap_or_default()));
    }
    Ok(())
}

#[tauri::command]
pub async fn get_r2_bucket_domains_list(bucket_name: String) -> Result<BucketDomainsInfo, R2Error> {
    let creds = tokio::task::spawn_blocking(read_credentials)
        .await
        .map_err(|e| R2Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))??;
    let client = CloudflareClient::new(&creds.oauth_token)?;
    let account_id = match creds.account_id { Some(id) => id, None => resolve_account_id(&client).await? };

    let mut managed = serde_json::json!({ "enabled": false, "domain": null });
    let managed_url = format!("accounts/{}/r2/buckets/{}/domains/managed", account_id, bucket_name);
    if let Ok(resp) = client.get(&managed_url).send().await {
        if let Ok(data) = resp.json::<serde_json::Value>().await {
            managed = data["result"].clone();
        }
    }

    let mut custom = Vec::new();
    let custom_url = format!("accounts/{}/r2/buckets/{}/domains/custom", account_id, bucket_name);
    if let Ok(resp) = client.get(&custom_url).send().await {
        if let Ok(data) = resp.json::<serde_json::Value>().await {
            if let Some(domains) = data["result"]["domains"].as_array() {
                custom = domains.clone();
            }
        }
    }

    Ok(BucketDomainsInfo { managed, custom })
}
