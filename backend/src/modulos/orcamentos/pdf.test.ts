// UC19 — regressão do layout do PDF (docs/09) sem comparar pixels: lê o texto que o PDF realmente
// desenhou. Todos os dados são fictícios.
import { inflateSync } from 'node:zlib';
import type { DadosDaEmpresaEmissora } from '../../config';
import { gerarPdfDeOrcamento } from './pdf';
import type { ItemDetalhado, OrcamentoDetalhado } from './servico';

const EMPRESA: DadosDaEmpresaEmissora = {
  razaoSocial: 'Empresa Fictícia Ltda',
  endereco: 'Rua Exemplo, 100, Centro, Cidade/UF, CEP 01000-000',
  telefone: '(11) 3000-0000',
  cnpj: '11.222.333/0001-81',
  inscricaoEstadual: '123.456.789.110',
  pix: 'chave-pix-ficticia',
  dadosBancarios: 'Banco 000 - Agência 0001 - Conta 12345-6',
};

function item(indice: number, sobrescrita: Partial<ItemDetalhado> = {}): ItemDetalhado {
  return {
    idItem: indice,
    idVariacao: indice,
    produto: 'Produto de teste com nome bem comprido para forçar a quebra de linha na descrição',
    codigoInterno: `CODIGO-LONGO-${indice}`,
    ncm: '10063021',
    marca: 'Marca',
    embalagem: 'Fardo 6 x 5 kg',
    granularidade: 'FARDO',
    quantidade: 1000 + indice,
    precoUnitarioAplicado: 123_456_789,
    valorLinha: 1,
    valorImposto: 22_222_222,
    valorTotalItem: 145_678_901,
    aprovacaoHerdada: false,
    ...sobrescrita,
  };
}

function detalhe(quantidadeDeItens: number): OrcamentoDetalhado {
  return {
    numeroOrcamento: 3,
    cliente: 'Cliente Fictício de Nome Muito Comprido para Testar Quebra de Linha Ltda ME',
    cnpj: '11222333000181',
    dataEmissao: '2026-11-17',
    dataValidade: '2026-12-17',
    contato: 'Contato Fictício',
    numeroSolicitacaoCompra: 'SC-1',
    idEnderecoEntrega: 1,
    prazoEntregaDias: 5,
    enderecosEntrega: [
      {
        idEndereco: 1,
        logradouro: 'Avenida de Nome Muito Comprido para Testar a Quebra de Linha do Endereço',
        numero: '12345',
        complemento: 'Galpão 7',
        bairro: 'Bairro',
        cidade: 'Cidade',
        uf: 'SP',
        cep: '12345678',
      },
    ],
    itens: Array.from({ length: quantidadeDeItens }, (_, i) => item(i + 1)),
    anexos: [],
    condicoes: {
      condicaoPagamento: 'ADIANTADO_100',
      prazoDias: null,
      numeroParcelas: null,
      modalidadeFrete: 'CIF',
      origemTransportadora: 'SUPRIMAX',
      transportadora: null,
      valorFrete: null,
      freteProvisorio: false,
      valorTotalItens: 500_000_000_000,
      valorTotalImposto: 90_000_000_000,
      valorTotalProposta: 500_000_000_000,
      creditoStatus: 'NAO_EXIGIDO',
    },
  } as unknown as OrcamentoDetalhado;
}

/** Texto desenhado, por página (pdfkit guarda as fontes padrão como `[<hex>] TJ` em WinAnsi). */
function textoPorPagina(pdf: Buffer): string[] {
  const bruto = pdf.toString('latin1');
  const paginas: string[] = [];
  for (const fluxo of bruto.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let conteudo: string;
    try {
      conteudo = inflateSync(Buffer.from(fluxo[1] ?? '', 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    if (!conteudo.includes(' TJ')) {
      continue;
    }
    const linhas = [...conteudo.matchAll(/\[([^\]]*)\]\s*TJ/g)].map((m) =>
      [...(m[1] ?? '').matchAll(/<([0-9a-fA-F]+)>/g)]
        .map((h) => Buffer.from(h[1] ?? '', 'hex').toString('latin1'))
        .join('')
        .replace(/\u0097/g, '—')
        .replace(/\u00a0/g, ' '),
    );
    const pedacos = linhas;
    paginas.push(pedacos.join(' '));
  }
  return paginas;
}

const normalizar = (texto: string) => texto.replace(/\s+/g, ' ');

describe('gerarPdfDeOrcamento (UC19)', () => {
  it('gera um PDF com os dados da empresa, do cliente e o dinheiro em R$ pt-BR', async () => {
    const pdf = await gerarPdfDeOrcamento(detalhe(2), EMPRESA);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const texto = normalizar(textoPorPagina(pdf).join(' '));
    expect(texto).toContain('Empresa Fictícia Ltda');
    expect(texto).toContain('Orçamento nº 00003');
    expect(texto).toContain('11.222.333/0001-81');
    expect(texto).toContain('CEP 12345-678');
    expect(texto).toContain('R$ 1.234.567,89');
    expect(texto).toContain('R$ 5.000.000.000,00');
    expect(texto).not.toMatch(/\b\d{8,}\b.*\bNaN\b|NaN|undefined|null|\[object/);
  });

  it('mostra a data de emissão sem deslocar o dia pelo fuso', async () => {
    const texto = normalizar(
      textoPorPagina(await gerarPdfDeOrcamento(detalhe(1), EMPRESA)).join(' '),
    );
    expect(texto).toContain('Data de emissão: 17/11/2026');
    expect(texto).toContain('Validade da proposta: 17/12/2026');
  });

  it('mantém totais e avisos legíveis na largura da página (sem coluna estreita)', async () => {
    const texto = textoPorPagina(await gerarPdfDeOrcamento(detalhe(2), EMPRESA)).join(' ');
    // Antes do conserto cada palavra quebrava em linha própria; a frase inteira cabe em um trecho.
    expect(texto).toContain('Valor total da proposta (com impostos): R$ 5.000.000.000,00');
    expect(texto).toContain('Lei Geral de');
  });

  it('não perde nenhum item e repete o cabeçalho da tabela em cada página', async () => {
    const quantidade = 45;
    const pdf = await gerarPdfDeOrcamento(detalhe(quantidade), EMPRESA);
    const paginas = textoPorPagina(pdf);
    expect(paginas.length).toBeGreaterThan(1);
    const todo = normalizar(paginas.join(' '));
    for (let i = 1; i <= quantidade; i += 1) {
      expect(todo).toMatch(new RegExp(`CODIGO-? ?LONGO-${i}\\s`));
    }
    const comTabela = paginas.filter((pagina) => normalizar(pagina).includes('Imposto (18%)'));
    expect(comTabela.length).toBeGreaterThan(1);
    expect(todo).toContain(`página ${paginas.length} de ${paginas.length}`);
  });

  it('não trunca descrição nem endereço longos', async () => {
    const texto = normalizar(
      textoPorPagina(await gerarPdfDeOrcamento(detalhe(1), EMPRESA)).join(' '),
    );
    // Cabeçalho do cliente é texto corrido (uma frase contínua); a descrição é célula de tabela.
    expect(texto).toContain('Comprido para Testar Quebra de Linha Ltda ME');
    expect(texto).toContain('Quebra de Linha do Endereço, 12345');
    expect(texto).toContain('descrição');
    expect(texto).toContain('forçar');
  });
});
