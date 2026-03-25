// R2ProGate.tsx
//
// Remote-config-driven feature gate for R2 pro actions.
// Reads from https://pro.cfstudio.dev/config.json (same source as D1 export gate).
//
// Usage — declarative wrapper:
//   <R2ProGate featureName="r2_upload">
//     <Button>Upload File</Button>
//   </R2ProGate>
//
// Usage — imperative hook:
//   const { isAvailable, showProToast } = useProFeature("r2_create_bucket");
//
// Feature → config key mapping:
//   r2_upload          → config.enable_r2_upload       (true = unlocked)
//   r2_download        → config.enable_r2_upload       (bundled with upload)
//   r2_create_bucket   → config.enable_r2_bucket_mgmt  (true = unlocked)
//   r2_delete_bucket   → config.enable_r2_bucket_mgmt
//   r2_bucket_settings → config.enable_r2_bucket_settings

import React from "react";
import { useRemoteConfig } from "@/pro_modules/frontend/useRemoteConfig";
import { useToast } from "@/components/ui/use-toast";

// ── Config key resolver ────────────────────────────────────────────────────────

type RemoteConfig = {
  is_export_free?: boolean;
  current_version?: string;
  max_r2_upload_size?: number;
  enable_r2_bucket_settings?: boolean;
  enable_r2_upload?: boolean;
  enable_r2_bucket_mgmt?: boolean;
  enable_d1_index_management?: boolean;
};

/**
 * Returns true when the remote config grants access to the feature.
 * Falls back to `true` while loading (optimistic) and falls back to `false`
 * on network error (safe default — no feature access without config).
 *
 * Gating logic per feature:
 *  - r2_upload / r2_download  → enable_r2_upload ?? (max_r2_upload_size != null)
 *  - r2_create_bucket         → enable_r2_bucket_mgmt ?? enable_r2_bucket_settings
 *  - r2_delete_bucket         → enable_r2_bucket_mgmt ?? enable_r2_bucket_settings
 *  - r2_bucket_settings       → enable_r2_bucket_settings
 */
function resolveFeature(featureName: string, config: RemoteConfig | null, isLoading: boolean): boolean {
  if (isLoading) return true; // Optimistic while fetching — avoids flashing the PRO badge
  if (!config) return false;  // Network error → lock everything

  switch (featureName) {
    case "r2_upload":
    case "r2_download":
      // Unlocked if explicitly enabled, OR if max_r2_upload_size is set (non-zero)
      if (typeof config.enable_r2_upload === "boolean") return config.enable_r2_upload;
      return (config.max_r2_upload_size ?? 0) > 0;

    case "r2_create_bucket":
    case "r2_delete_bucket":
      // Unlocked if bucket mgmt flag set, fall back to bucket settings flag
      if (typeof config.enable_r2_bucket_mgmt === "boolean") return config.enable_r2_bucket_mgmt;
      return config.enable_r2_bucket_settings ?? false;

    case "r2_bucket_settings":
      return config.enable_r2_bucket_settings ?? false;

    default:
      return false;
  }
}

const FEATURE_LABELS: Record<string, string> = {
  r2_upload: "File Upload",
  r2_download: "File Download",
  r2_create_bucket: "Create Bucket",
  r2_delete_bucket: "Delete Bucket",
  r2_bucket_settings: "Bucket Settings",
};

// ── Imperative hook ────────────────────────────────────────────────────────────

/**
 * Returns { isAvailable, showProToast, isLoading } for a given feature name.
 * Use this for dropdown menu items or custom click handling where wrapping
 * children in a JSX component isn't ergonomic.
 */
export function useProFeature(featureName: string) {
  const { data, isLoading } = useRemoteConfig();
  const { toast } = useToast();
  const label = FEATURE_LABELS[featureName] ?? featureName;
  const isAvailable = resolveFeature(featureName, data, isLoading);

  return {
    isAvailable,
    isLoading,
    showProToast: () =>
      toast({
        title: `🔒 Pro Feature — ${label}`,
        description: "This feature is available in the official CF Studio Pro build.",
        duration: 4000,
      }),
  };
}

// ── Declarative wrapper ────────────────────────────────────────────────────────

interface R2ProGateProps {
  /** Identifier string for the feature, e.g. "r2_upload". */
  featureName: string;
  children: React.ReactNode;
  /**
   * When true, wraps children in a <span> instead of a <div>.
   * Useful for inline icon buttons.
   */
  inline?: boolean;
}

export function R2ProGate({ featureName, children, inline = false }: R2ProGateProps) {
  const { isAvailable, isLoading, showProToast } = useProFeature(featureName);

  // While loading: render children normally (optimistic)
  if (isLoading || isAvailable) {
    return <>{children}</>;
  }

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    showProToast();
  };

  if (inline) {
    return (
      <span className="relative inline-flex items-center" onClick={handleClick}>
        <span className="pointer-events-none opacity-60">{children}</span>
        <span
          className="absolute -top-1.5 -right-2.5 bg-orange-500 text-[8px] font-bold px-1 rounded-[4px] text-white shadow-sm z-10 pointer-events-none select-none"
          aria-label="Pro feature"
        >
          PRO
        </span>
      </span>
    );
  }

  return (
    <div className="relative inline-flex items-center" onClick={handleClick}>
      <div className="pointer-events-none opacity-60">{children}</div>
      <span
        className="absolute -top-1.5 -right-2.5 bg-orange-500 text-[8px] font-bold px-1 rounded-[4px] text-white shadow-sm z-10 pointer-events-none select-none"
        aria-label="Pro feature"
      >
        PRO
      </span>
      {/* Invisible click-interceptor overlay */}
      <span className="absolute inset-0 cursor-not-allowed" aria-hidden />
    </div>
  );
}
