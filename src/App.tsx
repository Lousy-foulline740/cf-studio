import { ThemeProvider } from "@/components/ThemeProvider";
import { Layout } from "@/components/Layout";
import { SetupWizard } from "@/components/SetupWizard";
import { Toaster } from "@/components/ui/toaster";
import { useEffect, useState, lazy, Suspense } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Dynamic import for Pro-only ActivityDashboard
const ActivityDashboard = lazy(() => 
  import("@/pro_modules/ui/ActivityDashboard")
    .then(module => ({ default: module.ActivityDashboard }))
    .catch(() => ({ 
      default: () => (
        <div className="flex flex-col items-center justify-center h-screen bg-background text-muted-foreground p-10 text-center">
            <h1 className="text-xl font-bold mb-2">Pro Feature Required</h1>
            <p className="text-sm max-w-xs">Advanced Query History & Tracking is only available in the Pro version of CF Studio.</p>
        </div>
      )
    }))
);

function App() {
  const [windowLabel, setWindowLabel] = useState<string | null>(null);

  useEffect(() => {
    setWindowLabel(getCurrentWindow().label);
  }, []);

  if (windowLabel === null) {
      return null;
  }

  if (windowLabel === "history") {
    return (
      <ThemeProvider defaultTheme="dark" storageKey="cf-studio-theme">
        <Suspense fallback={<div className="h-screen flex items-center justify-center bg-background"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>}>
          <ActivityDashboard />
        </Suspense>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider defaultTheme="dark" storageKey="cf-studio-theme">
      <SetupWizard>
        <Layout />
      </SetupWizard>
      <Toaster />
    </ThemeProvider>
  );
}

export default App;
