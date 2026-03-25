import { useState, useCallback, useEffect } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useAppStore } from "@/store/useAppStore";

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "up-to-date" | "error";

export function useUpdater() {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const autoUpdate = useAppStore((s) => s.autoUpdate);

  const checkForUpdates = useCallback(async (isAutoCheck = false) => {
    setStatus("checking");
    setError(null);
    try {
      // 1. Try native check first (requires valid manifest)
      const manifest = await check();
      if (manifest) {
        setUpdate(manifest);
        setStatus("available");
        if (isAutoCheck && autoUpdate) {
          downloadUpdate(manifest);
        }
        return;
      }
      
      // 2. Fallback: Manual check against changelogs.json for version notification
      // This allows us to still see "Update Available" even if the native manifest is missing/invalid
      const response = await fetch("https://raw.githubusercontent.com/mubashardev/cf-studio/main/changelogs/changelogs.json");
      if (response.ok) {
        const data = await response.json();
        const latest = data[0];
        if (latest && latest.version !== appVersion.version) {
          // Found a newer version via changelogs, but we don't have a native Update object
          setStatus("available");
          setUpdate({
             version: latest.version,
             body: latest.features.join("\n"),
             date: latest.date || ""
          } as any);
          return;
        }
      }
      
      setStatus("up-to-date");
    } catch (err) {
      // If native check fails, try the manual fallback before showing an error
      try {
        const response = await fetch("https://raw.githubusercontent.com/mubashardev/cf-studio/main/changelogs/changelogs.json");
        const data = await response.json();
        const latest = data[0];
        if (latest && latest.version !== appVersion.version) {
           setStatus("available");
           setUpdate({
              version: latest.version,
              body: latest.features.join("\n"),
              date: latest.date || ""
           } as any);
           return;
        }
        setStatus("up-to-date");
      } catch (innerErr) {
        console.error("Failed to check for updates (Native & Manual):", err);
        setError("Update service unavailable");
        setStatus("error");
      }
    }
  }, [autoUpdate]);

  const downloadUpdate = useCallback(async (targetUpdate?: Update) => {
    const activeUpdate = targetUpdate || update;
    if (!activeUpdate) return;

    setStatus("downloading");
    setDownloadProgress(0);
    try {
      let downloaded = 0;
      let contentLength = 0;

      await activeUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength || 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setDownloadProgress(Math.round((downloaded / contentLength) * 100));
            }
            break;
          case "Finished":
            setDownloadProgress(100);
            break;
        }
      });
      
      // Successfully installed, now relaunch
      await relaunch();
    } catch (err) {
      console.error("Failed to download update:", err);
      setError(String(err));
      setStatus("error");
    }
  }, [update]);

  // Initial check on mount
  useEffect(() => {
    checkForUpdates(true);
  }, []);

  return {
    status,
    update,
    downloadProgress,
    error,
    checkForUpdates,
    downloadUpdate,
  };
}
