"use client";

import { useMemo, useState, useTransition } from "react";
import * as XLSX from "xlsx";
import { FileSpreadsheet, UploadCloud } from "lucide-react";
import { importTransactions } from "@/app/actions";
import { isoDate, money } from "@/lib/format";

type ImportRow = {
  description: string;
  amount: number;
  type: "EXPENSE" | "INCOME";
  competenceDate: string;
  dueDate?: string;
  categoryName?: string;
  cardName?: string;
  accountName?: string;
  installmentCurrent: number;
  installmentCount: number;
  notes?: string;
  source?: string;
};

type ImportPanelProps = {
  onImported: () => void;
};

const today = new Date();

export function ImportPanel({ onImported }: ImportPanelProps) {
  const [month, setMonth] = useState(isoDate(new Date(today.getFullYear(), today.getMonth(), 1)).slice(0, 7));
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const total = useMemo(() => rows.reduce((sum, row) => sum + row.amount * Math.max(row.installmentCount - row.installmentCurrent + 1, 1), 0), [rows]);

  async function handleFile(file?: File) {
    setMessage("");
    if (!file) return;
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
      const parsed = parseSheet(rawRows, `${month}-01`, file.name);
      setRows(parsed);
      setMessage(parsed.length ? `${parsed.length} linha(s) pronta(s) para importar.` : "Não encontrei linhas com descrição e valor nessa planilha.");
    } catch {
      setRows([]);
      setMessage("Não consegui ler o arquivo. Use .xlsx, .xls ou .csv.");
    }
  }

  function submitImport() {
    if (!rows.length) return;
    startTransition(async () => {
      const result = await importTransactions(rows);
      if (result.error) {
        setMessage(result.error);
        return;
      }
      setMessage(`Importação concluída: ${result.imported || 0} lançamento(s), ${result.skipped || 0} repetido(s) ignorado(s).`);
      setRows([]);
      onImported();
    });
  }

  return (
    <section className="panel import-panel">
      <div className="panel-header">
        <div>
          <h2>Importar Excel ou CSV</h2>
          <p>Traga a planilha antiga para dentro do sistema com conferência antes de gravar.</p>
        </div>
      </div>

      <div className="import-grid">
        <label className="field">
          <span>Mês de competência</span>
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
        <label className="upload-box">
          <UploadCloud size={24} />
          <b>{fileName || "Selecionar planilha"}</b>
          <small>Arquivos .xlsx, .xls ou .csv</small>
          <input accept=".xlsx,.xls,.csv" type="file" onChange={(event) => handleFile(event.target.files?.[0])} />
        </label>
      </div>

      {message && <p className="import-message">{message}</p>}

      {rows.length > 0 && (
        <>
          <div className="import-summary">
            <span><FileSpreadsheet size={16} /> {rows.length} linha(s)</span>
            <strong>{money(total)}</strong>
          </div>
          <div className="import-preview">
            {rows.slice(0, 12).map((row, index) => (
              <div className="import-row" key={`${row.description}-${index}`}>
                <div>
                  <b>{row.description}</b>
                  <small>{row.categoryName || "Categoria automática"}{row.installmentCount > 1 ? ` · ${row.installmentCurrent}/${row.installmentCount}` : ""}</small>
                </div>
                <strong>{money(row.amount)}</strong>
              </div>
            ))}
          </div>
          <button className="button primary import-submit" disabled={isPending} onClick={submitImport}>
            {isPending ? "Importando..." : "Confirmar importação"}
          </button>
        </>
      )}
    </section>
  );
}

function parseSheet(rows: unknown[][], competenceDate: string, source: string): ImportRow[] {
  const headerIndex = rows.findIndex((row) => row.some((cell) => /descri|lan[cç]amento|valor/i.test(String(cell))));
  if (headerIndex >= 0) return parseWithHeader(rows.slice(headerIndex), competenceDate, source);
  return parseLegacyRows(rows, competenceDate, source);
}

function parseWithHeader(rows: unknown[][], competenceDate: string, source: string) {
  const headers = rows[0].map((cell) => normalize(String(cell)));
  return rows.slice(1).map((row) => rowFromColumns(row, headers, competenceDate, source)).filter(Boolean) as ImportRow[];
}

function rowFromColumns(row: unknown[], headers: string[], competenceDate: string, source: string): ImportRow | null {
  const get = (...names: string[]) => {
    const index = headers.findIndex((header) => names.some((name) => header.includes(name)));
    return index >= 0 ? row[index] : "";
  };
  const description = String(get("descricao", "lancamento", "nome", "historico")).trim();
  const amount = parseMoney(get("valor", "preco", "total"));
  if (!description || amount === null || amount <= 0) return null;
  const installment = parseInstallment(get("parcela", "parcelamento"));
  const dueDate = parseDate(get("vencimento", "data"));
  return {
    description,
    amount,
    type: normalize(String(get("tipo"))).includes("receita") ? "INCOME" : "EXPENSE",
    competenceDate,
    dueDate,
    categoryName: String(get("categoria")).trim() || undefined,
    cardName: String(get("cartao")).trim() || undefined,
    accountName: String(get("conta")).trim() || undefined,
    installmentCurrent: installment.current,
    installmentCount: installment.total,
    notes: String(get("observacao", "obs", "nota")).trim() || undefined,
    source,
  };
}

function parseLegacyRows(rows: unknown[][], competenceDate: string, source: string) {
  return rows.slice(3).map((row) => {
    const description = String(row[0] ?? "").trim();
    const amount = parseMoney(row[1]);
    if (!description || amount === null || amount <= 0) return null;
    const installment = parseInstallment(row[2]);
    const notes = String(row[4] ?? "").trim();
    return { description, amount, type: "EXPENSE" as const, competenceDate, installmentCurrent: installment.current, installmentCount: installment.total, notes: notes || undefined, source };
  }).filter(Boolean) as ImportRow[];
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function parseMoney(value: unknown) {
  if (typeof value === "number") return value;
  const parsed = Number(String(value ?? "").replace(/R\$\s?/gi, "").replace(/\./g, "").replace(",", ".").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInstallment(value: unknown) {
  const match = String(value ?? "").match(/(\d+)\s*(?:de|\/)\s*(\d+)/i);
  if (!match) return { current: 1, total: 1 };
  return { current: Number(match[1]), total: Number(match[2]) };
}

function parseDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return isoDate(value);
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return isoDate(new Date(parsed.y, parsed.m - 1, parsed.d));
  }
  const match = String(value ?? "").match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!match) return undefined;
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  return isoDate(new Date(year, Number(match[2]) - 1, Number(match[1])));
}
