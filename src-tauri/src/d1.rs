// d1.rs
//
// Cloudflare D1 Database API — list, inspect, and query databases.
// All functions operate over the CloudflareClient which already carries
// the Bearer token extracted from Wrangler.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::cloudflare_auth::{read_credentials, AuthError};
use crate::cloudflare_client::{CfError, CfResponse, CloudflareClient};


// ── Error type ─────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum D1Error {
    #[error("Authentication error: {0}")]
    Auth(#[from] AuthError),

    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("Could not determine your Cloudflare account ID. Your account may not have API access.")]
    NoAccountId,

    #[error("Cloudflare API error(s): {0}")]
    Api(String),
}

impl Serialize for D1Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

// ── API types ──────────────────────────────────────────────────────────────────

/// Minimal account info from `GET /accounts`.
#[derive(Debug, Deserialize)]
struct CfAccount {
    id: String,
    #[allow(dead_code)]
    name: Option<String>,
}

/// A single D1 database as returned by the Cloudflare list endpoint.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct D1Database {
    pub uuid: String,
    pub name: String,
    pub created_at: Option<String>,
    pub version: Option<String>,
    pub num_tables: Option<u32>,
    pub file_size: Option<u64>,
}

// ── Helper ─────────────────────────────────────────────────────────────────────

fn api_errors_to_string(errors: &[CfError]) -> String {
    errors
        .iter()
        .map(|e| format!("[{}] {}", e.code, e.message))
        .collect::<Vec<_>>()
        .join("; ")
}

// ── Account ID resolution ──────────────────────────────────────────────────────

/// Fetches the first Cloudflare account visible to the OAuth token.
/// Used when the Wrangler config file doesn't contain `account_id`.
async fn resolve_account_id(client: &CloudflareClient) -> Result<String, D1Error> {
    let resp = client
        .get("accounts")
        .send()
        .await?
        .json::<CfResponse<Vec<CfAccount>>>()
        .await?;

    if !resp.success {
        return Err(D1Error::Api(api_errors_to_string(&resp.errors)));
    }

    let accounts = resp.result.unwrap_or_default();
    accounts
        .into_iter()
        .next()
        .map(|a| a.id)
        .ok_or(D1Error::NoAccountId)
}

// ── Core async fn ──────────────────────────────────────────────────────────────

pub async fn list_databases(
    client: &CloudflareClient,
    account_id: &str,
) -> Result<Vec<D1Database>, D1Error> {
    let resp = client
        .get(&format!("accounts/{account_id}/d1/database"))
        .send()
        .await?
        .json::<CfResponse<Vec<D1Database>>>()
        .await?;

    if !resp.success {
        return Err(D1Error::Api(api_errors_to_string(&resp.errors)));
    }

    Ok(resp.result.unwrap_or_default())
}

// ── Tauri command ──────────────────────────────────────────────────────────────

/// Invoked by the React frontend to list all D1 databases for the authenticated
/// Cloudflare account.
///
/// Account resolution order:
/// 1. `account_id` field in `~/.wrangler/config/default.toml` (rare)
/// 2. Auto-fetched from `GET /accounts` using the OAuth token (typical)
#[tauri::command]
pub async fn fetch_d1_databases() -> Result<Vec<D1Database>, D1Error> {
    // Read credentials — offload blocking I/O to the thread-pool.
    let creds = tokio::task::spawn_blocking(read_credentials)
        .await
        .unwrap_or_else(|e| {
            Err(AuthError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                e.to_string(),
            )))
        })?;

    let client = CloudflareClient::new(&creds.oauth_token)?;

    // Use the account_id from Wrangler config if present, otherwise fetch it.
    let account_id = match creds.account_id {
        Some(id) => id,
        None => resolve_account_id(&client).await?,
    };

    list_databases(&client, &account_id).await
}

// ── D1 Query types ─────────────────────────────────────────────────────────────

/// Execution metadata included in every D1 query response.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct D1QueryMeta {
    pub duration: Option<f64>,
    pub rows_read: Option<u64>,
    pub rows_written: Option<u64>,
    pub changes: Option<u64>,
    pub last_row_id: Option<u64>,
    pub changed_db: Option<bool>,
    pub size_after: Option<u64>,
    pub served_by: Option<String>,
}

/// A single statement result within a D1 query response.
/// `results` is a dynamic array of row objects — column names are not
/// known at compile time, so we use `serde_json::Value`.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct D1QueryResult {
    /// Rows returned by this statement (empty for DDL / DML).
    pub results: Vec<Value>,
    pub success: bool,
    pub meta: Option<D1QueryMeta>,
    /// Per-statement error message, if `success` is false.
    pub error: Option<String>,
}

// ── execute_d1_query ───────────────────────────────────────────────────────────

/// Execute one or more SQL statements against a specific D1 database.
///
/// Parameters
/// - `account_id`  : Cloudflare account UUID (caller-supplied from the DB list)
/// - `database_id` : D1 database UUID
/// - `sql_query`   : One or more SQL statements (`;` separated)
/// - `params`      : Optional positional parameters for prepared statements
///                   (`?` placeholders). Pass `null` / omit for plain SQL.
///
/// Returns the raw `result` array from the Cloudflare API, typed as
/// `Vec<D1QueryResult>` (one entry per statement).
#[tauri::command]
pub async fn execute_d1_query(
    account_id: String,
    database_id: String,
    sql_query: String,
    params: Option<Vec<Value>>,
) -> Result<Vec<D1QueryResult>, D1Error> {
    // Load the OAuth token — blocking I/O, run on thread-pool.
    let creds = tokio::task::spawn_blocking(read_credentials)
        .await
        .unwrap_or_else(|e| {
            Err(AuthError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                e.to_string(),
            )))
        })?;

    let client = CloudflareClient::new(&creds.oauth_token)?;

    // Resolve account_id: use what the caller provided, or auto-fetch.
    let resolved_account_id = if account_id.is_empty() {
        resolve_account_id(&client).await?
    } else {
        account_id
    };

    let body = json!({
        "sql":    sql_query,
        "params": params.unwrap_or_default(),
    });

    let endpoint = format!(
        "accounts/{resolved_account_id}/d1/database/{database_id}/query"
    );

    let resp = client
        .post(&endpoint)
        .json(&body)
        .send()
        .await?
        .json::<CfResponse<Vec<D1QueryResult>>>()
        .await?;

    // Top-level API failure (auth, network, etc.)
    if !resp.success {
        return Err(D1Error::Api(api_errors_to_string(&resp.errors)));
    }

    let results = resp.result.unwrap_or_default();

    // Surface the first per-statement error if any statement failed.
    if let Some(stmt) = results.iter().find(|r| !r.success) {
        let msg = stmt
            .error
            .clone()
            .unwrap_or_else(|| "Unknown query error".to_string());
        return Err(D1Error::Api(msg));
    }

    Ok(results)
}
