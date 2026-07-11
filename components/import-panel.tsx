"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, History, RotateCcw, ShieldCheck, UploadCloud } from "lucide-react";
import { importTransactions, rollbackImport } from "@/app/actions";
import { isoDate, money } from "@/lib/format";
import { parseWorkbook, type ParsedWorkbook } from "@/lib/workbook";

type ImportHistory = { id: string; fileName: string; status: string; rowCount: number; importedCount: number; total: number; createdAt: string };

export function ImportPanel({ history, onImported }: { history: ImportHistory[]; onImported: () => void }) {
  const router = useRouter();
  const today = new Date();
  const [month, setMonth] = useState(isoDate(new Date(today.getFullYear(), today.getMonth(), 1)).slice(0, 7));
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  async function handleFile(nextFile?: File) {
    setMessage(""); setParsed(null); setFile(nextFile || null);
    if (!nextFile) return;
    try {
      const result = parseWorkbook(await nextFile.arrayBuffer(), `${month}-01`, nextFile.name);
      setParsed(result);
      setMessage(result.reconciled ? "Planilha lida e conciliada. Revise os grupos antes de confirmar." : "Os totais da planilha não fecham. A gravação foi bloqueada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não consegui ler a planilha.");
    }
  }

  function submitImport() {
    if (!file || !parsed?.reconciled) return;
    startTransition(async () => {
      try {
        setMessage("Guardando a planilha original no R2…");
        const formData = new FormData(); formData.set("file", file);
        const upload = await fetch("/api/import-file", { method: "POST", body: formData });
        const stored = await upload.json();
        if (!upload.ok) throw new Error(stored.error || "Não foi possível guardar o arquivo original.");
        setMessage("Gravando os lançamentos conciliados…");
        const result = await importTransactions({ ...parsed, fileName: file.name, sourceHash: stored.hash, sourceKey: stored.key });
        if (result.error) throw new Error(result.error);
        setParsed(null); setFile(null);
        setMessage(`Importação concluída com segurança: ${result.imported || 0} lançamentos criados.`);
        router.refresh(); onImported();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "A importação não foi concluída.");
      }
    });
  }

  function undo(batchId: string) {
    if (!window.confirm("Desfazer este lote removerá somente os lançamentos criados por ele. Continuar?")) return;
    startTransition(async () => {
      const result = await rollbackImport(batchId);
      setMessage(result.error || "Importação desfeita. O arquivo original continua preservado no R2.");
      router.refresh();
    });
  }

  return (
    <div className="import-layout">
      <section className="panel import-panel">
        <div className="section-heading">
          <div className="section-icon mint"><FileSpreadsheet size={21} /></div>
          <div><span className="kicker">ENTRADA SEGURA</span><h2>Importar e conciliar</h2><p>Nenhum valor é gravado até a soma das linhas bater com o resumo por cartão.</p></div>
        </div>

        <div className="import-grid">
          <label className="field"><span>Mês da fatura</span><input type="month" value={month} onChange={(event) => { setMonth(event.target.value); setParsed(null); setFile(null); setMessage(""); }} /></label>
          <label className="upload-box">
            <UploadCloud size={25} />
            <b>{file?.name || "Escolher Excel ou CSV"}</b>
            <small>O original será preservado no Cloudflare R2 · até 10 MB</small>
            <input accept=".xlsx,.xls,.csv" type="file" onChange={(event) => handleFile(event.target.files?.[0])} />
          </label>
        </div>

        {message && <div className={`notice ${parsed && !parsed.reconciled ? "danger" : ""}`}>{parsed?.reconciled ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}<span>{message}</span></div>}

        {parsed && <>
          <div className="reconcile-summary">
            <div><span>Total das linhas</span><strong>{money(parsed.calculatedTotal)}</strong></div>
            <div><span>Total do resumo</span><strong>{money(parsed.expectedTotal)}</strong></div>
            <div className={parsed.reconciled ? "reconciled" : "mismatch"}><span>Conciliação</span><strong>{parsed.reconciled ? "100% confere" : "Há diferença"}</strong></div>
          </div>
          <div className="reconcile-table" role="table" aria-label="Conciliação por cartão">
            <div className="reconcile-head" role="row"><span>Cartão ou grupo</span><span>Itens</span><span>Planilha</span><span>Calculado</span><span>Status</span></div>
            {parsed.groups.map((group) => <div className="reconcile-row" role="row" key={group.name}>
              <span className="group-name"><i style={{ background: group.color }} />{group.name}{!group.cardName && <em>revisar</em>}</span>
              <span>{group.rowCount}</span><span>{money(group.expectedTotal)}</span><span>{money(group.calculatedTotal)}</span>
              <span className={group.matched ? "match" : "no-match"}>{group.matched ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}{group.matched ? "Confere" : "Diverge"}</span>
            </div>)}
          </div>
          <div className="import-footer"><div><ShieldCheck size={18} /><span><b>{parsed.rows.length} compras identificadas</b><small>{parsed.format === "FINORA_LEGACY" ? "Cores, parcelas e resumo reconhecidos" : "Formato tabular reconhecido"}</small></span></div><button className="button primary" disabled={!parsed.reconciled || isPending} onClick={submitImport}>{isPending ? "Processando…" : "Confirmar importação conciliada"}</button></div>
        </>}
      </section>

      <section className="panel import-history">
        <div className="section-heading compact"><div className="section-icon"><History size={19} /></div><div><h2>Histórico</h2><p>Cada lote pode ser rastreado e desfeito.</p></div></div>
        <div className="history-list">{history.length ? history.map((item) => <div className="history-row" key={item.id}>
          <div><b>{item.fileName}</b><small>{new Date(item.createdAt).toLocaleString("pt-BR")} · {item.rowCount} linhas</small></div>
          <div><strong>{money(item.total)}</strong><span className={`batch-status ${item.status.toLowerCase()}`}>{item.status === "IMPORTED" ? "Importado" : "Desfeito"}</span></div>
          {item.status === "IMPORTED" && <button className="icon-button" title="Desfazer lote" disabled={isPending} onClick={() => undo(item.id)}><RotateCcw size={16} /></button>}
        </div>) : <div className="empty">Nenhuma importação registrada ainda.</div>}</div>
      </section>
    </div>
  );
}
