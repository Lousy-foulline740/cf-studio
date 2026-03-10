// cloudflare_client.rs
//
// A thin wrapper around `reqwest::Client` that attaches the Cloudflare
// Bearer token to every request. All future API modules (D1, KV, R2 …)
// should obtain a client through `CloudflareClient::new()`.

use reqwest::{
    header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE, USER_AGENT},
    Client, ClientBuilder,
};
use serde::Deserialize;

const CF_API_BASE: &str = "https://api.cloudflare.com/client/v4";
const USER_AGENT_STR: &str = concat!("CF-Studio/", env!("CARGO_PKG_VERSION"));

// ── Cloudflare API envelope ────────────────────────────────────────────────────

/// Every Cloudflare v4 response wraps the payload in this envelope.
#[derive(Debug, Deserialize)]
pub struct CfResponse<T> {
    pub result: Option<T>,
    pub success: bool,
    pub errors: Vec<CfError>,
}

#[derive(Debug, Deserialize)]
pub struct CfError {
    pub code: u32,
    pub message: String,
}

// ── Client ─────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
pub struct CloudflareClient {
    inner: Client,
    /// Cached base URL — allows easy override in tests.
    pub base_url: String,
}

impl CloudflareClient {
    /// Build a new client authenticated with the given OAuth token.
    ///
    /// Uses `rustls` for TLS, so no system OpenSSL is required.
    pub fn new(oauth_token: &str) -> Result<Self, reqwest::Error> {
        let mut headers = HeaderMap::new();

        let auth_value = HeaderValue::from_str(&format!("Bearer {oauth_token}"))
            .expect("oauth_token must be a valid ASCII string");

        headers.insert(AUTHORIZATION, auth_value);
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        headers.insert(USER_AGENT, HeaderValue::from_static(USER_AGENT_STR));

        let inner = ClientBuilder::new()
            .default_headers(headers)
            .use_rustls_tls()
            .build()?;

        Ok(Self {
            inner,
            base_url: CF_API_BASE.to_string(),
        })
    }

    /// Shorthand: GET `{base_url}/{path}`
    pub fn get(&self, path: &str) -> reqwest::RequestBuilder {
        self.inner.get(format!("{}/{}", self.base_url, path))
    }

    /// Shorthand: POST `{base_url}/{path}`
    pub fn post(&self, path: &str) -> reqwest::RequestBuilder {
        self.inner.post(format!("{}/{}", self.base_url, path))
    }

    /// Shorthand: DELETE `{base_url}/{path}`
    pub fn delete(&self, path: &str) -> reqwest::RequestBuilder {
        self.inner.delete(format!("{}/{}", self.base_url, path))
    }
}
