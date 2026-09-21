"use client";

import { memo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { diffLines, diffWords } from "diff";

const CONTEXT = 3;

type WordSpan = { text: string; kind: "equal" | "removed" | "added" };

function wordDiff(oldLine: string, newLine: string): { left: WordSpan[]; right: WordSpan[] } {
  const parts = diffWords(oldLine, newLine);
  const left: WordSpan[] = [];
  const right: WordSpan[] = [];
  for (const p of parts) {
    if (p.added) { right.push({ text: p.value, kind: "added" }); }
    else if (p.removed) { left.push({ text: p.value, kind: "removed" }); }
    else { left.push({ text: p.value, kind: "equal" }); right.push({ text: p.value, kind: "equal" }); }
  }
  return { left, right };
}

function InlineSpans({ spans, side }: { spans: WordSpan[]; side: "left" | "right" }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.kind === "equal") return <span key={i}>{s.text}</span>;
        if (side === "left" && s.kind === "removed")
          return <span key={i} className="rounded-sm bg-destructive/40 text-destructive">{s.text}</span>;
        if (side === "right" && s.kind === "added")
          return <span key={i} className="rounded-sm bg-emerald-500/30 text-emerald-700 dark:text-emerald-300">{s.text}</span>;
        return null;
      })}
    </>
  );
}

type FlatRow = { kind: "added" | "removed" | "context"; text: string };

type SplitRow =
  | { kind: "context"; text: string }
  | { kind: "change"; removed: string | null; added: string | null }
  | { kind: "ellipsis" };

function buildFlat(oldStr: string, newStr: string): FlatRow[] {
  const changes = diffLines(oldStr, newStr);
  const flat: FlatRow[] = [];
  for (const part of changes) {
    const kind: FlatRow["kind"] = part.added ? "added" : part.removed ? "removed" : "context";
    const lines = part.value.replace(/\n$/, "").split("\n");
    for (const text of lines) flat.push({ kind, text });
  }
  return flat;
}

function collapseFlat(flat: FlatRow[]): (FlatRow | { kind: "ellipsis" })[] {
  const keep = new Set<number>();
  flat.forEach((r, i) => {
    if (r.kind !== "context") {
      for (let k = Math.max(0, i - CONTEXT); k <= Math.min(flat.length - 1, i + CONTEXT); k++) keep.add(k);
    }
  });
  if (keep.size === 0) return flat;

  const result: (FlatRow | { kind: "ellipsis" })[] = [];
  let prevKept = false;
  flat.forEach((r, i) => {
    if (keep.has(i)) {
      if (!prevKept && result.length > 0) result.push({ kind: "ellipsis" });
      result.push(r);
      prevKept = true;
    } else {
      prevKept = false;
    }
  });
  if (flat.length > 0 && !keep.has(flat.length - 1)) result.push({ kind: "ellipsis" });
  return result;
}

function toSplitRows(flat: (FlatRow | { kind: "ellipsis" })[]): SplitRow[] {
  const result: SplitRow[] = [];
  let i = 0;
  while (i < flat.length) {
    const r = flat[i];
    if (r.kind === "ellipsis") { result.push({ kind: "ellipsis" }); i++; continue; }
    if (r.kind === "context") { result.push({ kind: "context", text: r.text }); i++; continue; }
    const removed: string[] = [];
    const added: string[] = [];
    while (i < flat.length && flat[i].kind === "removed") { removed.push((flat[i] as FlatRow).text); i++; }
    while (i < flat.length && flat[i].kind === "added") { added.push((flat[i] as FlatRow).text); i++; }
    const max = Math.max(removed.length, added.length);
    for (let j = 0; j < max; j++) {
      result.push({ kind: "change", removed: removed[j] ?? null, added: added[j] ?? null });
    }
  }
  return result;
}

function DiffTable({ rows }: { rows: SplitRow[] }) {
  return (
    <div className="grid grid-cols-2 divide-x divide-border/40 font-mono text-[11px] leading-5">
      <div className="min-w-0">
        {rows.map((row, i) => {
          if (row.kind === "ellipsis") return <div key={i} className="px-2 py-px text-muted-foreground/40 select-none">···</div>;
          if (row.kind === "context") return <div key={i} className="px-2 py-px text-muted-foreground/70 whitespace-pre-wrap break-all">{row.text || " "}</div>;
          if (row.removed === null) return <div key={i} className="px-2 py-px" />;
          if (row.added !== null) {
            const { left } = wordDiff(row.removed, row.added);
            return <div key={i} className="px-2 py-px whitespace-pre-wrap break-all bg-destructive/10"><InlineSpans spans={left} side="left" /></div>;
          }
          return <div key={i} className="px-2 py-px whitespace-pre-wrap break-all bg-destructive/10 text-destructive">{row.removed}</div>;
        })}
      </div>
      <div className="min-w-0">
        {rows.map((row, i) => {
          if (row.kind === "ellipsis") return <div key={i} className="px-2 py-px text-muted-foreground/40 select-none">···</div>;
          if (row.kind === "context") return <div key={i} className="px-2 py-px text-muted-foreground/70 whitespace-pre-wrap break-all">{row.text || " "}</div>;
          if (row.added === null) return <div key={i} className="px-2 py-px" />;
          if (row.removed !== null) {
            const { right } = wordDiff(row.removed, row.added);
            return <div key={i} className="px-2 py-px whitespace-pre-wrap break-all bg-emerald-500/10"><InlineSpans spans={right} side="right" /></div>;
          }
          return <div key={i} className="px-2 py-px whitespace-pre-wrap break-all bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">{row.added}</div>;
        })}
      </div>
    </div>
  );
}

export const EditFileDiff = memo(function EditFileDiff({
  oldString,
  newString,
}: {
  oldString: string;
  newString: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(document.getElementById("chat-area")); }, []);

  const flat = buildFlat(oldString, newString);
  const collapsedRows = toSplitRows(collapseFlat(flat));
  const fullRows = toSplitRows(flat);

  return (
    <>
      <div
        className="scroll-hover-visible overflow-auto rounded border border-border/60 bg-muted/20 max-h-64 cursor-pointer hover:border-border transition-colors"
        onClick={() => setExpanded(true)}
        title="Нажмите чтобы развернуть"
      >
        <div className="sticky top-0 z-10 grid grid-cols-2 divide-x divide-border/40 border-b border-border/40 bg-muted/60 backdrop-blur-sm">
          <div className="px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/60 select-none">Было</div>
          <div className="px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/60 select-none">Стало</div>
        </div>
        <DiffTable rows={collapsedRows} />
      </div>

      {expanded && host && createPortal(
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
          onClick={() => setExpanded(false)}
        >
          <div
            className="flex flex-col w-full max-w-4xl max-h-[80vh] rounded-xl border border-border bg-background shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5 shrink-0">
              <div className="grid grid-cols-2 gap-4 flex-1 font-mono text-xs text-muted-foreground">
                <span>Было</span>
                <span>Стало</span>
              </div>
              <button type="button" onClick={() => setExpanded(false)} className="ml-4 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                <X className="size-4" />
              </button>
            </div>
            <div className="scroll-hover-visible flex-1 overflow-auto">
              <DiffTable rows={fullRows} />
            </div>
          </div>
        </div>,
        host,
      )}
    </>
  );
});
