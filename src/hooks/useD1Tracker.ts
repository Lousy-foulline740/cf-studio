import { useCallback, useState, useEffect } from "react";
import { type D1QueryResult } from "@/hooks/useCloudflare";
import { useAppStore } from "@/store/useAppStore";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";

export type ExecutionSource = "UI_ACTION" | "RAW_QUERY";

export interface TrackedQueryOptions {
  query: string;
  databaseId: string;
  accountId: string;
  tableName?: string | null;
  source: ExecutionSource;
}

// Internal pro logic that we dynamically import
let proLogic: any = null;

/**
 * Public Core version of useD1Tracker with Pro-capabilities.
 * If the 'pro' feature is active and modules are present, it dynamically
 * loads the advanced tracking logic.
 */
export function useD1Tracker() {
  const sessionId = useAppStore((state) => state.sessionId);
  const activeAccountId = useAppStore((state) => state.activeAccount?.id);
  const saveQueryResultsEnabled = useAppStore((state) => state.saveQueryResultsEnabled);
  const saveQueryResultsRowLimit = useAppStore((state) => state.saveQueryResultsRowLimit);

  const { isProBuild, enableD1History, isLoading: flagsLoading } = useFeatureFlags();

  useEffect(() => {
    // If pro build is detected, preload the logic module
    if (isProBuild) {
        import("@/pro_modules/hooks/useD1TrackerLogic")
          .then(m => { proLogic = m.executeTrackedQueryWithLogic; })
          .catch(() => {});
    }
  }, [isProBuild]);

  const executeTrackedQuery = useCallback(
    async (
      options: TrackedQueryOptions,
      executeNetworkCall: () => Promise<D1QueryResult[]>
    ): Promise<D1QueryResult[]> => {
      // 1. If not a Pro build or disabled by remote config, runNormally
      if (flagsLoading || !isProBuild || !enableD1History) {
        return await executeNetworkCall();
      }

      // 2. Attempt to use pro tracking logic
      try {
        if (proLogic) {
          return await proLogic(
            options,
            executeNetworkCall,
            {
              sessionId,
              activeAccountId,
              saveQueryResultsEnabled,
              saveQueryResultsRowLimit,
            }
          );
        } else {
           // Try one last-ditch dynamic import if not yet loaded
           const m = await import("@/pro_modules/hooks/useD1TrackerLogic").catch(() => null);
           if (m?.executeTrackedQueryWithLogic) {
             return await m.executeTrackedQueryWithLogic(
                options,
                executeNetworkCall,
                {
                  sessionId,
                  activeAccountId,
                  saveQueryResultsEnabled,
                  saveQueryResultsRowLimit,
                }
             );
           }
        }
      } catch (e) {
        console.error("Pro tracker logic execution failed:", e);
      }

      // Fallback
      return await executeNetworkCall();
    },
    [isProBuild, enableD1History, flagsLoading, sessionId, activeAccountId, saveQueryResultsEnabled, saveQueryResultsRowLimit]
  );

  return { executeTrackedQuery };
}
