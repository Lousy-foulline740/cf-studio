import { useCallback } from "react";
import { type D1QueryResult } from "@/hooks/useCloudflare";

export type ExecutionSource = "UI_ACTION" | "RAW_QUERY";

export interface TrackedQueryOptions {
  query: string;
  databaseId: string;
  accountId: string;
  tableName?: string | null;
  source: ExecutionSource;
}

/**
 * Public Core version of useD1Tracker.
 * This is a pass-through that does NO local tracking.
 * Advanced History & Tracking is a Pro-only feature.
 */
export function useD1Tracker() {
  const executeTrackedQuery = useCallback(
    async (
      _options: TrackedQueryOptions,
      executeNetworkCall: () => Promise<D1QueryResult[]>
    ): Promise<D1QueryResult[]> => {
      // In the public core, we just execute the query and return the results.
      // No call to "save_query_history" is made.
      return await executeNetworkCall();
    },
    []
  );

  return { executeTrackedQuery };
}
