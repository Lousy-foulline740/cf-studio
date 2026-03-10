import { ThemeProvider } from "@/components/ThemeProvider";
import { Layout } from "@/components/Layout";

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="cf-studio-theme">
      <Layout>
        {/* Page content will be rendered here by the router in a future step */}
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome to CF Studio
          </h1>
          <p className="text-muted-foreground text-sm">
            Select a resource from the sidebar to get started.
          </p>
        </div>
      </Layout>
    </ThemeProvider>
  );
}

export default App;
