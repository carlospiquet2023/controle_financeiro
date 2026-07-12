import assert from "node:assert/strict";
import test from "node:test";
import { addMonthsClamped } from "../lib/finance";
import { projectDebt } from "../lib/debt";
import { calculateTaxSimulation } from "../lib/tax";
import { parseTaxXml } from "../lib/tax-xml";
import {
  normalizeMatchText,
  transactionMatchScore,
} from "../lib/transaction-matching";

test("vencimentos mensais preservam o último dia possível", () => {
  assert.equal(
    addMonthsClamped(new Date("2026-01-31T12:00:00Z"), 1)
      .toISOString()
      .slice(0, 10),
    "2026-02-28",
  );
  assert.equal(
    addMonthsClamped(new Date("2028-01-31T12:00:00Z"), 1)
      .toISOString()
      .slice(0, 10),
    "2028-02-29",
  );
});

test("projeção de dívida detecta amortização e juros impagáveis", () => {
  const payoff = projectDebt(1_000, 1, 100);
  assert.equal(payoff.payoffPossible, true);
  assert.equal(payoff.months, 11);
  assert.equal(payoff.totalPaid, 1_058.98);
  assert.equal(projectDebt(1_000, 10, 50).payoffPossible, false);
});

test("conciliação normaliza texto e pondera valor, data e descrição", () => {
  assert.equal(
    normalizeMatchText("SUPERMERCADO São João #42"),
    "supermercado sao joao 42",
  );
  const exact = transactionMatchScore(
    {
      amount: -245.9,
      date: new Date("2026-07-10T12:00:00Z"),
      description: "SUPERMERCADO GUANABARA",
    },
    {
      amount: 245.9,
      date: new Date("2026-07-10T12:00:00Z"),
      description: "Supermercado Guanabara",
    },
  );
  assert.equal(exact.confidence, 1);
  assert.ok(
    transactionMatchScore(
      {
        amount: -245.9,
        date: new Date("2026-07-10T12:00:00Z"),
        description: "Mercado",
      },
      {
        amount: 300,
        date: new Date("2026-07-20T12:00:00Z"),
        description: "Farmácia",
      },
    ).confidence < 0.2,
  );
});

test("simulação IVA fixa apenas as alíquotas oficiais de teste de 2026", () => {
  const result = calculateTaxSimulation({
    amount: 1_000,
    priceMode: "NET",
    operationDate: "2026-07-12",
    mode: "FAMILY",
    cbsRate: 99,
    ibsStateRate: 99,
    ibsCityRate: 99,
    selectiveTaxRate: 0,
    legacyTaxAmount: 15,
  });
  assert.deepEqual(result.rates, {
    cbs: 0.9,
    ibsState: 0.1,
    ibsCity: 0,
    selective: 0,
  });
  assert.equal(result.taxTotal, 10);
  assert.equal(result.grossAmount, 1_010);
  assert.equal(result.legacyDifference, -5);

  const future = calculateTaxSimulation({
    amount: 1_000,
    priceMode: "GROSS",
    operationDate: "2027-07-12",
    mode: "BUSINESS",
    cbsRate: 10,
    ibsStateRate: 5,
    ibsCityRate: 2,
    selectiveTaxRate: 0,
  });
  assert.equal(future.grossAmount, 1_000);
  assert.equal(future.baseAmount, 854.7);
  assert.equal(future.taxTotal, 145.3);
});

test("importador fiscal lê totais e itens IBS/CBS do XML", () => {
  const xml = `<?xml version="1.0"?><NFe><infNFe Id="NFe123"><ide><mod>65</mod><dhEmi>2026-07-10T10:00:00-03:00</dhEmi></ide><emit><CNPJ>12345678000190</CNPJ><xNome>Mercado Teste</xNome></emit><det nItem="1"><prod><cProd>1</cProd><xProd>Arroz</xProd><NCM>10063021</NCM><qCom>2</qCom><vProd>100.00</vProd></prod><imposto><IBSCBS><gIBSCBS><vBC>100.00</vBC><gIBS><gIBSUF><pIBSUF>0.1</pIBSUF><vIBSUF>0.10</vIBSUF></gIBSUF></gIBS><gCBS><pCBS>0.9</pCBS><vCBS>0.90</vCBS></gCBS></gIBSCBS></IBSCBS></imposto></det><total><ICMSTot><vNF>101.00</vNF></ICMSTot></total></infNFe></NFe>`;
  const parsed = parseTaxXml(xml);
  assert.equal(parsed.documentType, "NFC-e");
  assert.equal(parsed.issuerName, "Mercado Teste");
  assert.equal(parsed.totalAmount, 101);
  assert.equal(parsed.cbsAmount, 0.9);
  assert.equal(parsed.ibsStateAmount, 0.1);
  assert.equal(parsed.items[0].classification, "10063021");
});

test("importador fiscal reconhece NFS-e de serviço", () => {
  const xml = `<CompNfse><Nfse><InfNfse><CodigoVerificacao>ABC123</CodigoVerificacao><DataEmissao>2026-07-10T10:00:00-03:00</DataEmissao><PrestadorServico><IdentificacaoPrestador><Cnpj>12345678000190</Cnpj></IdentificacaoPrestador><RazaoSocial>Serviços Teste</RazaoSocial></PrestadorServico><Servico><Valores><ValorServicos>250.00</ValorServicos></Valores><ItemListaServico>1.01</ItemListaServico><Discriminacao>Consultoria</Discriminacao><CodigoCnae>6201501</CodigoCnae></Servico></InfNfse></Nfse></CompNfse>`;
  const parsed = parseTaxXml(xml);
  assert.equal(parsed.documentType, "NFS-e");
  assert.equal(parsed.issuerName, "Serviços Teste");
  assert.equal(parsed.totalAmount, 250);
  assert.equal(parsed.items[0].description, "Consultoria");
});
