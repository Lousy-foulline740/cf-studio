import { useState, useEffect } from "react";
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
  Layers, 
  Table2, 
  Info,
  X
} from "lucide-react";
import { 
  invokeCloudflare, 
  type D1TableSchema,
  type D1QueryResult,
  type D1Index
} from "@/hooks/useCloudflare";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

interface EditIndexDialogProps {
  databaseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allTables: D1TableSchema[];
  indexToEdit?: D1Index | null;
  onSuccess: () => void;
}

export function EditIndexDialog({ 
  databaseId, 
  open, 
  onOpenChange, 
  allTables,
  indexToEdit,
  onSuccess
}: EditIndexDialogProps) {
  const { toast } = useToast();
  const [isApplying, setIsApplying] = useState(false);
  const [showCreateConfirm, setShowCreateConfirm] = useState(false);

  // Form State
  const [name, setName] = useState("");
  const [targetTable, setTargetTable] = useState("");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [isUnique, setIsUnique] = useState(false);
  
  // Metadata state
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [targetTableRowCount, setTargetTableRowCount] = useState<number | null>(null);

  const isEdit = !!indexToEdit;

  // Pre-fill if editing
  useEffect(() => {
    if (indexToEdit && open) {
      setName(indexToEdit.name);
      setTargetTable(indexToEdit.tableName);
      setIsUnique(indexToEdit.sql?.toLowerCase().includes("unique") || false);
      
      // Parse columns from SQL: CREATE [UNIQUE] INDEX "name" ON "table" (col1, col2)
      if (indexToEdit.sql) {
        const parts = indexToEdit.sql.split("(");
        if (parts.length > 1) {
          const colsStr = parts[1].split(")")[0];
          setSelectedColumns(colsStr.split(",").map(c => c.trim().replace(/"/g, '')));
        }
      }
    } else if (open) {
      // Reset for new creation
      setName("");
      setTargetTable("");
      setSelectedColumns([]);
      setIsUnique(false);
    }
  }, [indexToEdit, open]);

  // Fetch columns and row count when table changes
  useEffect(() => {
    if (!targetTable || !open) {
      setAvailableColumns([]);
      setTargetTableRowCount(null);
      return;
    }
    const fetchMetadata = async () => {
      try {
        // Fetch columns
        const sql = `PRAGMA table_info("${targetTable}")`;
        const results = await invokeCloudflare<D1QueryResult[]>("execute_d1_query", {
          accountId: "",
          databaseId,
          sqlQuery: sql,
          params: null
        });
        const names = (results[0]?.results || []).map(r => String(r.name));
        setAvailableColumns(names);

        // Fetch row count for estimate
        const countSql = `SELECT COUNT(*) as count FROM "${targetTable}"`;
        const countResults = await invokeCloudflare<D1QueryResult[]>("execute_d1_query", {
          accountId: "",
          databaseId,
          sqlQuery: countSql,
          params: null
        });
        const count = countResults[0]?.results?.[0]?.count;
        setTargetTableRowCount(typeof count === 'number' ? count : null);
      } catch (err) {
        console.error("Failed to fetch metadata for index dialog:", err);
      }
    };
    fetchMetadata();
  }, [targetTable, databaseId, open]);

  const handleSave = async () => {
    if (!name || !targetTable || !selectedColumns.length) return;
    setIsApplying(true);
    try {
      // 1. If editing, drop old index first
      if (isEdit && indexToEdit) {
        const dropSql = `DROP INDEX IF EXISTS "${indexToEdit.name}";`;
        await invokeCloudflare<D1QueryResult[]>("execute_d1_query", {
          accountId: "",
          databaseId,
          sqlQuery: dropSql,
          params: null
        });
      }

      // 2. Create new index
      const uniqueStr = isUnique ? "UNIQUE " : "";
      const columnsStr = selectedColumns.map(c => `"${c}"`).join(", ");
      const createSql = `CREATE ${uniqueStr}INDEX "${name}" ON "${targetTable}" (${columnsStr});`;
      
      const results = await invokeCloudflare<D1QueryResult[]>("execute_d1_query", {
        accountId: "",
        databaseId,
        sqlQuery: createSql,
        params: null
      });

      if (!results[0]?.success) {
        throw new Error(results[0]?.error || "Failed to create index");
      }

      toast({ 
        title: "Success", 
        description: `Index ${name} ${isEdit ? "updated" : "created"} successfully.` 
      });
      onSuccess();
      onOpenChange(false);
      setShowCreateConfirm(false);
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
      <DialogContent className="max-w-md p-0 gap-0 shadow-2xl overflow-hidden flex flex-col border-border/60">
        <DialogHeader className="p-6 pb-4 border-b border-border bg-muted/30 shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-primary/10 text-primary">
              <Layers size={18} strokeWidth={2} />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">
                {isEdit ? "Edit Index" : "Create New Index"}
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isEdit ? `Modifying index for ${targetTable}` : "Create a performance index for your table"}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="p-6 space-y-6 bg-background">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-sans tracking-widest text-muted-foreground/60 font-medium">Index Name</label>
              <Input 
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="idx_table_column"
                className="h-9 font-mono text-xs"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] uppercase font-sans tracking-widest text-muted-foreground/60 font-medium">Target Table</label>
              <Select value={targetTable} onValueChange={setTargetTable} disabled={isEdit}>
                <SelectTrigger className="h-9 text-xs">
                  <div className="flex items-center gap-2">
                    <Table2 size={13} className="text-muted-foreground/50" />
                    <SelectValue placeholder="Select table..." />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {allTables.map(t => (
                    <SelectItem key={t.name} value={t.name} className="text-xs">
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] uppercase font-sans tracking-widest text-muted-foreground/60 font-medium">Target Columns</label>
              <div className="flex flex-wrap gap-2 mb-2 min-h-[1.5rem] items-center">
                {selectedColumns.map(col => (
                  <Badge key={col} variant="secondary" className="gap-1 px-1.5 py-0 h-5 text-[10px] bg-primary/10 text-primary border-transparent">
                    {col}
                    <X 
                      size={10} 
                      className="cursor-pointer hover:text-foreground" 
                      onClick={() => setSelectedColumns(selectedColumns.filter(c => c !== col))} 
                    />
                  </Badge>
                ))}
                {selectedColumns.length === 0 && <span className="text-[10px] text-muted-foreground/40 italic">Select columns to index...</span>}
              </div>
              <Select onValueChange={(val) => !selectedColumns.includes(val) && setSelectedColumns([...selectedColumns, val])}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Add column..." />
                </SelectTrigger>
                <SelectContent>
                  {availableColumns.map(c => (
                    <SelectItem key={c} value={c} className="text-xs" disabled={selectedColumns.includes(c)}>
                      {c}
                    </SelectItem>
                  ))}
                  {availableColumns.length === 0 && !targetTable && <div className="p-2 text-xs text-muted-foreground italic">Select a table first</div>}
                  {availableColumns.length === 0 && targetTable && <div className="p-2 text-xs text-muted-foreground italic">Loading columns...</div>}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-4 pt-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input 
                  type="checkbox" 
                  checked={isUnique}
                  onChange={(e) => setIsUnique(e.target.checked)}
                  className="rounded border-border bg-muted text-primary focus:ring-primary"
                />
                <span className="text-xs font-medium text-foreground">Unique Constraint</span>
              </label>
            </div>
          </div>
        </div>

        <DialogFooter className="p-4 border-t border-border bg-muted/20 shrink-0">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 italic">
              <Info size={12} />
              SQLite indexes speed up lookup operations.
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-8 text-xs font-medium">
                Cancel
              </Button>
              <Button 
                size="sm" 
                className="h-8 px-6 bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => setShowCreateConfirm(true)}
                disabled={!name || !targetTable || !selectedColumns.length || isApplying}
              >
                {isEdit ? "Update Index" : "Create Index"}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={showCreateConfirm} onOpenChange={setShowCreateConfirm}>
      <AlertDialogContent className="max-w-md border-border/60 shadow-2xl">
        <AlertDialogHeader>
          <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-2">
            <Layers size={20} />
          </div>
          <AlertDialogTitle className="text-foreground text-sm font-semibold uppercase tracking-wider">One-time rows read estimate</AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground text-sm leading-relaxed">
            {isEdit ? "Updating" : "Creating"} an index requires a full table scan. This operation will consume approximately 
            <span className="font-mono text-foreground font-bold px-1.5 py-0.5 rounded bg-muted mx-1">
              {targetTableRowCount?.toLocaleString() ?? "???"} 
            </span>
            rows read counts.
            <br /><br />
            Are you sure you want to proceed with {isEdit ? "re-creating" : "creating"} <span className="font-mono text-foreground font-bold">{name}</span> on <span className="font-mono text-foreground font-bold">{targetTable}</span>?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-6 flex gap-2">
          <AlertDialogCancel className="h-9 text-xs font-medium mt-0 border-border/60">Cancel</AlertDialogCancel>
          <AlertDialogAction 
            className="h-9 text-xs font-medium bg-primary hover:bg-primary/90 text-primary-foreground mt-0"
            disabled={isApplying}
            onClick={(e) => {
              e.preventDefault();
              handleSave();
            }}
          >
            {isApplying ? (isEdit ? "Updating..." : "Creating...") : (isEdit ? "Update Index" : "Create Index")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
