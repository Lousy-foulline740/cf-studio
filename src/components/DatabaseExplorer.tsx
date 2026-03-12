// DatabaseExplorer.tsx
//
// Schema visualizer for a selected D1 database.
// Left panel: table list | Right panel: CREATE TABLE SQL

import { useState } from "react";
import {
  ArrowLeft,
  Table2,
  RefreshCw,
  Database,
  ChevronRight,
  AlertCircle,
  BookOpen,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useD1Schema, type D1Database, type D1TableSchema } from "@/hooks/useCloudflare";

// ── SQL formatter (lightweight — no external deps) ────────────────────────────

/** Adds line breaks and indentation to a CREATE TABLE statement for readability. */
function formatSql(raw: string): string {
  return raw
    // One definition per line inside ( )
    .replace(/,\s*/g, ",\n  ")
    .replace(/\(\s*/g, "(\n  ")
    .replace(/\s*\)/g, "\n)")
    // Uppercase keywords
    .replace(
      /\b(CREATE|TABLE|TEXT|INTEGER|REAL|BLOB|NUMERIC|NULL|NOT|PRIMARY|KEY|UNIQUE|DEFAULT|REFERENCES|ON|DELETE|CASCADE|CHECK|AUTOINCREMENT|IF|EXISTS|FOREIGN|CONSTRAINT)\b/g,
      (kw) => kw.toUpperCase()
    )
    .trim();
}

// ── Loading skeleton ───────────────────────────────────────────────────────────

function TableListSkeleton() {
  return (
    <div className="flex flex-col gap-1 px-2 py-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-8 rounded-md bg-muted/50 animate-pulse"
          style={{ opacity: 1 - i * 0.12 }}
        />
      ))}
    </div>
  );
}

// ── Empty / Error panels ───────────────────────────────────────────────────────

function PanelMessage({
  icon: Icon,
  title,
  body,
  iconColor = "text-muted-foreground",
}: {
  icon: React.ElementType;
  title: string;
  body?: React.ReactNode;
  iconColor?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
      <div className={cn("rounded-xl border border-border bg-muted/30 p-3", iconColor)}>
        <Icon size={22} strokeWidth={1.5} />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {body && <p className="text-xs text-muted-foreground">{body}</p>}
      </div>
    </div>
  );
}

// ── SQL Code Block ─────────────────────────────────────────────────────────────

