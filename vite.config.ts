import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    // Tailwind CSS v4 — must come before the React plugin
    tailwindcss(),
    react(),
  ],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // ── Build-time feature flags ──────────────────────────────────────────────────
  // Set CF_STUDIO_PRO=true in your environment before running `npm run tauri dev`
  // or `npm run tauri build` to produce a Pro edition that unlocks all R2 features.
  //
  //   Public build (default):      IS_PRO === false
  //   Pro build:   CF_STUDIO_PRO=true npm run tauri build
  define: {
    __APP_IS_PRO__: process.env.CF_STUDIO_PRO === "true",
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
