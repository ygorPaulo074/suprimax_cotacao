// UC19 — geração do PDF do orçamento (docs/09-documento-de-orcamento-pdf.md). Função pura: não
// acessa o proxy nem o banco, só formata o que `ServicoDeOrcamentos.obter` já montou. Mesma
// filosofia de `services/calculo`: dados entram, PDF (buffer) sai.
import PDFDocument from 'pdfkit';
import type { DadosDaEmpresaEmissora } from '../../config';
import type { ItemDetalhado, OrcamentoDetalhado } from './servico';

const MARGEM_DO_DOCUMENTO = 50;
const TAMANHO_MINIMO_DO_NUMERO_DO_ORCAMENTO = 5;
const ALIQUOTA_DE_IMPOSTO_EXIBIDA = '18%';
/** RF/RN (ver `servico.ts`, `montarDetalhe`): faturamento a prazo abaixo disto é bloqueado. */
const VALOR_MINIMO_PARA_FATURAMENTO_A_PRAZO_CENTAVOS = 50_000;

const FORMATADOR_DE_MOEDA = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});
const FORMATADOR_DE_DATA = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

function formatarCentavos(centavos: number | null): string {
  return centavos === null ? '—' : FORMATADOR_DE_MOEDA.format(centavos / 100);
}

function formatarData(dataIso: string | null): string {
  if (dataIso === null) {
    return '—';
  }
  return FORMATADOR_DE_DATA.format(new Date(dataIso));
}

const RETULOS_DA_CONDICAO_DE_PAGAMENTO: Record<string, string> = {
  ADIANTADO_100: '100% adiantado antes do faturamento',
  BOLETO: 'Boleto bancário',
  PARCELADO: 'Parcelado',
  ADIANTADO_50_50: '50% adiantado e 50% em até 3 dias corridos após a entrega',
};

/** Texto da instrução de pagamento, considerando prazo/parcelas quando aplicável. */
function instrucaoDePagamento(detalhe: OrcamentoDetalhado): string {
  const { condicaoPagamento, prazoDias, numeroParcelas } = detalhe.condicoes;
  if (condicaoPagamento === null) {
    return 'Condição de pagamento ainda não definida.';
  }
  const rotulo = RETULOS_DA_CONDICAO_DE_PAGAMENTO[condicaoPagamento] ?? condicaoPagamento;
  if (condicaoPagamento === 'BOLETO' && prazoDias !== null) {
    return `${rotulo}, prazo de ${prazoDias} dia(s) a contar do aceite.`;
  }
  if (condicaoPagamento === 'PARCELADO' && numeroParcelas !== null) {
    return `${rotulo} em ${numeroParcelas}x.`;
  }
  return `${rotulo}.`;
}

function textoDoFrete(detalhe: OrcamentoDetalhado): string {
  const { modalidadeFrete, origemTransportadora, transportadora, valorFrete, freteProvisorio } =
    detalhe.condicoes;
  if (modalidadeFrete === null) {
    return 'Frete ainda não definido.';
  }
  const partes = [`Frete ${modalidadeFrete}`];
  if (origemTransportadora !== null) {
    partes.push(
      origemTransportadora === 'SUPRIMAX' ? 'por conta da SupriMax' : 'por conta do cliente',
    );
  }
  if (transportadora !== null) {
    partes.push(`transportadora ${transportadora}`);
  }
  if (valorFrete !== null) {
    partes.push(`valor ${formatarCentavos(valorFrete)}${freteProvisorio ? ' (provisório)' : ''}`);
  }
  return `${partes.join(', ')}.`;
}

function tituloDaSecao(doc: PDFKit.PDFDocument, texto: string): void {
  doc.moveDown(0.5).font('Helvetica-Bold').fontSize(11).text(texto).font('Helvetica').fontSize(9);
}

function cabecalhoDaEmpresa(doc: PDFKit.PDFDocument, empresa: DadosDaEmpresaEmissora): void {
  doc.font('Helvetica-Bold').fontSize(16).text(empresa.razaoSocial);
  doc
    .font('Helvetica')
    .fontSize(9)
    .text(empresa.endereco)
    .text(`Telefone: ${empresa.telefone}`)
    .text(`CNPJ: ${empresa.cnpj} — Inscrição Estadual: ${empresa.inscricaoEstadual}`);
}

