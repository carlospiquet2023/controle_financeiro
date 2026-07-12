"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import {
  Building2,
  Calculator,
  Check,
  FileCode2,
  HandCoins,
  ReceiptText,
  Scale,
  ShieldAlert,
  UploadCloud,
  Users,
} from "lucide-react";
import {
  createTaxLedgerEntry,
  createTransactionFromTaxDocument,
  saveTaxCashbackScenario,
  simulateTax,
  type TaxSimulationState,
} from "@/app/tax-actions";
import { money } from "@/lib/format";
import { TRANSITION_RULES } from "@/lib/tax";

type TaxDocument = {
  id: string;
  fileName: string;
  documentType: string;
  accessKey: string | null;
  issuerName: string | null;
  issuedAt: string | null;
  totalAmount: number;
  cbsAmount: number;
  ibsStateAmount: number;
  ibsCityAmount: number;
  selectiveTaxAmount: number;
  status: string;
  itemCount: number;
  createdAt: string;
  categoryName: string | null;
  transactionId: string | null;
};
type TaxSimulation = {
  id: string;
  mode: string;
  operationDate: string;
  input: unknown;
  result: unknown;
  createdAt: string;
  ruleVersion: { code: string; name: string; sourceUrl: string };
};
type LedgerEntry = {
  id: string;
  kind: string;
  competenceDate: string;
  description: string;
  cbsAmount: number;
  ibsAmount: number;
  selectiveTaxAmount: number;
  sourceReference: string | null;
};
type CashbackScenario = {
  competenceDate: string;
  estimatedAmount: number;
  receivedAmount: number;
  inputs: Record<string, unknown> | null;
};

