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
const FUSO_DO_DOCUMENTO = 'America/Sao_Paulo';
const FORMATADOR_DE_DATA = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeZone: FUSO_DO_DOCUMENTO,
});
const SOMENTE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

function formatarCentavos(centavos: number | null): string {
  return centavos === null ? '—' : FORMATADOR_DE_MOEDA.format(centavos / 100);
}

/** Data só com dia não tem fuso: formata sem converter (senão 17/11 viraria 16/11 em UTC-3). */
function formatarData(dataIso: string | null): string {
  if (dataIso === null) {
    return '—';
  }
  const somenteData = SOMENTE_DATA.exec(dataIso);
  if (somenteData) {
    return `${somenteData[3]}/${somenteData[2]}/${somenteData[1]}`;
  }
  return FORMATADOR_DE_DATA.format(new Date(dataIso));
}

function formatarCnpj(cnpj: string): string {
  const digitos = cnpj.replace(/\D/g, '');
  return digitos.length === 14
    ? digitos.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
    : cnpj;
}

function formatarCep(cep: string): string {
  const digitos = cep.replace(/\D/g, '');
  return digitos.length === 8 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : cep;
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
    .text(`Cliente: ${detalhe.cliente} — CNPJ: ${formatarCnpj(detalhe.cnpj)}`)
    .text(
      endereco
        ? `Endereço de entrega: ${endereco.logradouro}, ${endereco.numero}` +
            `${endereco.complemento ? ` — ${endereco.complemento}` : ''} — ${endereco.bairro}, ` +
            `${endereco.cidade}/${endereco.uf} — CEP ${formatarCep(endereco.cep)}`
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
  item: 22,
  codigo: 64,
  ncm: 48,
  descricao: 120,
  quantidade: 33,
  precoUnitario: 66,
  imposto: 68,
  total: 74,
} as const;

type ColunaDaTabela = keyof typeof LARGURAS_DAS_COLUNAS;
type LinhaDaTabela = Record<ColunaDaTabela, string>;
const COLUNAS_NUMERICAS: readonly ColunaDaTabela[] = [
  'quantidade',
  'precoUnitario',
  'imposto',
  'total',
];
const COLUNAS = Object.keys(LARGURAS_DAS_COLUNAS) as ColunaDaTabela[];
const LARGURA_DA_TABELA = Object.values(LARGURAS_DAS_COLUNAS).reduce((soma, l) => soma + l, 0);
const RECUO_DA_CELULA = 3;
const ESPACO_VERTICAL_DA_LINHA = 6;
/** Espaço mínimo no fim da página para abrir a tabela (título + cabeçalho + uma linha). */
const ALTURA_MINIMA_PARA_ABRIR_A_TABELA = 70;
/** Faixa do rodapé (numeração de páginas) que o conteúdo não pode invadir. */
const ESPACO_RESERVADO_AO_RODAPE = 20;

const TITULOS_DAS_COLUNAS: LinhaDaTabela = {
  item: 'Item',
  codigo: 'Código',
  ncm: 'NCM',
  descricao: 'Descrição',
  quantidade: 'Qtde.',
  precoUnitario: 'Preço unit.',
  imposto: `Imposto (${ALIQUOTA_DE_IMPOSTO_EXIBIDA})`,
  total: 'Total',
};

function limiteInferior(doc: PDFKit.PDFDocument): number {
  return doc.page.height - doc.page.margins.bottom - ESPACO_RESERVADO_AO_RODAPE;
}

function opcoesDaCelula(coluna: ColunaDaTabela): { width: number; align: 'left' | 'right' } {
  return {
    width: LARGURAS_DAS_COLUNAS[coluna] - RECUO_DA_CELULA,
    align: COLUNAS_NUMERICAS.includes(coluna) ? 'right' : 'left',
  };
}

/** Altura da linha: a da célula mais alta (descrição e código quebram em várias linhas). */
function alturaDaLinha(doc: PDFKit.PDFDocument, valores: LinhaDaTabela): number {
  const alturas = COLUNAS.map((coluna) =>
    doc.heightOfString(valores[coluna], opcoesDaCelula(coluna)),
  );
  return Math.max(...alturas) + ESPACO_VERTICAL_DA_LINHA;
}

function escreverLinha(doc: PDFKit.PDFDocument, y: number, valores: LinhaDaTabela): number {
  let cursor = doc.page.margins.left;
  for (const coluna of COLUNAS) {
    doc.text(valores[coluna], cursor, y, opcoesDaCelula(coluna));
    cursor += LARGURAS_DAS_COLUNAS[coluna];
  }
  return alturaDaLinha(doc, valores);
}

function tracoHorizontal(doc: PDFKit.PDFDocument, y: number): void {
  const x0 = doc.page.margins.left;
  doc
    .moveTo(x0, y)
    .lineTo(x0 + LARGURA_DA_TABELA, y)
    .lineWidth(0.5)
    .strokeColor('#999999')
    .stroke()
    .strokeColor('#000000');
}

function cabecalhoDaTabela(doc: PDFKit.PDFDocument, y: number): number {
  doc.font('Helvetica-Bold').fontSize(8);
  const altura = escreverLinha(doc, y, TITULOS_DAS_COLUNAS);
  tracoHorizontal(doc, y + altura - 2);
  doc.font('Helvetica').fontSize(8);
  return altura;
}

function valoresDoItem(numero: number, item: ItemDetalhado): LinhaDaTabela {
  return {
    item: String(numero),
    codigo: item.codigoInterno,
    ncm: item.ncm ?? '—',
    descricao: `${item.produto} — ${item.marca}, ${item.embalagem}`,
    quantidade: String(item.quantidade),
    precoUnitario: formatarCentavos(item.precoUnitarioAplicado),
    imposto: formatarCentavos(item.valorImposto),
    total: formatarCentavos(item.valorTotalItem),
  };
}

function tabelaDeProdutos(doc: PDFKit.PDFDocument, detalhe: OrcamentoDetalhado): void {
  if (doc.y > limiteInferior(doc) - ALTURA_MINIMA_PARA_ABRIR_A_TABELA) {
    doc.addPage();
  }
  doc.x = doc.page.margins.left;
  tituloDaSecao(doc, 'Produtos');
  doc.fontSize(8);
  let y = doc.y + 2;
  y += cabecalhoDaTabela(doc, y);
  detalhe.itens.forEach((item, indice) => {
    const valores = valoresDoItem(indice + 1, item);
    if (y + alturaDaLinha(doc, valores) > limiteInferior(doc)) {
      doc.addPage();
      y = doc.page.margins.top;
      y += cabecalhoDaTabela(doc, y);
    }
    const altura = escreverLinha(doc, y, valores);
    tracoHorizontal(doc, y + altura - 2);
    y += altura;
  });
  // `text(x, y)` deixa o cursor na última coluna: volta à margem antes do texto corrido.
  doc.x = doc.page.margins.left;
  doc.y = y + 6;
  doc.fontSize(9);
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

function numerarPaginas(doc: PDFKit.PDFDocument, numeroOrcamento: number | null): void {
  const { start, count } = doc.bufferedPageRange();
  const numero = String(numeroOrcamento ?? 0).padStart(TAMANHO_MINIMO_DO_NUMERO_DO_ORCAMENTO, '0');
  for (let i = start; i < start + count; i += 1) {
    doc.switchToPage(i);
    const { margins, height, width } = doc.page;
    // Sem zerar a margem inferior, escrever abaixo dela abriria uma página nova.
    const margemInferior = margins.bottom;
    margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(8)
      .text(`Orçamento nº ${numero} — página ${i + 1} de ${count}`, margins.left, height - 35, {
        width: width - margins.left - margins.right,
        align: 'center',
      });
    margins.bottom = margemInferior;
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
    const doc = new PDFDocument({
      margin: MARGEM_DO_DOCUMENTO,
      size: 'A4',
      bufferPages: true,
    });
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
    numerarPaginas(doc, detalhe.numeroOrcamento);

    doc.end();
  });
}
