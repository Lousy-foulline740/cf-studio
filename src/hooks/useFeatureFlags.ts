import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface FeatureFlags {
  isProBuild: boolean;
  enableD1History: boolean;
  isLoading: boolean;
}

/**
 * Unified hook to check for Pro features and remote configuration.
 * Gathers both the Rust-level compilation status and the remote feature flags.
 */
export function useFeatureFlags(): FeatureFlags {
  const [flags, setFlags] = useState<FeatureFlags>({
    isProBuild: false,
    enableD1History: false,
    isLoading: true,
  });

  useEffect(() => {
    let mounted = true;

    async function checkFeatures() {
      try {
        // 1. Check if the Rust backend has 'pro' features compiled in
        const isProBuild = await invoke<boolean>("is_pro_enabled").catch(() => false);
        let enableD1History = false;

        // 2. If it's a pro build, check the remote config for specific feature toggles
        if (isProBuild) {
          try {
            const response = await fetch('https://pro.cfstudio.dev/config.json?t=' + Date.now(), {
              cache: 'no-store'
            });
            if (response.ok) {
              const config = await response.json();
              // Enable history if the config explicitly allows it
              enableD1History = config.enable_d1_query_history === true;
            }
          } catch (e) {
            console.error("Failed to fetch remote Pro config:", e);
          }
        }

        if (mounted) {
          setFlags({
            isProBuild,
            enableD1History,
            isLoading: false,
          });
        }
      } catch (e) {
        if (mounted) {
          setFlags({ isProBuild: false, enableD1History: false, isLoading: false });
        }
      }
    }

    checkFeatures();
    return () => { mounted = false; };
  }, []);

  return flags;
}
