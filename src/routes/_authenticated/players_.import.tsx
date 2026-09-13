import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import Papa from "papaparse";
import JSZip from "jszip";
import { toast } from "sonner";
import { ArrowLeft, Download, FileText, FileArchive, Loader2, Upload, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/players_/import")({
  head: () => ({
    meta: [
      { title: "Import Players | PitchBid" },
      { name: "description", content: "Import player records and photos into PitchBid." },
      { property: "og:title", content: "Import Players | PitchBid" },
      { property: "og:description", content: "Import player records and photos into PitchBid." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BulkImportPage,
});

const ROLE_MAP: Record<string, "batter" | "bowler" | "allrounder" | "batting_allrounder" | "bowling_allrounder" | "wicket_keeper" | "none"> = {
  batter: "batter",
  batsman: "batter",
  bowler: "bowler",
  allrounder: "allrounder",
  "all-rounder": "allrounder",
  "all rounder": "allrounder",
  batting_allrounder: "batting_allrounder",
  "batting allrounder": "batting_allrounder",
  "batting all-rounder": "batting_allrounder",
  bowling_allrounder: "bowling_allrounder",
  "bowling allrounder": "bowling_allrounder",
  "bowling all-rounder": "bowling_allrounder",
  wicket_keeper: "wicket_keeper",
  "wicket keeper": "wicket_keeper",
  wicketkeeper: "wicket_keeper",
  wk: "wicket_keeper",
  none: "none",
  "": "none",
};

type Row = {
  raw: Record<string, string>;
  name: string;
  role: string;
  malayali: "malayali" | "non_malayali" | null;
  batting_style: string;
  bowling_style: string;
  matches: number;
  runs: number;
  wickets: number;
  batting_avg: number;
  batting_sr: number;
  bowling_economy: number;
  photo_filename: string;
  cric_heroes_link: string;
  error: string | null;
};

const TEMPLATE = `name,role,malayali,batting_style,bowling_style,matches,runs,wickets,bowling_economy,batting_avg,batting_sr,photo_filename,cric_heroes_link
MS Dhoni,wicket_keeper,Malayali,Right-hand bat,Right-arm medium,350,10773,1,0,38.09,87.56,dhoni.jpg,https://cricheroes.com/player/123
`;

function parseNumber(v: string | undefined): number {
  if (!v) return 0;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : 0;
}

function BulkImportPage() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [photos, setPhotos] = useState<Map<string, Blob>>(new Map());
  const [csvName, setCsvName] = useState<string>("");
  const [zipName, setZipName] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ inserted: number; failed: { name: string; reason: string }[] } | null>(null);

  const validRows = useMemo(() => rows.filter((r) => !r.error), [rows]);
  const invalidRows = useMemo(() => rows.filter((r) => r.error), [rows]);

  if (!isAdmin) {
    return <p className="text-muted-foreground">Admin access required.</p>;
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "players_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function onCsvChange(file: File | null) {
    if (!file) return;
    setCsvName(file.name);
    setResult(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const next: Row[] = res.data.map((raw) => validateRow(raw, photos));
        setRows(next);
      },
      error: (err) => toast.error(`CSV parse error: ${err.message}`),
    });
  }

  async function onZipChange(file: File | null) {
    if (!file) return;
    setZipName(file.name);
    setResult(null);
    try {
      const zip = await JSZip.loadAsync(file);
      const map = new Map<string, Blob>();
      await Promise.all(
        Object.values(zip.files)
          .filter((f) => !f.dir)
          .map(async (f) => {
            const base = f.name.split("/").pop() ?? f.name;
            const blob = await f.async("blob");
            map.set(base, blob);
          }),
      );
      setPhotos(map);
      // re-validate rows now that we have photos
      setRows((prev) => prev.map((r) => validateRow(r.raw, map)));
      toast.success(`Loaded ${map.size} photo(s)`);
    } catch (e: any) {
      toast.error(`ZIP parse error: ${e.message ?? e}`);
    }
  }

  async function runImport() {
    if (validRows.length === 0) {
      toast.error("No valid rows to import");
      return;
    }
    setImporting(true);
    setProgress({ done: 0, total: validRows.length });
    const failed: { name: string; reason: string }[] = [];
    let inserted = 0;

    for (let i = 0; i < validRows.length; i++) {
      const r = validRows[i];
      try {
        let photoUrl: string | null = null;
        if (r.photo_filename) {
          const blob = photos.get(r.photo_filename);
          if (blob) {
            const ext = r.photo_filename.split(".").pop() ?? "jpg";
            const path = `bulk/${crypto.randomUUID()}.${ext}`;
            const { error: upErr } = await supabase.storage
              .from("player-photos")
              .upload(path, blob, { contentType: blob.type || `image/${ext}`, upsert: false });
            if (upErr) throw new Error(`photo upload: ${upErr.message}`);
            const { data: pub } = supabase.storage.from("player-photos").getPublicUrl(path);
            photoUrl = pub.publicUrl;
          }
        }
        const { error: insErr } = await supabase.from("players").insert({
          name: r.name,
          role: r.role as any,
          malayali: r.malayali,
          batting_style: r.batting_style || null,
          bowling_style: r.bowling_style || null,
          matches: r.matches,
          runs: r.runs,
          wickets: r.wickets,
          batting_avg: r.batting_avg,
          batting_sr: r.batting_sr,
          bowling_economy: r.bowling_economy,
          photo: photoUrl,
          cric_heroes_link: r.cric_heroes_link || null,
        });
        if (insErr) throw new Error(insErr.message);
        inserted++;
      } catch (e: any) {
        failed.push({ name: r.name || "(unnamed)", reason: e.message ?? String(e) });
      }
      setProgress({ done: i + 1, total: validRows.length });
    }

    setImporting(false);
    setResult({ inserted, failed });
    if (inserted > 0) toast.success(`Imported ${inserted} player(s)`);
    if (failed.length > 0) toast.error(`${failed.length} row(s) failed`);
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/players" })}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to players
      </Button>

      <div>
        <h1 className="text-3xl font-bold tracking-tight">Bulk import players</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload a CSV of player stats plus a zip of their photos. Photos in the zip are matched to each row by filename.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Step 1 — CSV template</p>
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="h-4 w-4 mr-1" /> Download template
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Required headers: <code>name, role, malayali, batting_style, bowling_style, matches, runs, wickets, bowling_economy, batting_avg, batting_sr, photo_filename, cric_heroes_link</code>.
          Roles accepted: batter, bowler, allrounder, batting_allrounder, bowling_allrounder, wicket_keeper.
          Malayali values accepted: Malayali, Non-Malayali, or blank.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <FileBox
          icon={<FileText className="h-5 w-5" />}
          label="CSV file"
          accept=".csv,text/csv"
          filename={csvName}
          onChange={onCsvChange}
        />
        <FileBox
          icon={<FileArchive className="h-5 w-5" />}
          label="Photos ZIP"
          accept=".zip,application/zip"
          filename={zipName ? `${zipName} · ${photos.size} photo(s)` : ""}
          onChange={onZipChange}
        />
      </div>

      {rows.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Preview · {rows.length} row(s)</p>
              <p className="text-xs text-muted-foreground">
                <span className="text-emerald-500">{validRows.length} ready</span>
                {invalidRows.length > 0 && <> · <span className="text-destructive">{invalidRows.length} with issues</span></>}
              </p>
            </div>
            <Button onClick={runImport} disabled={importing || validRows.length === 0}>
              {importing
                ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Importing {progress.done}/{progress.total}</>
                : <><Upload className="h-4 w-4 mr-1" /> Import {validRows.length} player(s)</>}
            </Button>
          </div>
          <div className="max-h-[400px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Name</th>
                  <th className="text-left p-2">Role</th>
                  <th className="text-left p-2">Malayali</th>
                  <th className="text-left p-2">Photo</th>
                  <th className="text-left p-2">Issue</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-2">
                      {r.error
                        ? <XCircle className="h-4 w-4 text-destructive" />
                        : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                    </td>
                    <td className="p-2 font-medium">{r.name || <span className="text-muted-foreground italic">missing</span>}</td>
                    <td className="p-2 capitalize">{r.role?.replace(/_/g, " ")}</td>
                    <td className="p-2">{r.malayali === "malayali" ? "Malayali" : r.malayali === "non_malayali" ? "Non-Malayali" : "—"}</td>
                    <td className="p-2 font-mono text-[10px]">
                      {r.photo_filename
                        ? (photos.has(r.photo_filename)
                            ? <span className="text-emerald-500">{r.photo_filename}</span>
                            : <span className="text-amber-500">{r.photo_filename} (not in zip)</span>)
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-2 text-destructive">{r.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-2">
          <p className="text-sm font-semibold">Import result</p>
          <p className="text-sm text-emerald-500">Inserted: {result.inserted}</p>
          {result.failed.length > 0 && (
            <div>
              <p className="text-sm text-destructive">Failed: {result.failed.length}</p>
              <ul className="mt-2 text-xs text-muted-foreground space-y-1 max-h-40 overflow-auto">
                {result.failed.map((f, i) => (
                  <li key={i}><strong>{f.name}</strong>: {f.reason}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="pt-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/players">View players</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function validateRow(raw: Record<string, string>, photos: Map<string, Blob>): Row {
  const name = (raw.name ?? "").trim();
  const roleRaw = (raw.role ?? "").trim().toLowerCase();
  const role = ROLE_MAP[roleRaw] ?? "";
  const malayaliRaw = (raw.malayali ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const malayali = malayaliRaw === "malayali"
    ? "malayali" as const
    : malayaliRaw === "non_malayali"
      ? "non_malayali" as const
      : null;
  const photo_filename = (raw.photo_filename ?? "").trim();
  const errors: string[] = [];
  if (!name) errors.push("name missing");
  if (!role) errors.push(`role invalid (${raw.role ?? ""})`);
  if (malayaliRaw && !malayali) errors.push(`malayali invalid (${raw.malayali ?? ""})`);
  if (photo_filename && photos.size > 0 && !photos.has(photo_filename)) {
    errors.push("photo not in zip");
  }
  return {
    raw,
    name,
    role,
    malayali,
    batting_style: (raw.batting_style ?? "").trim(),
    bowling_style: (raw.bowling_style ?? "").trim(),
    matches: parseNumber(raw.matches),
    runs: parseNumber(raw.runs),
    wickets: parseNumber(raw.wickets),
    batting_avg: parseNumber(raw.batting_avg),
    batting_sr: parseNumber(raw.batting_sr),
    bowling_economy: parseNumber(raw.bowling_economy),
    photo_filename,
    cric_heroes_link: (raw.cric_heroes_link ?? "").trim(),
    error: errors.length ? errors.join("; ") : null,
  };
}

function FileBox({
  icon, label, accept, filename, onChange,
}: {
  icon: React.ReactNode;
  label: string;
  accept: string;
  filename: string;
  onChange: (f: File | null) => void;
}) {
  return (
    <label className="rounded-xl border border-dashed border-border bg-card p-5 flex items-center gap-3 cursor-pointer hover:border-primary/50 transition">
      <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground truncate">{filename || "Click to choose a file"}</p>
      </div>
      <input type="file" accept={accept} className="hidden" onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
    </label>
  );
}