// CF Studio — Cloudflare R2 frontend helpers
//
// Uploads use pre-signed PUT URLs, sending file bytes directly to R2 over HTTPS.
// This bypasses Tauri IPC entirely, avoiding large binary serialization overhead.

import { invoke } from "@tauri-apps/api/core";

// ── Types ──────────────────────────────────────────────────────────────────────

interface PresignedUploadUrl {
  url: string;
  expires_in: number;
}

export interface R2Object {
  key: string;
  size: number;
  last_modified: string;
}

export interface FolderListing {
  files: R2Object[];
  folders: string[];
}

// ── R2 Operations ──────────────────────────────────────────────────────────────

/**
 * Request a pre-signed PUT URL for the given R2 object key.
 * @param filePath — R2 key, e.g. "projects/assets/video.mp4"
 */
export async function getUploadUrl(
  filePath: string
): Promise<PresignedUploadUrl> {
  return invoke<PresignedUploadUrl>("get_upload_url", { filePath });
}

/**
 * Upload a File directly to R2 via a pre-signed PUT URL.
 *
 * Flow:
 *   1. Obtain a pre-signed URL from the Rust backend (Tauri IPC).
 *   2. PUT the raw file bytes to R2 over HTTPS — no IPC for the payload.
 *
 * @param file   — File object from an <input type="file"> element.
 * @param r2Key  — Desired R2 object key, e.g. "uploads/photo.jpg".
 * @returns        The fetch Response from R2 (status 200 on success).
 * @throws         On network error or non-OK HTTP status.
 */
export async function uploadFileToR2(
  file: File,
  r2Key: string
): Promise<Response> {
  const { url } = await getUploadUrl(r2Key);

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      // R2 respects Content-Type set during upload.
      "Content-Type": file.type || "application/octet-stream",
    },
    // Send the raw File blob — no base64, no JSON wrapping.
    body: file,
  });

  if (!response.ok) {
    throw new Error(
      `R2 upload failed: ${response.status} ${response.statusText}`
    );
  }

  return response;
}

/**
 * List files and sub-folders at the given R2 prefix.
 * @param prefix — Folder prefix ending with "/", e.g. "projects/". Empty string for root.
 */
export async function listFolder(prefix: string): Promise<FolderListing> {
  return invoke<FolderListing>("list_folder", { prefix });
}
