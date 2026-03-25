// isPro.ts
//
// Build-time constant injected by vite.config.ts.
//
// Public build  (default):  IS_PRO === false
// Pro build (CF_STUDIO_PRO=true npm run ...):  IS_PRO === true
//
// This constant is completely inlined at compile time — it is NOT stored
// in localStorage, window, or any user-accessible location. Dead code that
// references pro features is tree-shaken from the public bundle entirely.

declare const __APP_IS_PRO__: boolean;

export const IS_PRO: boolean =
  typeof __APP_IS_PRO__ !== "undefined" ? __APP_IS_PRO__ : false;
