import { useCallback, useEffect } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/store/useAppStore";
import appVersion from "../../package.json";

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "up-to-date" | "error";

export function useUpdater() {
  const status = useAppStore((s) => s.updateStatus);
  const update = useAppStore((s) => s.updateData);
  const downloadProgress = useAppStore((s) => s.downloadProgress);
  const error = useAppStore((s) => s.updateError);
  const autoUpdate = useAppStore((s) => s.autoUpdate);

  const setStatus = useAppStore((s) => s.setUpdateStatus);
  const setUpdate = useAppStore((s) => s.setUpdateData);
  const setDownloadProgress = useAppStore((s) => s.setDownloadProgress);
  const setError = useAppStore((s) => s.setUpdateError);

  const checkForUpdates = useCallback(async (isAutoCheck = false) => {
    setStatus("checking");
    setError(null);
    try {
      // 1. Try manual check against changelogs.json for raw version notification (reliable)
      const response = await fetch(`https://raw.githubusercontent.com/mubashardev/cf-studio/main/changelogs/changelogs.json?t=${Date.now()}`, {
        cache: "no-store"
      });
      
      let isActuallyNewer = false;
      let latestChangelog = null;

        if (response.ok) {
          const data = await response.json();
          latestChangelog = data[0];
          
          if (latestChangelog) {
            const currentV = appVersion.version.replace(/^v/, "");
            const latestV = latestChangelog.version.replace(/^v/, "");
            
            const vToArr = (v: string) => v.split('.').map(n => parseInt(n || "0"));
            const currentArr = vToArr(currentV);
            const latestArr = vToArr(latestV);
            
            for (let i = 0; i < 3; i++) {
              if (latestArr[i] > currentArr[i]) {
                isActuallyNewer = true;
                break;
              }
              if (latestArr[i] < currentArr[i]) break;
            }

            // Even if not newer, store it as the 'latest' version we know about
            if (!isActuallyNewer) {
              setUpdate({
                version: latestChangelog.version,
                body: [
                  ...(latestChangelog.features || []),
                  ...(latestChangelog.fixes || [])
                ].join("\n"),
                date: latestChangelog.date || ""
              } as any);
            }
          }
        }

      // 2. Try native check to get the Update object for downloading (requires valid manifest)
      let manifest: Update | null = null;
      try {
        manifest = await check();
      } catch (nativeErr) {
        console.warn("Native check failed, falling back to manual detection:", nativeErr);
        // If it's a dev build or missing signature, we'll see it here
      }

      if (manifest) {
        setUpdate(manifest);
        setStatus("available");
        if (isAutoCheck && autoUpdate) {
          downloadUpdate(manifest);
        }
      } else if (isActuallyNewer) {
        // We found a newer version but native manifest is missing — still show it
        setStatus("available");
        setUpdate({
          version: latestChangelog.version,
          body: [
            ...(latestChangelog.features || []),
            ...(latestChangelog.fixes || [])
          ].join("\n"),
          date: latestChangelog.date || "",
          isManualDetection: true,
          installCommand: "curl -fsSL https://install.cfstudio.dev | bash"
        } as any); // Cast to any because `isManualDetection` is not part of the official `Update` type
      } else {
        setStatus("up-to-date");
      }
    } catch (err) {
      console.error("Failed to check for updates:", err);
      setError("Update service unavailable");
      setStatus("error");
    }
  }, [autoUpdate]);

  const downloadUpdate = useCallback(async (targetUpdate?: any) => {
    const activeUpdate = targetUpdate || update;
    if (!activeUpdate) return;

    setStatus("downloading");
    setDownloadProgress(0);

    const unlistenProgress = await (import('@tauri-apps/api/event').then(m => 
      m.listen<number>("update-download-progress", (event) => {
        setDownloadProgress(Math.round(event.payload));
      })
    ));

    try {
      if (activeUpdate.isManualDetection) {
        // Refined URL construction based on historical patterns
        const isMac = navigator.platform.toLowerCase().includes('mac');
        const isWin = navigator.platform.toLowerCase().includes('win');
        const isArm = navigator.userAgent.includes('arm64') || navigator.userAgent.includes('AppleWebKit') && !navigator.userAgent.includes('Intel');
        
        let binaryUrl = "";
        let filename = "";

        const ver = activeUpdate.version;
        if (isMac) {
          const archStr = isArm ? "aarch64" : "x64";
          binaryUrl = `https://github.com/mubashardev/cf-studio/releases/download/v${ver}/CF_Studio_${ver}_${archStr}.dmg`;
          filename = `CF_Studio_${ver}_${archStr}.dmg`;
        } else if (isWin) {
          binaryUrl = `https://github.com/mubashardev/cf-studio/releases/download/v${ver}/CF_Studio_${ver}_x64_en-US.msi.zip`;
          filename = `CF_Studio_${ver}_x64_en-US.msi.zip`;
        } else {
          // Linux fallback
          binaryUrl = `https://github.com/mubashardev/cf-studio/releases/download/v${ver}/cf-studio_${ver}_amd64.AppImage.tar.gz`;
          filename = `cf-studio_${ver}_amd64.AppImage.tar.gz`;
        }

        if (!binaryUrl) throw new Error("Automatic download not supported for this platform yet.");

        const destPath = await invoke("download_update_binary", { url: binaryUrl, filename }) as string;
        setDownloadProgress(100);
        
        // Before relaunching/finishing, try to clear the quarantine flag on macOS
        try {
          await invoke("fix_mac_quarantine");
        } catch (e) {
          console.error("Failed to fix quarantine:", e);
        }

        // For manual downloads, open the installer automatically
        import('@tauri-apps/plugin-opener').then(m => m.openPath(destPath));
        setError("Download complete! Installer launched.");
        setStatus("available"); // Keep it available but error shows instructions
      } else {
        await (activeUpdate as Update).downloadAndInstall((event) => {
          switch (event.event) {
            case "Started": break;
            case "Progress":
              if (event.data.chunkLength && (activeUpdate as any).contentLength) {
                // native progress handling if needed
              }
              break;
            case "Finished":
              setDownloadProgress(100);
              break;
          }
        });
        
        // Before relaunching, try to clear the quarantine flag on macOS
        try {
          await invoke("fix_mac_quarantine");
        } catch (e) {
          console.error("Failed to fix quarantine:", e);
        }

        await relaunch();
      }
    } catch (err) {
      console.error("Failed to download/install update:", err);
      const msg = String(err);
      if (msg.includes("404")) {
        setError("Update assets not found on GitHub. The release might be pending or private.");
      } else if (msg.includes("signature")) {
        setError("Update signature verification failed. The binary might be untrusted.");
      } else if (msg.includes("connection") || msg.includes("network")) {
        setError("Network error. Please check your internet connection.");
      } else {
        setError(msg);
      }
      setStatus("error");
    } finally {
      unlistenProgress();
    }
  }, [update]);

  // Initial check on mount, or if status is idle (e.g., after an error or reset)
  useEffect(() => {
    if (status === "idle") {
      checkForUpdates(true);
    }
  }, [status, checkForUpdates]);

  return {
    status,
    update,
    downloadProgress,
    error,
    checkForUpdates,
    downloadUpdate,
  };
}
