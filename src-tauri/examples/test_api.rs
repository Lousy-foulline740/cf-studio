use std::process::Command;
use serde_json::Value;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let output = Command::new("cat")
        .arg("/Users/mubasharhussain/.config/.wrangler/config/default.toml")
        .output()
        .expect("Failed to read wrangler config");
    
    let toml_str = String::from_utf8_lossy(&output.stdout);
    let mut token = String::new();
    for line in toml_str.lines() {
        if line.starts_with("oauth_token =") {
            token = line.split('"').nth(1).unwrap_or("").to_string();
            break;
        }
    }

    let client = reqwest::Client::new();
    
    // First, let's get standard account ID logic if possible, or just hit /accounts
    let account_resp = client.get("https://api.cloudflare.com/client/v4/accounts")
        .header("Authorization", format!("Bearer {}", token))
        .send().await?.json::<Value>().await?;
        
    let acc_id = account_resp["result"][0]["id"].as_str().unwrap();
    println!("Account ID: {}", acc_id);

    let url = format!("https://api.cloudflare.com/client/v4/accounts/{}/r2/buckets", acc_id);
    let resp = client.get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send().await?;
        
    let text = resp.text().await?;
    println!("R2 Buckets response: {}", text);

    Ok(())
}