export function TaxCenter({
  documents,
  simulations,
  ledger,
  cashbacks,
}: {
  documents: TaxDocument[];
  simulations: TaxSimulation[];
  ledger: LedgerEntry[];
  cashbacks: CashbackScenario[];
}) {
  const [mode, setMode] = useState<"FAMILY" | "BUSINESS">("FAMILY");
  const [tab, setTab] = useState<
    "SIMULATION" | "DOCUMENTS" | "TRANSITION" | "CASHBACK" | "LEDGER"
  >("SIMULATION");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const cbs = documents.reduce((sum, item) => sum + item.cbsAmount, 0);
  const ibsState = documents.reduce(
    (sum, item) => sum + item.ibsStateAmount,
    0,
  );
  const ibsCity = documents.reduce((sum, item) => sum + item.ibsCityAmount, 0);
  const selective = documents.reduce(
    (sum, item) => sum + item.selectiveTaxAmount,
    0,
  );
  const spending = documents.reduce((sum, item) => sum + item.totalAmount, 0);
  const taxByCategory = Object.values(
    documents.reduce<
      Record<string, { category: string; spending: number; taxes: number }>
    >((result, item) => {
      const category = item.categoryName || "Sem categoria";
      const current = result[category] || { category, spending: 0, taxes: 0 };
      current.spending += item.totalAmount;
      current.taxes +=
        item.cbsAmount +
        item.ibsStateAmount +
        item.ibsCityAmount +
        item.selectiveTaxAmount;
      result[category] = current;
      return result;
    }, {}),
  ).sort((left, right) => right.taxes - left.taxes);
  async function upload(file?: File) {
    if (!file) return;
    setMessage("Lendo e preservando o XML fiscal…");
    const body = new FormData();
    body.set("file", file);
    const response = await fetch("/api/tax/documents/import", {
      method: "POST",
      body,
    });
    const result = await response.json();
    setMessage(
      response.ok
        ? `${result.document.type} importada: ${result.document.items} itens identificados.`
        : result.error,
    );
    if (response.ok) window.location.reload();
  }
  function createTransaction(id: string) {
    startTransition(async () => {
      const result = await createTransactionFromTaxDocument(id);
      setMessage(
        result.error ||
          "Lançamento criado a partir do documento. Revise categoria e cartão.",
      );
    });
  }
  return (
    <div className="tax-center">
      <section className="tax-hero">
        <div>
          <span className="kicker light">
            CENTRAL IVA — IBS, CBS E IMPOSTO SELETIVO
          </span>
          <h2>{money(cbs + ibsState + ibsCity + selective)}</h2>
          <p>
            tributos identificados em documentos fiscais · modo informativo e
            sem efeito fiscal
          </p>
          {taxByCategory.length > 0 && (
            <div className="tax-map">
              <span className="kicker">MAPA TRIBUTÁRIO FAMILIAR</span>
              {taxByCategory.map((item) => (
                <div key={item.category}>
                  <span>
                    <b>{item.category}</b>
                    <small>{money(item.spending)} em compras vinculadas</small>
                  </span>
                  <strong>{money(item.taxes)}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="tax-mode">
          <button
            className={mode === "FAMILY" ? "active" : ""}
            onClick={() => setMode("FAMILY")}
          >
            <Users />
            Pessoa e família
          </button>
          <button
            className={mode === "BUSINESS" ? "active" : ""}
            onClick={() => setMode("BUSINESS")}
          >
            <Building2 />
            Empresa e profissional
          </button>
        </div>
      </section>
      <div className="tax-disclaimer">
        <ShieldAlert />
        <span>
          <b>Simulação versionada, não aconselhamento tributário.</b>
          <small>
            Valores exatos dependem do XML, classificação, regime e regras
            oficiais vigentes na data da operação.
          </small>
        </span>
      </div>
      <section className="summary-grid compact-stats">
        <article className="stat blue">
          <div>
            <p>CBS identificada</p>
            <h3>{money(cbs)}</h3>
            <small>Documentos importados</small>
          </div>
        </article>
        <article className="stat mint">
          <div>
            <p>IBS estadual</p>
            <h3>{money(ibsState)}</h3>
            <small>Valores destacados</small>
          </div>
        </article>
        <article className="stat gold">
          <div>
            <p>IBS municipal</p>
            <h3>{money(ibsCity)}</h3>
            <small>Valores destacados</small>
          </div>
        </article>
        <article className="stat coral">
          <div>
            <p>Imposto Seletivo</p>
            <h3>{money(selective)}</h3>
            <small>Sobre {money(spending)} em documentos</small>
          </div>
        </article>
      </section>
      <nav className="tax-tabs">
        <button
          className={tab === "SIMULATION" ? "active" : ""}
          onClick={() => setTab("SIMULATION")}
        >
          <Calculator />
          Simular
        </button>
        {mode === "FAMILY" && (
          <button
            className={tab === "CASHBACK" ? "active" : ""}
            onClick={() => setTab("CASHBACK")}
          >
            <HandCoins />
            Cashback
          </button>
        )}
        <button
          className={tab === "DOCUMENTS" ? "active" : ""}
          onClick={() => setTab("DOCUMENTS")}
        >
          <FileCode2 />
          Documentos
        </button>
        <button
          className={tab === "TRANSITION" ? "active" : ""}
          onClick={() => setTab("TRANSITION")}
        >
          <Scale />
          Transição 2026–2033
        </button>
        {mode === "BUSINESS" && (
          <button
            className={tab === "LEDGER" ? "active" : ""}
            onClick={() => setTab("LEDGER")}
          >
            <ReceiptText />
            Débitos e créditos
          </button>
        )}
      </nav>
      {message && (
        <div
          className={
            /não|erro|inválid/i.test(message) ? "notice danger" : "notice"
          }
        >
          {message}
        </div>
      )}
      {tab === "SIMULATION" && (
        <TaxSimulator mode={mode} simulations={simulations} />
      )}
      {tab === "DOCUMENTS" && (
        <section className="panel tax-documents">
          <div className="panel-heading">
            <div>
              <span className="kicker">NF-E E NFC-E</span>
              <h2>Documentos fiscais</h2>
            </div>
            <label className="button primary">
              <UploadCloud />
              Importar XML
              <input
                type="file"
                accept=".xml,application/xml,text/xml"
                onChange={(event) => {
                  void upload(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          <p>
            O XML é preservado no R2 e os valores destacados são lidos item a
            item. A validação oficial continua sujeita ao motor da Receita.
          </p>
          <div className="tax-document-list">
            {documents.length ? (
              documents.map((document) => (
                <article key={document.id}>
                  <span>
                    <b>{document.issuerName || document.documentType}</b>
                    <small>
                      {document.documentType} · {document.itemCount} itens ·{" "}
                      {document.issuedAt
                        ? new Date(document.issuedAt).toLocaleDateString(
                            "pt-BR",
                          )
                        : "data não identificada"}
                    </small>
                  </span>
                  <strong>{money(document.totalAmount)}</strong>
                  <div>
                    <small>Tributos identificados</small>
                    <b>
                      {money(
                        document.cbsAmount +
                          document.ibsStateAmount +
                          document.ibsCityAmount +
                          document.selectiveTaxAmount,
                      )}
                    </b>
                  </div>
                  <em>
                    {document.status === "NEEDS_REVIEW"
                      ? "Revisar"
                      : document.status}
                  </em>
                  <button
                    disabled={pending || Boolean(document.transactionId)}
                    onClick={() => createTransaction(document.id)}
                  >
                    {document.transactionId
                      ? "Lançamento criado"
                      : "Criar lançamento"}
                  </button>
                </article>
              ))
            ) : (
              <div className="empty">Nenhum XML fiscal importado.</div>
            )}
          </div>
        </section>
      )}
      {tab === "TRANSITION" && <TransitionPanel />}
      {tab === "CASHBACK" && mode === "FAMILY" && (
        <TaxCashbackPanel scenarios={cashbacks} />
      )}
      {tab === "LEDGER" && mode === "BUSINESS" && (
        <TaxLedgerPanel entries={ledger} />
      )}
    </div>
  );
}

function TaxSimulator({
  mode,
  simulations,
}: {
  mode: "FAMILY" | "BUSINESS";
  simulations: TaxSimulation[];
}) {
  const [state, action, pending] = useActionState(
    simulateTax,
    {} as TaxSimulationState,
  );
  const [date, setDate] = useState("2026-07-01");
  const year = Number(date.slice(0, 4));
  return (
    <section className="tax-simulator-grid">
      <form action={action} className="panel tax-simulator">
        <div className="panel-heading">
          <div>
            <span className="kicker">CÁLCULO DETERMINÍSTICO</span>
            <h2>
              {mode === "FAMILY"
                ? "Simular uma compra"
                : "Simular preço de venda"}
            </h2>
          </div>
        </div>
        <input type="hidden" name="mode" value={mode} />
        <div className="form-grid">
          <label>
            {mode === "FAMILY" ? "Valor da compra" : "Valor líquido pretendido"}
            <input
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
            />
          </label>
          <label>
            Interpretação do valor
            <select name="priceMode" defaultValue="NET">
              <option value="NET">Antes dos tributos</option>
              <option value="GROSS">Preço final com tributos</option>
            </select>
          </label>
          <label>
            Data da operação
            <input
              name="operationDate"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </label>
          <label>
            Descrição
            <input
              name="description"
              placeholder="Produto, serviço ou cenário"
            />
          </label>
          <label>
            Alíquota CBS (%)
            <input
              key={`cbs-${year}`}
              name="cbsRate"
              type="number"
              min="0"
              max="100"
              step="0.0001"
              defaultValue={year === 2026 ? "0.9" : "0"}
              readOnly={year === 2026}
            />
          </label>
          <label>
            IBS estadual (%)
            <input
              key={`ibs-state-${year}`}
              name="ibsStateRate"
              type="number"
              min="0"
              max="100"
              step="0.0001"
              defaultValue={year === 2026 ? "0.1" : "0"}
              readOnly={year === 2026}
            />
          </label>
          <label>
            IBS municipal (%)
            <input
              key={`ibs-city-${year}`}
              name="ibsCityRate"
              type="number"
              min="0"
              max="100"
              step="0.0001"
              defaultValue="0"
              readOnly={year === 2026}
            />
          </label>
          <label>
            Imposto Seletivo (%)
            <input
              name="selectiveTaxRate"
              type="number"
              min="0"
              max="100"
              step="0.0001"
              defaultValue="0"
            />
          </label>
          <label>
            Tributos do sistema anterior (opcional)
            <input
              name="legacyTaxAmount"
              type="number"
              min="0"
              step="0.01"
              placeholder="Estimativa para comparação"
            />
          </label>
        </div>
        <small>
          {year === 2026
            ? "Alíquotas de teste oficiais: CBS 0,9% e IBS 0,1%."
            : "Informe apenas alíquotas obtidas de fonte oficial aplicável ao cenário. O Finora não presume uma alíquota padrão futura."}
        </small>
        {state.error && <p className="form-error">{state.error}</p>}
        <button className="button primary" disabled={pending}>
          {pending ? "Calculando…" : "Calcular e registrar simulação"}
        </button>
      </form>
      <div className="panel tax-result">
        {state.result ? (
          <>
            <span className="kicker">RESULTADO DA SIMULAÇÃO</span>
            <h2>{money(state.result.grossAmount)}</h2>
            <p>preço final estimado · base {money(state.result.baseAmount)}</p>
            <div>
              <span>
                CBS<b>{money(state.result.cbsAmount)}</b>
              </span>
              <span>
                IBS estadual<b>{money(state.result.ibsStateAmount)}</b>
              </span>
              <span>
                IBS municipal<b>{money(state.result.ibsCityAmount)}</b>
              </span>
              <span>
                Imposto Seletivo<b>{money(state.result.selectiveTaxAmount)}</b>
              </span>
              <span className="total">
                Total de tributos<b>{money(state.result.taxTotal)}</b>
              </span>
              <span>
                Alíquota efetiva<b>{state.result.effectiveRate}%</b>
              </span>
              {state.result.legacyDifference !== null && (
                <span className="total">
                  Diferença vs. sistema anterior
                  <b>{money(state.result.legacyDifference)}</b>
                </span>
              )}
            </div>
            <div className="split-preview">
              <span className="kicker">VISÃO DE SPLIT PAYMENT</span>
              <p>
                Fornecedor/base <b>{money(state.result.baseAmount)}</b>
              </p>
              <p>
                CBS destinada <b>{money(state.result.cbsAmount)}</b>
              </p>
              <p>
                IBS destinado{" "}
                <b>
                  {money(
                    state.result.ibsStateAmount + state.result.ibsCityAmount,
                  )}
                </b>
              </p>
              <small>
                Somente decomposição visual. O Finora não separa nem movimenta
                tributos.
              </small>
            </div>
            <small>{state.result.disclaimer}</small>
          </>
        ) : (
          <div className="empty-action">
            <span>
              <Calculator />
            </span>
            <b>Simule com transparência</b>
            <p>
              O resultado mostrará base, cada tributo, preço final, versão e
              ressalvas.
            </p>
          </div>
        )}
      </div>
      {simulations.length > 0 && (
        <div className="panel simulation-history">
          <span className="kicker">HISTÓRICO</span>
          {simulations.slice(0, 5).map((simulation) => (
            <div key={simulation.id}>
              <span>
                {new Date(simulation.operationDate).toLocaleDateString("pt-BR")}{" "}
                · {simulation.mode === "FAMILY" ? "Família" : "Empresa"}
              </span>
              <small>{simulation.ruleVersion.code}</small>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TransitionPanel() {
  return (
    <section className="panel transition-panel">
      <div className="panel-heading">
        <div>
          <span className="kicker">CRONOGRAMA OFICIAL</span>
          <h2>Transição do consumo</h2>
        </div>
      </div>
      <p>
        Percentuais de transição não são alíquotas finais. Eles representam a
        substituição gradual de ICMS/ISS pelo IBS.
      </p>
      <div>
        {TRANSITION_RULES.map((rule) => (
          <article key={rule.year}>
            <strong>{rule.year}</strong>
            <span>
              <b>{rule.label}</b>
              <small>
                {rule.year === 2026
                  ? "CBS 0,9% + IBS 0,1% em ambiente de teste"
                  : rule.year <= 2028
                    ? "CBS efetiva + IBS de 0,1%"
                    : `IBS: ${rule.ibsShare}% da transição · ICMS/ISS: ${rule.legacyShare}%`}
              </small>
            </span>
            <i style={{ width: `${rule.ibsShare}%` }} />
          </article>
        ))}
      </div>
      <a
        href="https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/entenda"
        target="_blank"
        rel="noreferrer"
      >
        Fonte oficial: Receita Federal
      </a>
    </section>
  );
}

function TaxCashbackPanel({ scenarios }: { scenarios: CashbackScenario[] }) {
  const [state, action, pending] = useActionState(
    saveTaxCashbackScenario,
    {} as { error?: string; success?: boolean; estimatedAmount?: number },
  );
  const latest = scenarios[0];
  const inputs = latest?.inputs || {};
  const value = (key: string, fallback: string) =>
    typeof inputs[key] === "number" ? String(inputs[key]) : fallback;
  return (
    <div className="cashback-layout">
      <form action={action} className="panel tax-simulator">
        <div className="panel-heading">
          <div>
            <span className="kicker">CENÁRIO INFORMATIVO</span>
            <h2>Simular possível cashback</h2>
          </div>
        </div>
        <div className="form-grid">
          <label>
            Competência
            <input
              name="competence"
              type="month"
              required
              defaultValue={latest?.competenceDate.slice(0, 7) || "2027-01"}
            />
          </label>
          <label>
            Integrantes da família
            <input
              name="householdMembers"
              type="number"
              min="1"
              max="30"
              required
              defaultValue={value("householdMembers", "1")}
            />
          </label>
          <label>
            Renda familiar mensal
            <input
              name="householdIncome"
              type="number"
              min="0"
              step="0.01"
              required
              defaultValue={value("householdIncome", "0")}
            />
          </label>
          <label>
            Despesas potencialmente abrangidas
            <input
              name="eligibleSpending"
              type="number"
              min="0"
              step="0.01"
              required
              defaultValue={value("eligibleSpending", "0")}
            />
          </label>
          <label>
            CBS paga no cenário
            <input
              name="cbsPaid"
              type="number"
              min="0"
              step="0.01"
              required
              defaultValue={value("cbsPaid", "0")}
            />
          </label>
          <label>
            IBS pago no cenário
            <input
              name="ibsPaid"
              type="number"
              min="0"
              step="0.01"
              required
              defaultValue={value("ibsPaid", "0")}
            />
          </label>
          <label>
            Hipótese de devolução CBS (%)
            <input
              name="cbsRefundPercent"
              type="number"
              min="0"
              max="100"
              step="0.01"
              required
              defaultValue={value("cbsRefundPercent", "0")}
            />
          </label>
          <label>
            Hipótese de devolução IBS (%)
            <input
              name="ibsRefundPercent"
              type="number"
              min="0"
              max="100"
              step="0.01"
              required
              defaultValue={value("ibsRefundPercent", "0")}
            />
          </label>
          <label>
            Valor já recebido
            <input
              name="receivedAmount"
              type="number"
              min="0"
              step="0.01"
              required
              defaultValue={latest ? String(latest.receivedAmount) : "0"}
            />
          </label>
        </div>
        <small>
          As porcentagens são hipóteses informadas pelo usuário. O Finora não
          determina inscrição, renda elegível, direito ao benefício ou
          calendário de pagamento.
        </small>
        {state.error && <p className="form-error">{state.error}</p>}
        <button className="button primary" disabled={pending}>
          {pending ? "Salvando…" : "Calcular e guardar cenário"}
        </button>
      </form>
      <section className="panel cashback-result">
        <span className="kicker">ACOMPANHAMENTO</span>
        <h2>{money(state.estimatedAmount ?? latest?.estimatedAmount ?? 0)}</h2>
        <p>devolução hipotética estimada</p>
        <div>
          <span>
            Já recebido<b>{money(latest?.receivedAmount || 0)}</b>
          </span>
          <span>
            Ainda esperado
            <b>
              {money(
                Math.max(
                  (state.estimatedAmount ?? latest?.estimatedAmount ?? 0) -
                    (latest?.receivedAmount || 0),
                  0,
                ),
              )}
            </b>
          </span>
          <span>
            Renda per capita informada
            <b>{money(Number(inputs.perCapitaIncome || 0))}</b>
          </span>
        </div>
        <div className="tax-disclaimer">
          <ShieldAlert />
          <span>
            <b>Não confirma elegibilidade.</b>
            <small>
              Estimativa sujeita à validação pelo CadÚnico e pelos sistemas
              oficiais.
            </small>
          </span>
        </div>
      </section>
    </div>
  );
}

function TaxLedgerPanel({ entries }: { entries: LedgerEntry[] }) {
  const [state, action, pending] = useActionState(
    createTaxLedgerEntry,
    {} as { error?: string; success?: boolean },
  );
  useEffect(() => {
    if (state.success) window.location.reload();
  }, [state.success]);
  const totals = useMemo(
    () =>
      entries.reduce(
        (result, item) => {
          const sign = ["CREDIT", "PRESUMED_CREDIT", "SETTLEMENT"].includes(
            item.kind,
          )
            ? -1
            : 1;
          result.cbs += sign * item.cbsAmount;
          result.ibs += sign * item.ibsAmount;
          result.selective += sign * item.selectiveTaxAmount;
          return result;
        },
        { cbs: 0, ibs: 0, selective: 0 },
      ),
    [entries],
  );
  return (
    <div className="tax-ledger-layout">
      <section className="panel">
        <span className="kicker">APURAÇÃO ESTIMADA</span>
        <div className="ledger-totals">
          <span>
            <small>CBS líquida</small>
            <b>{money(totals.cbs)}</b>
          </span>
          <span>
            <small>IBS líquido</small>
            <b>{money(totals.ibs)}</b>
          </span>
          <span>
            <small>IS líquido</small>
            <b>{money(totals.selective)}</b>
          </span>
        </div>
        <p>
          Controle gerencial para conferência com o contador. Não é escrituração
          ou declaração fiscal.
        </p>
      </section>
      <form action={action} className="panel transaction-form">
        <div className="panel-heading">
          <div>
            <span className="kicker">DÉBITO, CRÉDITO OU AJUSTE</span>
            <h2>Novo registro fiscal</h2>
          </div>
        </div>
        <div className="form-grid">
          <label>
            Tipo
            <select name="kind">
              <option value="DEBIT">Débito de venda</option>
              <option value="CREDIT">Crédito de compra</option>
              <option value="PRESUMED_CREDIT">Crédito presumido</option>
              <option value="ADJUSTMENT">Ajuste</option>
              <option value="SETTLEMENT">Recolhimento</option>
            </select>
          </label>
          <label>
            Competência
            <input name="competenceDate" type="date" required />
          </label>
          <label className="full">
            Descrição
            <input name="description" required />
          </label>
          <label>
            CBS
            <input
              name="cbsAmount"
              type="number"
              min="0"
              step="0.01"
              defaultValue="0"
            />
          </label>
          <label>
            IBS
            <input
              name="ibsAmount"
              type="number"
              min="0"
              step="0.01"
              defaultValue="0"
            />
          </label>
          <label>
            Imposto Seletivo
            <input
              name="selectiveTaxAmount"
              type="number"
              min="0"
              step="0.01"
              defaultValue="0"
            />
          </label>
          <label>
            Referência
            <input name="sourceReference" />
          </label>
        </div>
        {state.error && <p className="form-error">{state.error}</p>}
        <button className="button primary" disabled={pending}>
          Registrar
        </button>
      </form>
      <section className="panel tax-ledger-list">
        <span className="kicker">MOVIMENTOS FISCAIS</span>
        {entries.map((item) => (
          <div key={item.id}>
            <span>
              <b>{item.description}</b>
              <small>
                {item.kind} ·{" "}
                {new Date(item.competenceDate).toLocaleDateString("pt-BR")}
              </small>
            </span>
            <strong>
              {money(item.cbsAmount + item.ibsAmount + item.selectiveTaxAmount)}
            </strong>
          </div>
        ))}
      </section>
    </div>
  );
}
