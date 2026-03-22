import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { 
  Plus, 
  Trash2, 
  Search, 
  Layers, 
  Table2, 
  Info,
  RefreshCw,
  Code2,
  Edit
} from "lucide-react";
import { 
  useD1Indexes, 
  invokeCloudflare, 
  type D1TableSchema,
  type D1QueryResult,
  type D1Index
} from "@/hooks/useCloudflare";
import { EditIndexDialog } from "./EditIndexDialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface IndexManagerDialogProps {
  databaseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allTables: D1TableSchema[];
}

export function IndexManagerDialog({ 
  databaseId, 
  open, 
  onOpenChange, 
  allTables 
}: IndexManagerDialogProps) {
  const { state, refresh } = useD1Indexes(databaseId);
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  // Edit/Create Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<D1Index | null>(null);

  const filteredIndexes = useMemo(() => {
    if (state.status !== "success") return [];
    return state.data.filter(idx => 
      idx.name.toLowerCase().includes(search.toLowerCase()) || 
      idx.tableName.toLowerCase().includes(search.toLowerCase())
    );
  }, [state, search]);



  const handleDeleteIndex = async (name: string) => {
    setIsApplying(true);
    try {
      const sql = `DROP INDEX IF EXISTS "${name}";`;
      const results = await invokeCloudflare<D1QueryResult[]>("execute_d1_query", {
        accountId: "",
        databaseId,
        sqlQuery: sql,
        params: null
      });

      if (!results[0]?.success) {
        throw new Error(results[0]?.error || "Failed to drop index");
      }

      toast({ title: "Success", description: `Index ${name} deleted successfully.` });
      refresh();
      setIsDeleting(null);
    } catch (err: any) {
      toast({ 
        title: "Error", 
        description: err.message || String(err), 
        variant: "destructive" 
      });
    } finally {
      setIsApplying(false);
    }
  };



  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 gap-0 shadow-2xl overflow-hidden flex flex-col h-[85vh] border-border/60">
        <DialogHeader className="p-6 pb-4 border-b border-border bg-muted/30 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-primary/10 text-primary">
                <Layers size={18} strokeWidth={2} />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold">Database Indexes</DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Manage performance indexes for your D1 tables</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" size="sm" 
                className="h-8 text-xs gap-1.5"
                onClick={() => {
                  setEditingIndex(null);
                  setIsEditModalOpen(true);
                }}
                disabled={isApplying}
              >
                <Plus size={14} />
                New Index
              </Button>
              <Button 
                variant="ghost" size="icon" 
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => refresh()}
                disabled={state.status === "loading" || isApplying}
              >
                <RefreshCw size={14} className={cn(state.status === "loading" && "animate-spin")} />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 flex flex-col min-h-0 bg-background">
          <div className="px-6 py-3 border-b border-border bg-muted/5">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
              <Input 
                placeholder="Search indexes by name or table..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-9 text-xs border-transparent bg-transparent hover:bg-muted/30 focus:bg-background transition-colors"
              />
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-4 space-y-2">
              {state.status === "loading" && filteredIndexes.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <RefreshCw size={24} className="text-muted-foreground/20 animate-spin" />
                  <p className="text-xs text-muted-foreground/40 font-medium italic">Fetching index metadata...</p>
                </div>
              )}

              {state.status === "success" && filteredIndexes.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 gap-3 border border-dashed border-border/60 rounded-xl bg-muted/5">
                  <div className="p-3 rounded-full bg-muted/20 text-muted-foreground/30">
                    <Search size={22} strokeWidth={1.5} />
                  </div>
                  <p className="text-xs text-muted-foreground/40 font-medium">
                    {search ? "No matching indexes found" : "No user-defined indexes found"}
                  </p>
                </div>
              )}

              {filteredIndexes.map((idx) => (
                <div 
                  key={idx.name}
                  className="group flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card hover:border-primary/30 hover:shadow-sm transition-all duration-200"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="h-9 w-9 rounded-md bg-muted/40 flex items-center justify-center shrink-0 text-muted-foreground/40 group-hover:text-primary/60 transition-colors">
                      <Code2 size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-semibold text-foreground truncate">{idx.name}</span>
                        {idx.sql?.toLowerCase().includes("unique") && (
                          <Badge variant="secondary" className="h-4 px-1.5 text-[9px] bg-emerald-500/10 text-emerald-500 border-transparent hover:bg-emerald-500/20">
                            UNIQUE
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Table2 size={11} className="shrink-0" />
                        <span className="text-[11px] font-medium truncate">{idx.tableName}</span>
                        {idx.sql && (
                          <>
                            <span className="text-[10px] opacity-30 text-muted-foreground/50">•</span>
                            <span className="text-[10px] font-mono truncate max-w-[200px] opacity-60">
                              {idx.sql.split("(")[1]?.split(")")[0] || "..."}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button 
                      variant="ghost" size="icon" 
                      className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
                      onClick={() => {
                        setEditingIndex(idx);
                        setIsEditModalOpen(true);
                      }}
                      disabled={isApplying}
                    >
                      <Edit size={14} />
                    </Button>
                    <Button 
                      variant="ghost" size="icon" 
                      className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setIsDeleting(idx.name)}
                      disabled={isApplying}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter className="p-4 border-t border-border bg-muted/20 shrink-0">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 italic">
              <Info size={12} />
              SQLite indexes are created on specific columns to speed up SELECT queries.
            </div>
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-8 text-xs font-medium">
              Close
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={!!isDeleting} onOpenChange={(open) => !open && setIsDeleting(null)}>
      <AlertDialogContent className="max-w-md border-border/60 shadow-2xl">
        <AlertDialogHeader>
          <div className="w-10 h-10 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mb-2">
            <Trash2 size={20} />
          </div>
          <AlertDialogTitle className="text-foreground">Delete Index?</AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground text-sm leading-relaxed">
            Are you sure you want to delete the index <span className="font-mono text-foreground font-bold">{isDeleting}</span>? 
            This may slow down queries that depend on it, but it will free up storage space.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-6 flex gap-2">
          <AlertDialogCancel className="h-9 text-xs font-medium mt-0 border-border/60">Cancel</AlertDialogCancel>
          <AlertDialogAction 
            className="h-9 text-xs font-medium bg-destructive hover:bg-destructive/90 text-destructive-foreground mt-0"
            disabled={isApplying}
            onClick={() => isDeleting && handleDeleteIndex(isDeleting)}
          >
            {isApplying ? "Deleting..." : "Delete Index"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <EditIndexDialog 
      databaseId={databaseId}
      open={isEditModalOpen}
      onOpenChange={setIsEditModalOpen}
      allTables={allTables}
      indexToEdit={editingIndex}
      onSuccess={refresh}
    />
    </>
  );
}
