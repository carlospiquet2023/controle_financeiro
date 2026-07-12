export const TAX_RULE_SOURCE =
  "https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/entenda";
export const TAX_RULE_CODE = "RTC-OFFICIAL-2026-07-03";

export const TRANSITION_RULES = [
  {
    year: 2026,
    label: "Ano de teste",
    cbsTestRate: 0.9,
    ibsTestRate: 0.1,
    ibsShare: 0,
    legacyShare: 100,
  },
  {
    year: 2027,
    label: "CBS efetiva e IBS de transição",
    ibsShare: 0.1,
    legacyShare: 100,
  },
  {
    year: 2028,
    label: "CBS efetiva e IBS de transição",
    ibsShare: 0.1,
    legacyShare: 100,
  },
  {
    year: 2029,
    label: "Transição ICMS/ISS → IBS",
    ibsShare: 10,
    legacyShare: 90,
  },
  {
    year: 2030,
    label: "Transição ICMS/ISS → IBS",
    ibsShare: 20,
    legacyShare: 80,
  },
  {
    year: 2031,
    label: "Transição ICMS/ISS → IBS",
    ibsShare: 30,
    legacyShare: 70,
  },
  {
    year: 2032,
    label: "Transição ICMS/ISS → IBS",
    ibsShare: 40,
    legacyShare: 60,
  },
  { year: 2033, label: "Novo modelo integral", ibsShare: 100, legacyShare: 0 },
] as const;

export type TaxSimulationInput = {
  amount: number;
  priceMode: "NET" | "GROSS";
  operationDate: string;
  mode: "FAMILY" | "BUSINESS";
  cbsRate: number;
  ibsStateRate: number;
  ibsCityRate: number;
  selectiveTaxRate: number;
  legacyTaxAmount?: number;
  description?: string;
};

export function calculateTaxSimulation(input: TaxSimulationInput) {
  const year = new Date(`${input.operationDate}T12:00:00Z`).getUTCFullYear();
  const transition =
    TRANSITION_RULES.find((item) => item.year === year) || null;
  const rates =
    year === 2026
      ? {
          cbs: 0.9,
          ibsState: 0.1,
          ibsCity: 0,
          selective: input.selectiveTaxRate,
        }
      : {
          cbs: input.cbsRate,
          ibsState: input.ibsStateRate,
          ibsCity: input.ibsCityRate,
          selective: input.selectiveTaxRate,
        };
  const totalRate =
    rates.cbs + rates.ibsState + rates.ibsCity + rates.selective;
  const base =
    input.priceMode === "GROSS"
      ? input.amount / (1 + totalRate / 100)
      : input.amount;
  const round = (value: number) => Math.round(value * 100) / 100;
  const cbsAmount = round((base * rates.cbs) / 100);
  const ibsStateAmount = round((base * rates.ibsState) / 100);
  const ibsCityAmount = round((base * rates.ibsCity) / 100);
  const selectiveTaxAmount = round((base * rates.selective) / 100);
  const taxTotal = round(
    cbsAmount + ibsStateAmount + ibsCityAmount + selectiveTaxAmount,
  );
  const legacyTaxAmount =
    typeof input.legacyTaxAmount === "number"
      ? round(input.legacyTaxAmount)
      : null;
  return {
    year,
    baseAmount: round(base),
    grossAmount:
      input.priceMode === "GROSS"
        ? round(input.amount)
        : round(base + taxTotal),
    cbsAmount,
    ibsStateAmount,
    ibsCityAmount,
    selectiveTaxAmount,
    taxTotal,
    effectiveRate: round(base ? (taxTotal / base) * 100 : 0),
    legacyTaxAmount,
    legacyDifference:
      legacyTaxAmount === null ? null : round(taxTotal - legacyTaxAmount),
    rates,
    transition,
    disclaimer:
      "Simulação informativa sem efeito fiscal. Alíquotas de referência futuras e tributos do sistema anterior devem ser fornecidos por fonte aplicável ao cenário.",
  };
}
