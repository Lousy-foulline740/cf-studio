import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

async function run() {
  const configStr = readFileSync(resolve(homedir(), 'Library/Preferences/.wrangler/config/default.toml'), 'utf8');
  const tokenMatch = configStr.match(/oauth_token = "(.*)"/);
  const token = tokenMatch![1];
  
  const acctRes = await fetch("https://api.cloudflare.com/client/v4/accounts", {
    headers: { Authorization: `Bearer ${token}` }
  });
  const accounts = await acctRes.json();
  const accountId = accounts.result[0].id;
  console.log("Found account:", accountId);

  const bucketsRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const buckets = await bucketsRes.json();
  console.log("Buckets length:", buckets.result.buckets.length);

  if (buckets.result.buckets.length > 0) {
    const bucketName = buckets.result.buckets[0].name;
    const objsRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/objects?delimiter=%2F`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const objs = await objsRes.json();
    console.log("Objects payload keys:", Object.keys(objs.result));
    console.log("Objects payload structure:", JSON.stringify(objs.result, null, 2).slice(0, 1000));
  }
}
run();
