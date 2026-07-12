import { XMLParser } from "fast-xml-parser";

const number = (value: unknown) => {
  const parsed = Number(String(value ?? "0").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};
const array = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

export type ParsedTaxDocument = ReturnType<typeof parseTaxXml>;

export function parseTaxXml(content: string) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    trimValues: true,
    removeNSPrefix: true,
  });
  const root = parser.parse(content);
  const nfe = root?.nfeProc?.NFe?.infNFe || root?.NFe?.infNFe;
  if (!nfe) return parseNfse(root);
  const issuer = nfe.emit || {};
  const total = nfe.total || {};
  const rtcTotal = total.IBSCBSTot || total.IBSCBS || {};
  const ibsTotal = rtcTotal.gIBS || {};
  const cbsTotal = rtcTotal.gCBS || {};
  const accessKey = String(nfe["@_Id"] || "").replace(/^NFe/, "") || null;
  const issuedAtText = nfe.ide?.dhEmi || nfe.ide?.dEmi || null;
  const items = array<Record<string, any>>(nfe.det).map((entry, index) => {
    const product = entry.prod || {};
    const taxes = entry.imposto || {};
    const rtc = taxes.IBSCBS || {};
    const group = rtc.gIBSCBS || rtc;
    const ibs = group.gIBS || {};
    const state = ibs.gIBSUF || group.gIBSUF || {};
    const city = ibs.gIBSMun || group.gIBSMun || {};
    const cbs = group.gCBS || {};
    const selective = taxes.IS || {};
    return {
      itemNumber: Number(entry["@_nItem"] || index + 1),
      description: String(product.xProd || `Item ${index + 1}`),
      productCode: product.cProd ? String(product.cProd) : null,
      classification: product.NCM ? String(product.NCM) : null,
      taxTreatment: rtc.cClassTrib
        ? String(rtc.cClassTrib)
        : rtc.CST
          ? String(rtc.CST)
          : null,
      quantity: number(product.qCom) || null,
      grossAmount: number(product.vProd),
      taxBase: number(group.vBC || rtc.vBC) || null,
      cbsRate: number(cbs.pCBS) || null,
      ibsStateRate: number(state.pIBSUF) || null,
      ibsCityRate: number(city.pIBSMun) || null,
      selectiveTaxRate: number(selective.pIS) || null,
      cbsAmount: number(cbs.vCBS),
      ibsStateAmount: number(state.vIBSUF),
      ibsCityAmount: number(city.vIBSMun),
      selectiveTaxAmount: number(selective.vIS),
    };
  });
  const sum = (
    key:
      | "cbsAmount"
      | "ibsStateAmount"
      | "ibsCityAmount"
      | "selectiveTaxAmount",
  ) =>
    Math.round(items.reduce((value, item) => value + item[key], 0) * 100) / 100;
  return {
    documentType: String(nfe.ide?.mod) === "65" ? "NFC-e" : "NF-e",
    accessKey,
    issuerName: issuer.xNome ? String(issuer.xNome) : null,
    issuerDocument: issuer.CNPJ
      ? String(issuer.CNPJ)
      : issuer.CPF
        ? String(issuer.CPF)
        : null,
    issuedAt: issuedAtText ? new Date(issuedAtText) : null,
    totalAmount: number(total.ICMSTot?.vNF || total.vNF),
    cbsAmount: number(cbsTotal.vCBS) || sum("cbsAmount"),
    ibsStateAmount: number(ibsTotal.vIBSUF) || sum("ibsStateAmount"),
    ibsCityAmount: number(ibsTotal.vIBSMun) || sum("ibsCityAmount"),
    selectiveTaxAmount: number(total.ISTot?.vIS) || sum("selectiveTaxAmount"),
    items,
  };
}

function parseNfse(root: Record<string, any>) {
  const info =
    root?.CompNfse?.Nfse?.InfNfse ||
    root?.Nfse?.InfNfse ||
    root?.NFSe?.infNFSe ||
    root?.NFSe?.InfNFSe;
  if (!info)
    throw new Error("O XML não contém uma NF-e, NFC-e ou NFS-e reconhecível.");
  const service = info.Servico || info.serv || {};
  const values = service.Valores || service.valores || info.valores || {};
  const provider = info.PrestadorServico || info.prest || info.emit || {};
  const providerId =
    provider.IdentificacaoPrestador || provider.CpfCnpj || provider;
  const rtc = values.IBSCBS || info.IBSCBS || {};
  const cbs = rtc.gCBS || {};
  const ibs = rtc.gIBS || {};
  const state = ibs.gIBSUF || {};
  const city = ibs.gIBSMun || {};
  const selective = values.IS || info.IS || {};
  const totalAmount = number(
    values.ValorLiquidoNfse ||
      values.ValorServicos ||
      values.vLiq ||
      values.vServPrest ||
      info.vLiq,
  );
  const description = String(
    service.Discriminacao || service.xDescServ || info.xDescServ || "Serviço",
  );
  const issuedAtText =
    info.DataEmissao || info.dhEmi || root?.NFSe?.dhProc || null;
  const item = {
    itemNumber: 1,
    description,
    productCode: service.ItemListaServico
      ? String(service.ItemListaServico)
      : service.cTribNac
        ? String(service.cTribNac)
        : null,
    classification: service.CodigoCnae ? String(service.CodigoCnae) : null,
    taxTreatment: rtc.cClassTrib ? String(rtc.cClassTrib) : null,
    quantity: 1,
    grossAmount: totalAmount,
    taxBase: number(rtc.vBC) || null,
    cbsRate: number(cbs.pCBS) || null,
    ibsStateRate: number(state.pIBSUF) || null,
    ibsCityRate: number(city.pIBSMun) || null,
    selectiveTaxRate: number(selective.pIS) || null,
    cbsAmount: number(cbs.vCBS),
    ibsStateAmount: number(state.vIBSUF),
    ibsCityAmount: number(city.vIBSMun),
    selectiveTaxAmount: number(selective.vIS),
  };
  return {
    documentType: "NFS-e",
    accessKey: info.CodigoVerificacao
      ? String(info.CodigoVerificacao)
      : info.chNFSe
        ? String(info.chNFSe)
        : null,
    issuerName: provider.RazaoSocial
      ? String(provider.RazaoSocial)
      : provider.xNome
        ? String(provider.xNome)
        : null,
    issuerDocument: providerId.Cnpj
      ? String(providerId.Cnpj)
      : providerId.CNPJ
        ? String(providerId.CNPJ)
        : providerId.Cpf
          ? String(providerId.Cpf)
          : providerId.CPF
            ? String(providerId.CPF)
            : null,
    issuedAt: issuedAtText ? new Date(issuedAtText) : null,
    totalAmount,
    cbsAmount: item.cbsAmount,
    ibsStateAmount: item.ibsStateAmount,
    ibsCityAmount: item.ibsCityAmount,
    selectiveTaxAmount: item.selectiveTaxAmount,
    items: [item],
  };
}