function SqlCodeBlock({ sql }: { sql: string }) {
  const formatted = formatSql(sql);

  // Tokenize for syntax highlighting
  const tokens = formatted.split(
    /(\b(?:CREATE|TABLE|TEXT|INTEGER|REAL|BLOB|NUMERIC|NULL|NOT|PRIMARY|KEY|UNIQUE|DEFAULT|REFERENCES|ON|DELETE|CASCADE|CHECK|AUTOINCREMENT|IF|EXISTS|FOREIGN|CONSTRAINT)\b|"[^"]*"|'[^']*'|--[^\n]*|\d+)/gi
  );

  const SQL_KW = new Set([
    "CREATE","TABLE","TEXT","INTEGER","REAL","BLOB","NUMERIC","NULL","NOT",
    "PRIMARY","KEY","UNIQUE","DEFAULT","REFERENCES","ON","DELETE","CASCADE",
    "CHECK","AUTOINCREMENT","IF","EXISTS","FOREIGN","CONSTRAINT",
  ]);

  return (
    <pre className="select-text text-left text-sm font-mono leading-6 p-5 overflow-auto whitespace-pre-wrap break-words">
      {tokens.map((tok, i) => {
        if (SQL_KW.has(tok.toUpperCase())) {
          return <span key={i} className="text-primary font-semibold">{tok}</span>;
        }
        if (/^["']/.test(tok)) {
          return <span key={i} className="text-amber-400">{tok}</span>;
        }
        if (/^--/.test(tok)) {
          return <span key={i} className="text-muted-foreground/60 italic">{tok}</span>;
        }
        if (/^\d+$/.test(tok)) {
          return <span key={i} className="text-sky-400">{tok}</span>;
        }
        return <span key={i} className="text-foreground">{tok}</span>;
      })}
    </pre>
  );
}

// ── Table list item ────────────────────────────────────────────────────────────

function TableListItem({
  table,
  active,
  onClick,
}: {
  table: D1TableSchema;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex items-center gap-2 w-full rounded-md px-2.5 py-1.5 text-sm text-left",
        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-accent text-accent-foreground font-medium"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      )}
    >
      <Table2
        size={13}
        strokeWidth={active ? 2 : 1.75}
        className={cn("shrink-0", active ? "text-primary" : "text-muted-foreground/50")}
      />
      <span className="flex-1 truncate">{table.name}</span>
      {active && <ChevronRight size={12} className="text-primary shrink-0" />}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface DatabaseExplorerProps {
  database: D1Database;
  onBack: () => void;
}

export function DatabaseExplorer({ database, onBack }: DatabaseExplorerProps) {
  const [selectedTable, setSelectedTable] = useState<D1TableSchema | null>(null);
  const { state, refresh } = useD1Schema(database.uuid);

  const isLoading = state.status === "idle" || state.status === "loading";
  const tables = state.status === "success" ? state.data : [];

  return (
    <div className="flex flex-col h-full gap-0 min-h-0">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 pb-4 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="gap-1.5 text-muted-foreground hover:text-foreground -ml-2"
        >
          <ArrowLeft size={14} strokeWidth={2} />
          Databases
        </Button>

        <Separator orientation="vertical" className="h-4" />

        <div className="flex items-center gap-2 min-w-0">
          <Database size={14} strokeWidth={1.75} className="text-primary shrink-0" />
          <span className="font-semibold text-sm text-foreground truncate">
            {database.name}
          </span>
          {database.version && (
            <Badge variant="secondary" className="font-mono text-[10px] uppercase shrink-0">
              {database.version}
            </Badge>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={refresh}
          disabled={isLoading}
          className="ml-auto text-muted-foreground hover:text-foreground"
          aria-label="Refresh schema"
        >
          <RefreshCw size={13} className={cn(isLoading && "animate-spin")} />
        </Button>
      </div>

      {/* ── Explorer body ── */}
      <div className="flex flex-1 min-h-0 rounded-lg border border-border overflow-hidden">

        {/* Left: table list */}
        <div className="w-[200px] shrink-0 border-r border-border flex flex-col bg-muted/20">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-medium">
              Tables
            </span>
            {state.status === "success" && (
              <span className="text-[10px] text-muted-foreground/40">
                {tables.length}
              </span>
            )}
          </div>

          <ScrollArea className="flex-1">
            <div className="p-1.5">
              {isLoading && <TableListSkeleton />}

              {state.status === "error" && (
                <div className="flex flex-col items-center gap-2 py-6 px-2 text-center">
                  <AlertCircle size={16} className="text-destructive" />
                  <p className="text-xs text-muted-foreground break-words">
                    {state.message}
                  </p>
                </div>
              )}

              {state.status === "success" && tables.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6 px-2">
                  No tables found
                </p>
              )}

              {state.status === "success" &&
                tables.map((table) => (
                  <TableListItem
                    key={table.name}
                    table={table}
                    active={selectedTable?.name === table.name}
                    onClick={() => setSelectedTable(table)}
                  />
                ))}
            </div>
          </ScrollArea>
        </div>

        {/* Right: SQL viewer */}
        <div className="flex-1 min-w-0 flex flex-col bg-background">
          {!selectedTable && (
            <PanelMessage
              icon={BookOpen}
              title="Select a table"
              body="Click a table name to view its CREATE TABLE statement"
            />
          )}

          {selectedTable && !selectedTable.sql && (
            <PanelMessage
              icon={AlertCircle}
              title="No schema available"
              body={`${selectedTable.name} has no recorded CREATE TABLE statement`}
              iconColor="text-muted-foreground"
            />
          )}

          {selectedTable?.sql && (
            <div className="flex flex-col h-full min-h-0">
              {/* Code header */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0 bg-muted/20">
                <div className="flex items-center gap-2">
                  <Table2 size={13} strokeWidth={1.75} className="text-primary" />
                  <span className="text-xs font-medium text-foreground">
                    {selectedTable.name}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">
                  CREATE TABLE
                </span>
              </div>

              {/* Code body */}
              <ScrollArea className="flex-1">
                <div className="bg-muted/10 min-h-full">
                  <SqlCodeBlock sql={selectedTable.sql} />
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