function cabecalhoDoCliente(doc: PDFKit.PDFDocument, detalhe: OrcamentoDetalhado): void {
  const numero = String(detalhe.numeroOrcamento).padStart(
    TAMANHO_MINIMO_DO_NUMERO_DO_ORCAMENTO,
    '0',
  );
  const endereco = detalhe.enderecosEntrega.find(
    (candidato) => candidato.idEndereco === detalhe.idEnderecoEntrega,
  );
  tituloDaSecao(doc, `Orçamento nº ${numero}`);
  doc
    .text(`Cliente: ${detalhe.cliente} — CNPJ: ${detalhe.cnpj}`)
    .text(
      endereco
        ? `Endereço de entrega: ${endereco.logradouro}, ${endereco.numero}` +
            `${endereco.complemento ? ` — ${endereco.complemento}` : ''} — ${endereco.bairro}, ` +
            `${endereco.cidade}/${endereco.uf} — CEP ${endereco.cep}`
        : 'Endereço de entrega: a confirmar.',
    )
    .text(`Data de emissão: ${formatarData(detalhe.dataEmissao)}`)
    .text(`Validade da proposta: ${formatarData(detalhe.dataValidade)} (30 dias)`)
    .text(`Contato: ${detalhe.contato ?? '—'}`)
    .text(`Número da solicitação de compra: ${detalhe.numeroSolicitacaoCompra ?? '—'}`)
    .text(`Condição de pagamento: ${instrucaoDePagamento(detalhe)}`)
    .text(
      `Prazo de entrega: ${detalhe.prazoEntregaDias !== null ? `${detalhe.prazoEntregaDias} dia(s)` : '—'}`,
    );
}

const LARGURAS_DAS_COLUNAS = {
  item: 25,
  codigo: 55,
  ncm: 55,
  descricao: 140,
  quantidade: 45,
  precoUnitario: 65,
  imposto: 55,
  total: 65,
} as const;

function cabecalhoDaTabela(doc: PDFKit.PDFDocument, x: number, y: number): void {
  let cursor = x;
  doc.font('Helvetica-Bold').fontSize(8);
  for (const [coluna, largura] of Object.entries(LARGURAS_DAS_COLUNAS)) {
    doc.text(TITULOS_DAS_COLUNAS[coluna as keyof typeof LARGURAS_DAS_COLUNAS], cursor, y, {
      width: largura,
    });
    cursor += largura;
  }
  doc.font('Helvetica').fontSize(8);
}

const TITULOS_DAS_COLUNAS: Record<keyof typeof LARGURAS_DAS_COLUNAS, string> = {
  item: 'Item',
  codigo: 'Código',
  ncm: 'NCM',
  descricao: 'Descrição',
  quantidade: 'Qtde.',
  precoUnitario: 'Preço unit.',
  imposto: `Imposto (${ALIQUOTA_DE_IMPOSTO_EXIBIDA})`,
  total: 'Total',
};

function linhaDaTabela(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  numero: number,
  item: ItemDetalhado,
): void {
  let cursor = x;
  const valores: Record<keyof typeof LARGURAS_DAS_COLUNAS, string> = {
    item: String(numero),
    codigo: item.codigoInterno,
    ncm: item.ncm ?? '—',
    descricao: `${item.produto} — ${item.marca}, ${item.embalagem}`,
    quantidade: String(item.quantidade),
    precoUnitario: formatarCentavos(item.precoUnitarioAplicado),
    imposto: formatarCentavos(item.valorImposto),
    total: formatarCentavos(item.valorTotalItem),
  };
  for (const [coluna, largura] of Object.entries(LARGURAS_DAS_COLUNAS)) {
    doc.text(valores[coluna as keyof typeof LARGURAS_DAS_COLUNAS], cursor, y, { width: largura });
    cursor += largura;
  }
}

