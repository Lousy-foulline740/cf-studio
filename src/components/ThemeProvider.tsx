import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { emit, listen } from "@tauri-apps/api/event";

// ── Types ──────────────────────────────────────────────────────────────────────
export type Theme = "light" | "dark" | "system";

interface ThemeProviderState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: "light" | "dark";
}

// ── Context ───────────────────────────────────────────────────────────────────
const ThemeProviderContext = createContext<ThemeProviderState | undefined>(
  undefined
);

// ── Provider ──────────────────────────────────────────────────────────────────
interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

export function ThemeProvider({
  children,
  defaultTheme = "dark",
  storageKey = "cf-studio-theme",
}: ThemeProviderProps) {
  const getInitialTheme = (): Theme => {
    const param = new URLSearchParams(window.location.search).get("theme");
    if (param === "light" || param === "dark" || param === "system") {
      return param;
    }
    const stored = localStorage.getItem(storageKey) as Theme | null;
    return stored ?? defaultTheme;
  };

  const [theme, setThemeState] = useState<Theme>(
    () => getInitialTheme()
  );

  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => {
    const initial = getInitialTheme();
    if (initial === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    return initial;
  });

  useEffect(() => {
    const root = document.documentElement;

    const applyTheme = (t: Theme) => {
      const resolved =
        t === "system"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
          : t;

      root.classList.remove("light", "dark");
      root.classList.add(resolved);
      setResolvedTheme(resolved);
    };

    applyTheme(theme);

    // React to OS-level changes when theme is "system"
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => applyTheme("system");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [theme]);

  useEffect(() => {
    const unlistenPromise = listen<{ theme: Theme }>("cf-theme-changed", (event) => {
      const next = event.payload.theme;
      localStorage.setItem(storageKey, next);
      setThemeState(next);
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [storageKey]);

  const setTheme = (next: Theme) => {
    localStorage.setItem(storageKey, next);
    setThemeState(next);
    void emit("cf-theme-changed", { theme: next });
  };

  return (
    <ThemeProviderContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useTheme(): ThemeProviderState {
  const ctx = useContext(ThemeProviderContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a <ThemeProvider>");
  }
  return ctx;
}
