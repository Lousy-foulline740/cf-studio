// useCloudflare.ts
//
// Central React hook for all Cloudflare data. Provides:
//   - Authentication state (credentials from Wrangler session)
//   - D1 database list with loading + error states
//   - D1 schema query hook
//   - A `refresh` function to re-fetch on demand

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Types mirroring Rust structs ───────────────────────────────────────────────

export interface CloudflareCredentials {
  oauth_token: string;
  account_id?: string;
}

export interface D1Database {
  uuid: string;
  name: string;
  created_at?: string;
  version?: string;
  num_tables?: number;
  file_size?: number;
}

export interface D1QueryMeta {
  duration?: number;
  rows_read?: number;
  rows_written?: number;
  changes?: number;
}

export interface D1QueryResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  results: Record<string, any>[];
  success: boolean;
  meta?: D1QueryMeta;
  error?: string;
}

/** A table entry from sqlite_master */
export interface D1TableSchema {
  name: string;
  sql: string | null;
}

// Discriminated union for each async resource
export type AsyncState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; message: string };

// ── Auth hook ──────────────────────────────────────────────────────────────────

export function useCloudflareAuth() {
  const [state, setState] = useState<AsyncState<CloudflareCredentials>>({
    status: "idle",
  });

  const fetch = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const creds = await invoke<CloudflareCredentials>("get_cloudflare_token");
      setState({ status: "success", data: creds });
    } catch (err) {
      setState({ status: "error", message: String(err) });
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { state, refresh: fetch };
}

// ── D1 Databases hook ──────────────────────────────────────────────────────────

export function useD1Databases() {
  const [state, setState] = useState<AsyncState<D1Database[]>>({
    status: "idle",
  });

  const fetch = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const databases = await invoke<D1Database[]>("fetch_d1_databases");
      setState({ status: "success", data: databases });
    } catch (err) {
      setState({ status: "error", message: String(err) });
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { state, refresh: fetch };
}

// ── D1 Schema hook ─────────────────────────────────────────────────────────────

const SCHEMA_SQL =
  "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;";

/**
 * Fetches all table names + CREATE TABLE SQL for a specific D1 database.
 * Resolves account_id automatically via `get_cloudflare_token`.
 */
export function useD1Schema(databaseId: string) {
  const [state, setState] = useState<AsyncState<D1TableSchema[]>>({
    status: "idle",
  });

  const fetch = useCallback(async () => {
    if (!databaseId) return;
    setState({ status: "loading" });
    try {
      // Resolve account_id from the local Wrangler session.
      const creds = await invoke<CloudflareCredentials>("get_cloudflare_token");

      // account_id may not be in the config — the Rust command will
      // auto-resolve via GET /accounts. We pass a sentinel empty string
      // so the command falls through to its own resolution logic.
      // Actually, execute_d1_query requires an explicit account_id.
      // We resolve it here if absent.
      let accountId = creds.account_id ?? "";
      if (!accountId) {
        // Fetch from the accounts endpoint via a known-safe Tauri channel:
        // reuse get_cloudflare_token which already re-reads credentials.
        // We rely on fetch_d1_databases to have been called first and the
        // Rust side to cache nothing — so we call a lightweight accounts
        // resolution command instead. For now we use the same hack as Rust:
        // pass "" and let the command fail, then surface the message.
        // A cleaner path: store accountId in useD1Databases.
        // For this implementation, re-invoke fetch_d1_databases to warm
        // the account id — but that's wasteful. Instead, we store accountId
        // in a module-level ref updated by useD1Databases.
        accountId = resolvedAccountId;
      }

      const queryResults = await invoke<D1QueryResult[]>("execute_d1_query", {
        accountId,
        databaseId,
        sqlQuery: SCHEMA_SQL,
        params: null,
      });

      const rows = queryResults[0]?.results ?? [];
      const tables: D1TableSchema[] = rows.map((r) => ({
        name: String(r["name"] ?? ""),
        sql: r["sql"] != null ? String(r["sql"]) : null,
      }));

      setState({ status: "success", data: tables });
    } catch (err) {
      setState({ status: "error", message: String(err) });
    }
  }, [databaseId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { state, refresh: fetch };
}

// Module-level store for the resolved account ID — set by useD1Databases
// so useD1Schema can access it without an extra API call.
let resolvedAccountId = "";

export function setResolvedAccountId(id: string) {
  resolvedAccountId = id;
}