function tabelaDeProdutos(doc: PDFKit.PDFDocument, detalhe: OrcamentoDetalhado): void {
  tituloDaSecao(doc, 'Produtos');
  const x = doc.page.margins.left;
  let y = doc.y;
  cabecalhoDaTabela(doc, x, y);
  y += 14;
  detalhe.itens.forEach((item, indice) => {
    if (y > doc.page.height - doc.page.margins.bottom - 100) {
      doc.addPage();
      y = doc.page.margins.top;
      cabecalhoDaTabela(doc, x, y);
      y += 14;
    }
    linhaDaTabela(doc, x, y, indice + 1, item);
    y += 14;
  });
  doc.y = y + 6;
}

function totalizadoresERegras(doc: PDFKit.PDFDocument, detalhe: OrcamentoDetalhado): void {
  const { valorTotalItens, valorTotalImposto, valorTotalProposta, creditoStatus } =
    detalhe.condicoes;
  tituloDaSecao(doc, 'Totais e regras');
  doc
    .text(`Valor total dos produtos: ${formatarCentavos(valorTotalItens)}`)
    .text(`Valor total de impostos: ${formatarCentavos(valorTotalImposto)}`)
    .text(`Valor total da proposta (com impostos): ${formatarCentavos(valorTotalProposta)}`)
    .text(textoDoFrete(detalhe))
    .text(
      `Faturamento mínimo a prazo: ${formatarCentavos(
        VALOR_MINIMO_PARA_FATURAMENTO_A_PRAZO_CENTAVOS,
      )}; abaixo disso, exige-se pagamento adiantado.`,
    );
  if (creditoStatus !== 'NAO_EXIGIDO') {
    doc.text(
      creditoStatus === 'PENDENTE'
        ? 'Esta proposta está sujeita à conclusão da análise de crédito do cliente.'
        : `Análise de crédito do cliente: ${creditoStatus === 'APROVADO' ? 'aprovada' : 'reprovada — condição de pagamento ajustada'}.`,
    );
  }
}

function avisosEPagamento(doc: PDFKit.PDFDocument, empresa: DadosDaEmpresaEmissora): void {
  tituloDaSecao(doc, 'Pagamento e avisos');
  doc
    .text(`Chave PIX: ${empresa.pix}`)
    .text(`Dados bancários: ${empresa.dadosBancarios}`)
    .text(
      'Os valores de estoque e preço estão sujeitos a variações até a confirmação do pagamento.',
    )
    .text(
      'Os dados pessoais e cadastrais desta proposta são tratados conforme a Lei Geral de ' +
        'Proteção de Dados (Lei nº 13.709/2018) e usados apenas para a execução deste negócio.',
    );
}

function anexosAutomaticos(doc: PDFKit.PDFDocument, detalhe: OrcamentoDetalhado): void {
  tituloDaSecao(doc, 'Anexos');
  if (detalhe.anexos.length === 0) {
    doc.text('Nenhum anexo.');
    return;
  }
  for (const anexo of detalhe.anexos) {
    doc.text(`• ${anexo.nomeArquivo} (${anexo.tipoAnexo})`);
  }
}

/**
 * Gera o PDF do orçamento emitido (docs/09). O chamador (`ServicoDeOrcamentos.gerarPdf`) garante
 * que o orçamento já tem número — aqui não há mais nenhuma regra de negócio, só layout.
 */
export function gerarPdfDeOrcamento(
  detalhe: OrcamentoDetalhado,
  empresa: DadosDaEmpresaEmissora,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGEM_DO_DOCUMENTO, size: 'A4' });
    const blocos: Buffer[] = [];
    doc.on('data', (bloco: Buffer) => blocos.push(bloco));
    doc.on('end', () => resolve(Buffer.concat(blocos)));
    doc.on('error', reject);

    doc.fontSize(9);
    cabecalhoDaEmpresa(doc, empresa);
    cabecalhoDoCliente(doc, detalhe);
    tabelaDeProdutos(doc, detalhe);
    totalizadoresERegras(doc, detalhe);
    avisosEPagamento(doc, empresa);
    anexosAutomaticos(doc, detalhe);

    doc.end();
  });
}
