// UC01, UC14-19 — testes de ServicoDeOrcamentos contra o banco em memória, sem passar pelas
// rotas HTTP.
import {
  ErroDeAnexoNaoEncontrado,
  ErroDeClienteBloqueado,
  ErroDeClienteNaoEncontrado,
  ErroDeEmissaoBloqueada,
  ErroDeEnvioNaoPermitido,
  ErroDeEstoqueIndisponivel,
  ErroDeItemNaoEncontrado,
  ErroDeOrcamentoNaoEditavel,
  ErroDeOrcamentoNaoEncontrado,
  ErroDePdfIndisponivel,
  ErroDeServicoIndisponivel,
  ErroDeValidacao,
} from '../../erros';
import {
  ErroDeEnvioDeEmail,
  type EnviadorDeEmail,
  type MensagemDeEmail,
} from '../../email/enviador';
import { criarLogger } from '../../log';
import { CONFIG_DE_TESTE } from '../../testing/appDeTeste';
import {
  montarCenarioDeCadastros,
  type CenarioDeCadastros,
} from '../../testing/cenarioDeCadastros';
import type { Sessao } from '../auth/sessoes';
import { RepositorioDeClientes } from '../clientes/repositorio';
import { RepositorioDePedidos } from '../pedidos/repositorio';
import { RepositorioDeProdutos } from '../produtos/repositorio';
import { RepositorioDeUsuarios } from '../usuarios/repositorio';
import { RepositorioDeOrcamentos } from './repositorio';
import { ServicoDeOrcamentos } from './servico';

const LOGGER_SILENCIOSO = criarLogger({ nivel: 'silent', destino: { write: () => undefined } });
let contador = 0;

const UPLOAD_DE_FICHA = {
  tipoAnexo: 'DESCRITIVO_TECNICO',
  nomeArquivo: 'ficha.pdf',
  tipoConteudo: 'application/pdf',
  conteudo: Buffer.from('conteúdo da ficha'),
} as const;

function sessaoDoOperador(idOperador: number, usuario = 'operador'): Sessao {
  return {
    idOperador,
    usuario,
    nome: usuario,
    email: `${usuario}@suprimax.com.br`,
    perfil: 'OPERADOR',
  };
}

function montarServico(
  cenario: CenarioDeCadastros,
  enviadorDeEmail?: EnviadorDeEmail,
): ServicoDeOrcamentos {
  return new ServicoDeOrcamentos({
    orcamentos: new RepositorioDeOrcamentos(cenario.proxy),
    clientes: new RepositorioDeClientes(cenario.proxy),
    produtos: new RepositorioDeProdutos(cenario.proxy),
    usuarios: new RepositorioDeUsuarios(cenario.proxy),
    proxy: cenario.proxy,
    armazenamento: cenario.armazenamento,
    logger: LOGGER_SILENCIOSO,
    empresaEmissora: CONFIG_DE_TESTE.empresaEmissora,
    enviadorDeEmail,
  });
}

/** Semeia um cliente (ativo, sem dívida) e devolve o id; `primeiraCompra` controla o histórico. */
function semearCliente(
  cenario: CenarioDeCadastros,
  status?: string,
  statusDoVendedor?: string,
): number {
  contador += 1;
  const idVendedor = cenario.semearUsuario('VENDEDOR', `vendedor-${contador}`, statusDoVendedor);
  const [cliente] = cenario.banco.semear('cliente', {
    cnpj: String(20000000000000 + contador).padStart(14, '0'),
    razao_social: `Cliente ${contador}`,
    nome_contato: 'Contato',
    tipo_unidade: 'MATRIZ',
    id_operador_vendedor: idVendedor,
    aceite_lgpd: true,
    data_aceite_lgpd: new Date().toISOString(),
    ...(status === undefined ? {} : { status }),
  });
  return cliente?.id_cliente as number;
}

/** Registra uma dívida do cliente com o status informado (UC14-E2, RN06). */
function semearDivida(cenario: CenarioDeCadastros, idCliente: number, status: string): void {
  const idOperador = cenario.semearUsuario('FINANCEIRO', `financeiro-${(contador += 1)}`);
  cenario.banco.semear('divida_inadimplencia', {
    id_cliente: idCliente,
    id_operador_registro: idOperador,
    valor_divida: '1000.00',
    status,
    data_vencimento_original: '2026-09-30',
  });
}

/** Uma compra já aceita antes: o cliente deixa de ser "primeira compra" (mínimo e crédito valem). */
function semearCompraAnterior(
  cenario: CenarioDeCadastros,
  idCliente: number,
  idOperador: number,
): void {
  cenario.banco.semear('orcamento', {
    id_cliente: idCliente,
    id_operador: idOperador,
    status: 'ACEITO',
  });
}

/** Semeia um produto com uma variação, uma faixa de preço (AVULSO) e um fardo. */
function semearVariacao(
  cenario: CenarioDeCadastros,
  opcoes: {
    quantidadeEstoque?: number;
    precoUnitario?: number;
    precoFardo?: number;
    unidadesPorFardo?: number;
  } = {},
) {
  contador += 1;
  const [produto] = cenario.banco.semear('produto', {
    codigo_interno: `PROD-${contador}`,
    descricao: 'Papel Higiênico',
  });
  const [variacao] = cenario.banco.semear('variacao_produto', {
    id_produto: produto?.id_produto,
    marca: 'MarcaX',
    tamanho_embalagem: '30m',
    quantidade_estoque: opcoes.quantidadeEstoque ?? 1000,
  });
  const idVariacao = variacao?.id_variacao as number;
  cenario.banco.semear('faixa_preco', {
    id_variacao: idVariacao,
    quantidade_minima: 1,
    preco_unitario: ((opcoes.precoUnitario ?? 600) / 100).toFixed(2),
  });
  const [fardo] = cenario.banco.semear('fardo', {
    id_variacao: idVariacao,
    quantidade_unidades: opcoes.unidadesPorFardo ?? 10,
    preco_fixo: ((opcoes.precoFardo ?? 5000) / 100).toFixed(2),
  });
  return { idVariacao, idFardo: fardo?.id_fardo as number };
}

describe('ServicoDeOrcamentos', () => {
  describe('criar', () => {
    it('cria o orçamento em RASCUNHO, sem itens', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-cria');
      const idCliente = semearCliente(cenario);

      const detalhe = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessaoDoOperador(idOperador, 'quem-cria'),
      );

      expect(detalhe.status).toBe('RASCUNHO');
      expect(detalhe.itens).toEqual([]);
      expect(detalhe.condicoes.bloqueios).toEqual([
        expect.objectContaining({ codigo: 'SEM_ITENS' }),
        expect.objectContaining({ codigo: 'CONDICOES_INCOMPLETAS' }),
      ]);
    });
  });

  describe('criar: cliente que não pode comprar (UC14-E1/E2, RN06)', () => {
    async function tentarCriar(
      prepararCliente: (cenario: CenarioDeCadastros) => number,
    ): Promise<{ cenario: CenarioDeCadastros; erro: unknown }> {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-cria');
      const idCliente = prepararCliente(cenario);
      const erro = await servico
        .criar(
          { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
          sessaoDoOperador(idOperador, 'quem-cria'),
        )
        .then(
          () => null,
          (falha: unknown) => falha,
        );
      return { cenario, erro };
    }

    it.each([
      ['INATIVO', /inativo/],
      ['BLOQUEADO', /bloqueado/],
    ])('recusa cliente %s sem gravar o orçamento', async (status, texto) => {
      const { cenario, erro } = await tentarCriar((c) => semearCliente(c, status));

      expect(erro).toBeInstanceOf(ErroDeClienteBloqueado);
      expect((erro as Error).message).toMatch(texto);
      expect(cenario.banco.linhas('orcamento')).toHaveLength(0);
    });

    it.each(['EM_ABERTO', 'PROTESTADA'])('recusa cliente com dívida %s', async (statusDaDivida) => {
      const { cenario, erro } = await tentarCriar((c) => {
        const idCliente = semearCliente(c);
        semearDivida(c, idCliente, statusDaDivida);
        return idCliente;
      });

      expect(erro).toBeInstanceOf(ErroDeClienteBloqueado);
      expect((erro as Error).message).toMatch(/dívida em aberto/);
      expect(cenario.banco.linhas('orcamento')).toHaveLength(0);
    });

    it.each(['RENEGOCIADA', 'QUITADA'])('aceita cliente com dívida %s', async (statusDaDivida) => {
      const { cenario, erro } = await tentarCriar((c) => {
        const idCliente = semearCliente(c);
        semearDivida(c, idCliente, statusDaDivida);
        return idCliente;
      });

      expect(erro).toBeNull();
      expect(cenario.banco.linhas('orcamento')).toHaveLength(1);
    });

    it('responde cliente não encontrado quando o cliente não existe', async () => {
      const { erro } = await tentarCriar(() => 99999);

      expect(erro).toBeInstanceOf(ErroDeClienteNaoEncontrado);
    });
  });

  describe('adicionarItem', () => {
    it('calcula a linha e soma os totais do orçamento (AVULSO)', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-adiciona');
      const idCliente = semearCliente(cenario);
      const { idVariacao } = semearVariacao(cenario, { precoUnitario: 600 });
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessaoDoOperador(idOperador, 'quem-adiciona'),
      );

      const detalhe = await servico.adicionarItem(
        idOrcamento,
        { idVariacao, granularidade: 'AVULSO', quantidade: 100 },
        sessaoDoOperador(idOperador, 'quem-adiciona'),
      );

      expect(detalhe.itens).toHaveLength(1);
      expect(detalhe.itens[0]).toMatchObject({
        produto: 'Papel Higiênico',
        marca: 'MarcaX',
        precoUnitarioAplicado: 600,
        quantidade: 100,
      });
      // 100 * 600 = 60000 de linha; 18% de imposto, arredondado = 10800; total = 70800.
      expect(detalhe.condicoes.valorTotalItens).toBe(70800);
      expect(detalhe.condicoes.bloqueios).toEqual([
        expect.objectContaining({ codigo: 'CONDICOES_INCOMPLETAS' }),
      ]);
    });

    it('rejeita quando a quantidade excede o saldo disponível (UC17-E1)', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-adiciona');
      const idCliente = semearCliente(cenario);
      const { idVariacao } = semearVariacao(cenario, { quantidadeEstoque: 5 });
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessaoDoOperador(idOperador, 'quem-adiciona'),
      );

      await expect(
        servico.adicionarItem(
          idOrcamento,
          { idVariacao, granularidade: 'AVULSO', quantidade: 10 },
          sessaoDoOperador(idOperador, 'quem-adiciona'),
        ),
      ).rejects.toBeInstanceOf(ErroDeEstoqueIndisponivel);
    });

    it('rejeita em um orçamento que não está mais editável', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-adiciona');
      const idCliente = semearCliente(cenario);
      const { idVariacao } = semearVariacao(cenario);
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessaoDoOperador(idOperador, 'quem-adiciona'),
      );
      await servico.cancelar(idOrcamento, null, sessaoDoOperador(idOperador, 'quem-adiciona'));

      await expect(
        servico.adicionarItem(
          idOrcamento,
          { idVariacao, granularidade: 'AVULSO', quantidade: 1 },
          sessaoDoOperador(idOperador, 'quem-adiciona'),
        ),
      ).rejects.toBeInstanceOf(ErroDeOrcamentoNaoEditavel);
    });
  });

  describe('alterarQuantidade e removerItem', () => {
    it('recalcula os totais ao alterar a quantidade', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-altera');
      const idCliente = semearCliente(cenario);
      const { idVariacao } = semearVariacao(cenario, { precoUnitario: 600 });
      const sessao = sessaoDoOperador(idOperador, 'quem-altera');
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessao,
      );
      const comItem = await servico.adicionarItem(
        idOrcamento,
        { idVariacao, granularidade: 'AVULSO', quantidade: 10 },
        sessao,
      );
      const idItem = comItem.itens[0]?.idItem as number;

      const alterado = await servico.alterarQuantidade(idOrcamento, idItem, 20, sessao);

      expect(alterado.itens[0]?.quantidade).toBe(20);
      expect(alterado.condicoes.valorTotalItens).toBe(14160); // 20*600=12000 + 18% = 14160

      const semItem = await servico.removerItem(idOrcamento, idItem, sessao);
      expect(semItem.itens).toEqual([]);
      expect(semItem.condicoes.valorTotalItens).toBe(0);
    });

    it('rejeita um item que não pertence ao orçamento', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-altera');
      const idCliente = semearCliente(cenario);
      const sessao = sessaoDoOperador(idOperador, 'quem-altera');
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessao,
      );

      await expect(servico.alterarQuantidade(idOrcamento, 999, 1, sessao)).rejects.toBeInstanceOf(
        ErroDeItemNaoEncontrado,
      );
    });
  });

  describe('anexar e removerAnexo', () => {
    it('anexa um arquivo e depois o remove', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-anexa');
      const idCliente = semearCliente(cenario);
      const sessao = sessaoDoOperador(idOperador, 'quem-anexa');
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessao,
      );

      const comAnexo = await servico.anexar(idOrcamento, { ...UPLOAD_DE_FICHA }, sessao);

      expect(comAnexo.anexos).toEqual([
        expect.objectContaining({ tipoAnexo: 'DESCRITIVO_TECNICO', nomeArquivo: 'ficha.pdf' }),
      ]);
      const idAnexo = comAnexo.anexos[0]?.idAnexo as number;
      // `caminhoArquivo`/`tamanhoBytes` nunca aparecem no detalhe exposto (ver `AnexoDetalhado`).
      expect(comAnexo.anexos[0]).not.toHaveProperty('caminhoArquivo');
      expect(comAnexo.anexos[0]).not.toHaveProperty('tamanhoBytes');

      const semAnexo = await servico.removerAnexo(idOrcamento, idAnexo, sessao);
      expect(semAnexo.anexos).toEqual([]);
    });

    async function prepararOrcamento(cenario: CenarioDeCadastros) {
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-anexa');
      const idCliente = semearCliente(cenario);
      const sessao = sessaoDoOperador(idOperador, 'quem-anexa');
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessao,
      );
      return { servico, sessao, idOrcamento };
    }

    it('grava os bytes no armazenamento e o caminho real na linha', async () => {
      const cenario = montarCenarioDeCadastros();
      const { servico, sessao, idOrcamento } = await prepararOrcamento(cenario);

      await servico.anexar(idOrcamento, UPLOAD_DE_FICHA, sessao);

      const [linha] = cenario.banco.linhas('anexo_orcamento');
      const caminho = linha?.caminho_arquivo as string;
      expect(cenario.armazenamento.objetos.get(caminho)?.conteudo).toEqual(
        UPLOAD_DE_FICHA.conteudo,
      );
      expect(linha?.tamanho_bytes).toBe(UPLOAD_DE_FICHA.conteudo.length);
    });

    it('não grava a linha quando salvar o arquivo falha', async () => {
      const cenario = montarCenarioDeCadastros();
      const { servico, sessao, idOrcamento } = await prepararOrcamento(cenario);
      cenario.armazenamento.falharAoSalvar = true;

      await expect(servico.anexar(idOrcamento, UPLOAD_DE_FICHA, sessao)).rejects.toMatchObject({
        status: 503,
      });

      expect(cenario.banco.linhas('anexo_orcamento')).toEqual([]);
      expect(cenario.armazenamento.objetos.size).toBe(0);
    });

    it('remove o objeto quando gravar a linha falha (compensação)', async () => {
      const cenario = montarCenarioDeCadastros();
      const { servico, sessao, idOrcamento } = await prepararOrcamento(cenario);
      const espiao = jest
        .spyOn(RepositorioDeOrcamentos.prototype, 'inserirAnexo')
        .mockRejectedValueOnce(new Error('banco fora'));

      await expect(servico.anexar(idOrcamento, UPLOAD_DE_FICHA, sessao)).rejects.toThrow(
        'banco fora',
      );

      espiao.mockRestore();
      expect(cenario.armazenamento.objetos.size).toBe(0);
    });

    it('mantém o erro original quando a compensação também falha', async () => {
      const cenario = montarCenarioDeCadastros();
      const { servico, sessao, idOrcamento } = await prepararOrcamento(cenario);
      const espiao = jest
        .spyOn(RepositorioDeOrcamentos.prototype, 'inserirAnexo')
        .mockRejectedValueOnce(new Error('banco fora'));
      cenario.armazenamento.falharAoRemover = true;

      await expect(servico.anexar(idOrcamento, UPLOAD_DE_FICHA, sessao)).rejects.toThrow(
        'banco fora',
      );

      espiao.mockRestore();
    });

    it('remove a linha e o objeto ao remover o anexo', async () => {
      const cenario = montarCenarioDeCadastros();
      const { servico, sessao, idOrcamento } = await prepararOrcamento(cenario);
      const comAnexo = await servico.anexar(idOrcamento, UPLOAD_DE_FICHA, sessao);

      await servico.removerAnexo(idOrcamento, comAnexo.anexos[0]?.idAnexo as number, sessao);

      expect(cenario.armazenamento.objetos.size).toBe(0);
      expect(cenario.banco.linhas('anexo_orcamento')).toEqual([]);
    });

    it('não falha se o objeto não puder ser removido depois da linha', async () => {
      const cenario = montarCenarioDeCadastros();
      const { servico, sessao, idOrcamento } = await prepararOrcamento(cenario);
      const comAnexo = await servico.anexar(idOrcamento, UPLOAD_DE_FICHA, sessao);
      cenario.armazenamento.falharAoRemover = true;

      const semAnexo = await servico.removerAnexo(
        idOrcamento,
        comAnexo.anexos[0]?.idAnexo as number,
        sessao,
      );

      expect(semAnexo.anexos).toEqual([]);
      expect(cenario.armazenamento.objetos.size).toBe(1);
    });

    it('gera a URL assinada do anexo e rejeita anexo de outro orçamento', async () => {
      const cenario = montarCenarioDeCadastros();
      const { servico, sessao, idOrcamento } = await prepararOrcamento(cenario);
      const comAnexo = await servico.anexar(idOrcamento, UPLOAD_DE_FICHA, sessao);
      const idAnexo = comAnexo.anexos[0]?.idAnexo as number;

      const assinada = await servico.obterUrlDoAnexo(idOrcamento, idAnexo);

      expect(assinada.url).toContain('https://');
      expect(Number.isNaN(Date.parse(assinada.expiraEm))).toBe(false);
      await expect(servico.obterUrlDoAnexo(idOrcamento, 999)).rejects.toBeInstanceOf(
        ErroDeAnexoNaoEncontrado,
      );
    });

    it('rejeita anexar quando o orçamento não está mais editável', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-anexa');
      const idCliente = semearCliente(cenario);
      const { idVariacao } = semearVariacao(cenario, { precoUnitario: 600 });
      const sessao = sessaoDoOperador(idOperador, 'quem-anexa');
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessao,
      );
      await servico.adicionarItem(
        idOrcamento,
        { idVariacao, granularidade: 'AVULSO', quantidade: 1 },
        sessao,
      );
      await servico.atualizarCondicoes(
        idOrcamento,
        { condicaoPagamento: 'ADIANTADO_100', origemTransportadora: 'SUPRIMAX', valorFrete: 2000 },
        sessao,
      );
      await servico.emitir(idOrcamento, sessao);

      await expect(
        servico.anexar(
          idOrcamento,
          { ...UPLOAD_DE_FICHA, tipoAnexo: 'MATERIAL_APOIO', nomeArquivo: 'catalogo.pdf' },
          sessao,
        ),
      ).rejects.toBeInstanceOf(ErroDeOrcamentoNaoEditavel);
    });

    it('rejeita remover um anexo que não pertence ao orçamento', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-anexa');
      const idCliente = semearCliente(cenario);
      const sessao = sessaoDoOperador(idOperador, 'quem-anexa');
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessao,
      );

      await expect(servico.removerAnexo(idOrcamento, 999, sessao)).rejects.toBeInstanceOf(
        ErroDeAnexoNaoEncontrado,
      );
    });
  });

  describe('gerarPdf', () => {
    it('gera um PDF para um orçamento emitido', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-emite-pdf');
      const idCliente = semearCliente(cenario);
      const { idVariacao } = semearVariacao(cenario, { precoUnitario: 600 });
      const sessao = sessaoDoOperador(idOperador, 'quem-emite-pdf');
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessao,
      );
      await servico.adicionarItem(
        idOrcamento,
        { idVariacao, granularidade: 'AVULSO', quantidade: 1 },
        sessao,
      );
      await servico.atualizarCondicoes(
        idOrcamento,
        { condicaoPagamento: 'ADIANTADO_100', origemTransportadora: 'SUPRIMAX', valorFrete: 2000 },
        sessao,
      );
      await servico.emitir(idOrcamento, sessao);

      const pdf = await servico.gerarPdf(idOrcamento);

      expect(pdf).toBeInstanceOf(Buffer);
      expect(pdf.length).toBeGreaterThan(0);
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    });

    it('rejeita um orçamento ainda em RASCUNHO (sem número)', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-emite-pdf');
      const idCliente = semearCliente(cenario);
      const sessao = sessaoDoOperador(idOperador, 'quem-emite-pdf');
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessao,
      );

      await expect(servico.gerarPdf(idOrcamento)).rejects.toBeInstanceOf(ErroDePdfIndisponivel);
    });

    it('rejeita um orçamento inexistente', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);

      await expect(servico.gerarPdf(999)).rejects.toBeInstanceOf(ErroDeOrcamentoNaoEncontrado);
    });
  });

  describe('enviar', () => {
    /** Orçamento emitido (ABERTO) de um cliente cujo vendedor tem o e-mail `vendedor-N@…`. */
    async function emitirParaEnvio(
      enviador?: EnviadorDeEmail,
      opcoes: { statusDoVendedorDoCliente?: string; pedido?: { statusDoVendedor: string } } = {},
    ) {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario, enviador);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-envia');
      const idCliente = semearCliente(cenario, undefined, opcoes.statusDoVendedorDoCliente);
      const { idVariacao } = semearVariacao(cenario, { precoUnitario: 600 });
      const sessao = sessaoDoOperador(idOperador, 'quem-envia');
      let idOrcamento: number;
      if (opcoes.pedido === undefined) {
        ({ idOrcamento } = await servico.criar(
          { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
          sessao,
        ));
      } else {
        const idVendedorDoPedido = cenario.semearUsuario(
          'VENDEDOR',
          'vendedor-do-pedido',
          opcoes.pedido.statusDoVendedor,
        );
        const [linha] = cenario.banco.semear('pedido', {
          id_cliente: idCliente,
          id_operador_vendedor: idVendedorDoPedido,
          status: 'EM_ANALISE',
          id_operador_atendimento: idOperador,
        });
        const pedidos = new RepositorioDePedidos(cenario.proxy);
        const pedido = await pedidos.buscarPorId(linha?.id_pedido as number);
        idOrcamento = await servico.montarAPartirDoPedido(pedido!, [], sessao);
      }
      await servico.adicionarItem(
        idOrcamento,
        { idVariacao, granularidade: 'AVULSO', quantidade: 1 },
        sessao,
      );
      await servico.atualizarCondicoes(
        idOrcamento,
        { condicaoPagamento: 'ADIANTADO_100', origemTransportadora: 'SUPRIMAX', valorFrete: 2000 },
        sessao,
      );
      const emitido = await servico.emitir(idOrcamento, sessao);
      return { servico, sessao, idOrcamento, numero: emitido.numeroOrcamento };
    }

    const eventosDeEnvio = async (servico: ServicoDeOrcamentos, idOrcamento: number) =>
      (await servico.obter(idOrcamento)).historico.filter(
        (evento) => evento.tipoEvento === 'ATUALIZACAO_FOLLOWUP',
      );

    function enviadorEspiao(falhar = false) {
      const mensagens: MensagemDeEmail[] = [];
      const enviador: EnviadorDeEmail = {
        enviar: (mensagem) => {
          if (falhar) {
            return Promise.reject(new ErroDeEnvioDeEmail('Resend indisponível.'));
          }
          mensagens.push(mensagem);
          return Promise.resolve();
        },
      };
      return { mensagens, enviador };
    }

    it('envia o PDF ao vendedor da carteira e grava o evento com o operador', async () => {
      const { mensagens, enviador } = enviadorEspiao();
      const { servico, sessao, idOrcamento, numero } = await emitirParaEnvio(enviador);

      await servico.enviar(idOrcamento, sessao);

      expect(mensagens).toHaveLength(1);
      expect(mensagens[0]?.para).toMatch(/^vendedor-\d+@suprimax\.com\.br$/);
      expect(mensagens[0]?.assunto).toContain(String(numero));
      const anexo = mensagens[0]?.anexos?.[0];
      expect(anexo?.nomeArquivo).toBe(`orcamento-${idOrcamento}.pdf`);
      expect(anexo?.conteudo.subarray(0, 4).toString()).toBe('%PDF');
      const detalhe = await servico.obter(idOrcamento);
      expect(detalhe.historico).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            tipoEvento: 'ATUALIZACAO_FOLLOWUP',
            observacao: 'Documento enviado ao cliente.',
            usuario: 'quem-envia',
          }),
        ]),
      );
    });

    it('com pedido de origem, o destinatário é o vendedor do pedido', async () => {
      const { mensagens, enviador } = enviadorEspiao();
      const { servico, sessao, idOrcamento } = await emitirParaEnvio(enviador, {
        pedido: { statusDoVendedor: 'ATIVO' },
      });

      await servico.enviar(idOrcamento, sessao);

      expect(mensagens[0]?.para).toBe('vendedor-do-pedido@suprimax.com.br');
    });

    it('vendedor do pedido inativo: cai no vendedor da carteira do cliente', async () => {
      const { mensagens, enviador } = enviadorEspiao();
      const { servico, sessao, idOrcamento } = await emitirParaEnvio(enviador, {
        pedido: { statusDoVendedor: 'INATIVO' },
      });

      await servico.enviar(idOrcamento, sessao);

      expect(mensagens[0]?.para).toMatch(/^vendedor-\d+@suprimax\.com\.br$/);
    });

    it('sem vendedor utilizável (pedido e carteira inativos): vai ao operador logado', async () => {
      const { mensagens, enviador } = enviadorEspiao();
      const { servico, sessao, idOrcamento } = await emitirParaEnvio(enviador, {
        pedido: { statusDoVendedor: 'INATIVO' },
        statusDoVendedorDoCliente: 'INATIVO',
      });

      await servico.enviar(idOrcamento, sessao);

      expect(mensagens[0]?.para).toBe('quem-envia@suprimax.com.br');
    });

    it('sem enviador (modo mudo) o fluxo segue e grava o evento', async () => {
      const { servico, sessao, idOrcamento } = await emitirParaEnvio();

      await expect(servico.enviar(idOrcamento, sessao)).resolves.toBeUndefined();

      expect(await eventosDeEnvio(servico, idOrcamento)).toHaveLength(1);
    });

    it('falha do provedor vira 503 e nada é gravado', async () => {
      const { enviador } = enviadorEspiao(true);
      const { servico, sessao, idOrcamento } = await emitirParaEnvio(enviador);

      await expect(servico.enviar(idOrcamento, sessao)).rejects.toBeInstanceOf(
        ErroDeServicoIndisponivel,
      );

      expect(await eventosDeEnvio(servico, idOrcamento)).toHaveLength(0);
      expect((await servico.obter(idOrcamento)).status).toBe('ABERTO');
    });

    it('rejeita um orçamento cancelado sem enviar e-mail', async () => {
      const { mensagens, enviador } = enviadorEspiao();
      const { servico, sessao, idOrcamento } = await emitirParaEnvio(enviador);
      await servico.cancelar(idOrcamento, 'Cliente desistiu', sessao);

      await expect(servico.enviar(idOrcamento, sessao)).rejects.toBeInstanceOf(
        ErroDeEnvioNaoPermitido,
      );

      expect(mensagens).toHaveLength(0);
    });

    it('rejeita um orçamento ainda em RASCUNHO (sem número)', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-envia');
      const idCliente = semearCliente(cenario);
      const sessao = sessaoDoOperador(idOperador, 'quem-envia');
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessao,
      );

      await expect(servico.enviar(idOrcamento, sessao)).rejects.toBeInstanceOf(
        ErroDeEnvioNaoPermitido,
      );
    });

    it('rejeita um orçamento inexistente', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-envia');
      const sessao = sessaoDoOperador(idOperador, 'quem-envia');

      await expect(servico.enviar(999, sessao)).rejects.toBeInstanceOf(
        ErroDeOrcamentoNaoEncontrado,
      );
    });
  });

  describe('emitir', () => {
    it('bloqueia a emissão de um orçamento sem itens', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-emite');
      const idCliente = semearCliente(cenario);
      const sessao = sessaoDoOperador(idOperador, 'quem-emite');
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessao,
      );

      await expect(servico.emitir(idOrcamento, sessao)).rejects.toBeInstanceOf(
        ErroDeEmissaoBloqueada,
      );
    });

    it('bloqueia a emissão enquanto a condição de pagamento e o frete não foram definidos', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-emite');
      const idCliente = semearCliente(cenario);
      const { idVariacao } = semearVariacao(cenario, { precoUnitario: 600 });
      const sessao = sessaoDoOperador(idOperador, 'quem-emite');
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessao,
      );
      await servico.adicionarItem(
        idOrcamento,
        { idVariacao, granularidade: 'AVULSO', quantidade: 300 },
        sessao,
      );

      await expect(servico.emitir(idOrcamento, sessao)).rejects.toMatchObject({
        detalhes: { bloqueios: [expect.objectContaining({ codigo: 'CONDICOES_INCOMPLETAS' })] },
      });
      expect(cenario.banco.linhas('reserva_estoque')).toHaveLength(0);
    });

    it('responde orçamento não editável (e não erro interno) ao emitir um orçamento já emitido', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-emite');
      const idCliente = semearCliente(cenario);
      const { idVariacao } = semearVariacao(cenario, {
        precoUnitario: 600,
        quantidadeEstoque: 1000,
      });
      const sessao = sessaoDoOperador(idOperador, 'quem-emite');
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessao,
      );
      await servico.adicionarItem(
        idOrcamento,
        { idVariacao, granularidade: 'AVULSO', quantidade: 300 },
        sessao,
      );
      await servico.atualizarCondicoes(
        idOrcamento,
        { condicaoPagamento: 'ADIANTADO_100', origemTransportadora: 'SUPRIMAX', valorFrete: 2000 },
        sessao,
      );
      await servico.emitir(idOrcamento, sessao);

      await expect(servico.emitir(idOrcamento, sessao)).rejects.toBeInstanceOf(
        ErroDeOrcamentoNaoEditavel,
      );
    });

    it('emite um orçamento de primeira compra com itens (ADIANTADO_100, sem análise de crédito)', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-emite');
      const idCliente = semearCliente(cenario);
      const { idVariacao } = semearVariacao(cenario, {
        precoUnitario: 600,
        quantidadeEstoque: 1000,
      });
      const sessao = sessaoDoOperador(idOperador, 'quem-emite');
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessao,
      );
      await servico.adicionarItem(
        idOrcamento,
        { idVariacao, granularidade: 'AVULSO', quantidade: 300 },
        sessao,
      );

      await servico.atualizarCondicoes(
        idOrcamento,
        { condicaoPagamento: 'ADIANTADO_100', origemTransportadora: 'SUPRIMAX', valorFrete: 2000 },
        sessao,
      );
      const emitido = await servico.emitir(idOrcamento, sessao);

      expect(emitido.status).toBe('ABERTO');
      expect(emitido.numeroOrcamento).not.toBeNull();
      expect(emitido.chaveSeguranca).not.toBeNull();
      expect(emitido.dataValidade).not.toBeNull();

      const [reserva] = cenario.banco.linhas('reserva_estoque');
      expect(reserva?.quantidade_reservada).toBe(300);
      expect(reserva?.status).toBe('CONFIRMADA');
    });

    it('devolve de orcamento.emitir só id, número e validade, como no contrato (docs/12, 12.8.3)', async () => {
      const cenario = montarCenarioDeCadastros();
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-emite');
      const idCliente = semearCliente(cenario);
      const { idVariacao } = semearVariacao(cenario, { precoUnitario: 600, quantidadeEstoque: 10 });
      const servico = montarServico(cenario);
      const sessao = sessaoDoOperador(idOperador, 'quem-emite');
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessao,
      );
      await servico.adicionarItem(
        idOrcamento,
        { idVariacao, granularidade: 'AVULSO', quantidade: 3 },
        sessao,
      );

      const resposta = cenario.banco.executar('orcamento.emitir', {
        id_orcamento: idOrcamento,
        id_operador: idOperador,
        chave_seguranca: 'chave-de-teste',
      });

      expect(resposta.ok).toBe(true);
      expect(Object.keys(resposta.dados as object).sort()).toEqual([
        'data_validade',
        'id_orcamento',
        'numero_orcamento',
      ]);
    });

    it('ao emitir uma nova versão, o original vira SUBSTITUIDO e suas reservas são liberadas', async () => {
      const cenario = montarCenarioDeCadastros();
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-emite');
      const idCliente = semearCliente(cenario);
      const { idVariacao } = semearVariacao(cenario, { precoUnitario: 600, quantidadeEstoque: 10 });
      const servico = montarServico(cenario);
      const sessao = sessaoDoOperador(idOperador, 'quem-emite');
      const criar = async (): Promise<number> => {
        const { idOrcamento } = await servico.criar(
          { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
          sessao,
        );
        await servico.adicionarItem(
          idOrcamento,
          { idVariacao, granularidade: 'AVULSO', quantidade: 3 },
          sessao,
        );
        return idOrcamento;
      };
      const original = await criar();
      await servico.atualizarCondicoes(
        original,
        { condicaoPagamento: 'ADIANTADO_100', origemTransportadora: 'SUPRIMAX', valorFrete: 2000 },
        sessao,
      );
      await servico.emitir(original, sessao);
      const novaVersao = await criar();
      cenario.banco.executar('dados.atualizar', {
        tabela: 'orcamento',
        filtros: { e: [['id_orcamento', '=', novaVersao]] },
        valores: { id_orcamento_origem: original },
      });

      await servico.atualizarCondicoes(
        novaVersao,
        { condicaoPagamento: 'ADIANTADO_100', origemTransportadora: 'SUPRIMAX', valorFrete: 2000 },
        sessao,
      );
      await servico.emitir(novaVersao, sessao);

      const status = (id: number) =>
        cenario.banco.linhas('orcamento').find((linha) => linha.id_orcamento === id)?.status;
      expect(status(original)).toBe('SUBSTITUIDO');
      expect(status(novaVersao)).toBe('ABERTO');
      const reservas = cenario.banco.linhas('reserva_estoque').map((linha) => linha.status);
      expect(reservas.sort()).toEqual(['CONFIRMADA', 'LIBERADA']);
    });

    it('rejeita a emissão de um orçamento inexistente', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-emite');

      await expect(
        servico.emitir(999, sessaoDoOperador(idOperador, 'quem-emite')),
      ).rejects.toBeInstanceOf(ErroDeOrcamentoNaoEncontrado);
    });
  });

  describe('bloqueios e condições (UC18, UC19; módulo de cálculo)', () => {
    /** Orçamento de segunda compra com um item AVULSO de `precoUnitario` centavos (1 unidade). */
    async function montarSegundaCompra(precoUnitario: number, quantidadeEstoque = 1000) {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-calcula');
      const sessao = sessaoDoOperador(idOperador, 'quem-calcula');
      const idCliente = semearCliente(cenario);
      semearCompraAnterior(cenario, idCliente, idOperador);
      const { idVariacao } = semearVariacao(cenario, { precoUnitario, quantidadeEstoque });
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessao,
      );
      await servico.adicionarItem(
        idOrcamento,
        { idVariacao, granularidade: 'AVULSO', quantidade: 1 },
        sessao,
      );
      return { cenario, servico, sessao, idOrcamento, idVariacao };
    }

    it('abaixo do mínimo: texto da documentação com quanto falta (docs/10, tela 6)', async () => {
      // 30000 + 5400 de imposto = 35400; faltam 14600.
      const { servico, idOrcamento } = await montarSegundaCompra(30000);

      const { condicoes } = await servico.obter(idOrcamento);

      expect(condicoes.valorTotalItens).toBe(35400);
      expect(condicoes.bloqueios).toContainEqual({
        codigo: 'ABAIXO_DO_MINIMO',
        mensagem: 'Abaixo do faturamento mínimo de R$ 500,00 – faltam R$ 146,00',
      });
    });

    it('exatamente R$ 500,00 atende o mínimo (limite inclusivo)', async () => {
      // 42373 + 7627 de imposto = 50000.
      const { servico, idOrcamento } = await montarSegundaCompra(42373);

      const { condicoes } = await servico.obter(idOrcamento);

      expect(condicoes.valorTotalItens).toBe(50000);
      expect(condicoes.bloqueios.map((b) => b.codigo)).not.toContain('ABAIXO_DO_MINIMO');
    });

    it('a primeira compra não tem mínimo', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-calcula');
      const sessao = sessaoDoOperador(idOperador, 'quem-calcula');
      const idCliente = semearCliente(cenario);
      const { idVariacao } = semearVariacao(cenario, { precoUnitario: 1000 });
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessao,
      );
      await servico.adicionarItem(
        idOrcamento,
        { idVariacao, granularidade: 'AVULSO', quantidade: 1 },
        sessao,
      );

      const { condicoes } = await servico.obter(idOrcamento);

      expect(condicoes.bloqueios.map((b) => b.codigo)).not.toContain('ABAIXO_DO_MINIMO');
      expect(condicoes.condicoesPagamentoPermitidas).toEqual(['ADIANTADO_100']);
    });

    it.each([
      [30000, ['ADIANTADO_100']],
      [42373, ['ADIANTADO_100', 'BOLETO']],
      [127118, ['ADIANTADO_100', 'BOLETO']],
      [127119, ['ADIANTADO_100', 'BOLETO', 'PARCELADO']],
    ])(
      'condições permitidas com item de %i centavos (R$ 500 e R$ 1.500 inclusivos)',
      async (precoUnitario, esperadas) => {
        const { servico, idOrcamento } = await montarSegundaCompra(precoUnitario);

        const { condicoes } = await servico.obter(idOrcamento);

        expect(condicoes.condicoesPagamentoPermitidas).toEqual(esperadas);
      },
    );

    it('bloqueia o parcelado escolhido abaixo de R$ 1.500,00', async () => {
      const { servico, sessao, idOrcamento } = await montarSegundaCompra(100000);

      const detalhe = await servico.atualizarCondicoes(
        idOrcamento,
        { condicaoPagamento: 'PARCELADO', numeroParcelas: 3, origemTransportadora: 'SUPRIMAX' },
        sessao,
      );

      expect(detalhe.condicoes.bloqueios.map((b) => b.codigo)).toContain('CONDICAO_NAO_PERMITIDA');
    });

    it('estoque insuficiente: texto do UC19-E5, com produto, disponível e quantidade', async () => {
      const { cenario, servico, idOrcamento, idVariacao } = await montarSegundaCompra(60000, 5);
      cenario.banco.executar('dados.atualizar', {
        tabela: 'variacao_produto',
        valores: { quantidade_estoque: 0 },
        filtros: { e: [['id_variacao', '=', idVariacao]] },
      });

      const { condicoes } = await servico.obter(idOrcamento);

      expect(condicoes.bloqueios).toContainEqual({
        codigo: 'ESTOQUE_INSUFICIENTE',
        mensagem:
          'Estoque insuficiente para emitir: Papel Higiênico. Disponível: 0; no orçamento: 1. Ajuste a quantidade ou remova o item.',
      });
    });

    it('item FARDO é conferido em fardos, não em unidades', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-calcula');
      const sessao = sessaoDoOperador(idOperador, 'quem-calcula');
      const idCliente = semearCliente(cenario);
      // 25 unidades e fardos de 10: cabem 2 fardos.
      const { idVariacao, idFardo } = semearVariacao(cenario, {
        quantidadeEstoque: 25,
        unidadesPorFardo: 10,
      });
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessao,
      );
      await servico.adicionarItem(
        idOrcamento,
        { idVariacao, granularidade: 'FARDO', idFardo, quantidade: 2 },
        sessao,
      );
      expect(
        (await servico.obter(idOrcamento)).condicoes.bloqueios.map((b) => b.codigo),
      ).not.toContain('ESTOQUE_INSUFICIENTE');

      cenario.banco.executar('dados.atualizar', {
        tabela: 'variacao_produto',
        valores: { quantidade_estoque: 15 },
        filtros: { e: [['id_variacao', '=', idVariacao]] },
      });
      const { condicoes } = await servico.obter(idOrcamento);

      expect(condicoes.bloqueios).toContainEqual(
        expect.objectContaining({
          codigo: 'ESTOQUE_INSUFICIENTE',
          mensagem: expect.stringContaining('Disponível: 1; no orçamento: 2.'),
        }),
      );
    });

    it('bloqueia a emissão com frete provisório antes de chegar ao banco', async () => {
      const { cenario, servico, sessao, idOrcamento } = await montarSegundaCompra(60000);
      cenario.banco.executar('dados.atualizar', {
        tabela: 'orcamento',
        valores: {
          condicao_pagamento: 'ADIANTADO_100',
          modalidade_frete: 'FOB',
          origem_transportadora: 'SUPRIMAX',
          valor_frete: null,
          frete_provisorio: true,
        },
        filtros: { e: [['id_orcamento', '=', idOrcamento]] },
      });

      await expect(servico.emitir(idOrcamento, sessao)).rejects.toMatchObject({
        detalhes: { bloqueios: [expect.objectContaining({ codigo: 'FRETE_PROVISORIO' })] },
      });
    });
  });

  describe('histórico e versões (UC06)', () => {
    it('registra um evento por mudança de status, com o usuário e a observação', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-historia');
      const idCliente = semearCliente(cenario);
      const sessao = sessaoDoOperador(idOperador, 'quem-historia');
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessao,
      );

      await servico.cancelar(idOrcamento, 'Cliente desistiu', sessao);
      const detalhe = await servico.obter(idOrcamento);

      expect(detalhe.historico).toEqual([
        expect.objectContaining({
          tipoEvento: 'MUDANCA_STATUS',
          statusAnterior: null,
          statusNovo: 'RASCUNHO',
          observacao: null,
          usuario: 'quem-historia',
        }),
        expect.objectContaining({
          tipoEvento: 'MUDANCA_STATUS',
          statusAnterior: 'RASCUNHO',
          statusNovo: 'CANCELADO',
          observacao: 'Cliente desistiu',
          usuario: 'quem-historia',
        }),
      ]);
      expect(detalhe.versoes).toEqual([
        { idOrcamento, numeroOrcamento: null, status: 'CANCELADO' },
      ]);
    });
  });

  describe('aviso de edição de rascunho: responsável e alteração de outro operador', () => {
    it('informa o responsável e nenhuma alteração de terceiros quando só o dono mexeu', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idDono = cenario.semearUsuario('OPERADOR', 'dono-rascunho');
      const idCliente = semearCliente(cenario);
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessaoDoOperador(idDono, 'dono-rascunho'),
      );

      const detalhe = await servico.obter(idOrcamento);

      expect(detalhe.responsavel).toEqual({ idOperador: idDono, nome: 'dono-rascunho' });
      expect(detalhe.ultimaAlteracaoDeOutro).toBeNull();
    });

    it('informa quem e quando, se outro operador registrou evento no histórico', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idDono = cenario.semearUsuario('OPERADOR', 'dono-rascunho');
      const idOutro = cenario.semearUsuario('OPERADOR', 'colega');
      const idCliente = semearCliente(cenario);
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessaoDoOperador(idDono, 'dono-rascunho'),
      );
      await new RepositorioDeOrcamentos(cenario.proxy).registrarHistorico({
        idOrcamento,
        idOperador: idOutro,
        tipoEvento: 'ATUALIZACAO_FOLLOWUP',
        statusAnterior: 'RASCUNHO',
        statusNovo: 'RASCUNHO',
        observacao: null,
      });

      const detalhe = await servico.obter(idOrcamento);

      expect(detalhe.responsavel.nome).toBe('dono-rascunho');
      expect(detalhe.ultimaAlteracaoDeOutro).toEqual({
        idOperador: idOutro,
        nome: 'colega',
        data: expect.any(String),
      });
    });

    describe('quem editou o rascunho (id_operador_ultima_edicao)', () => {
      async function montarRascunhoComItem() {
        const cenario = montarCenarioDeCadastros();
        const servico = montarServico(cenario);
        const idDono = cenario.semearUsuario('OPERADOR', 'dono-rascunho');
        const idOutro = cenario.semearUsuario('OPERADOR', 'colega');
        const idCliente = semearCliente(cenario);
        const sessaoDono = sessaoDoOperador(idDono, 'dono-rascunho');
        const sessaoOutro = sessaoDoOperador(idOutro, 'colega');
        const { idOrcamento } = await servico.criar(
          { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
          sessaoDono,
        );
        const { idVariacao } = semearVariacao(cenario);
        return {
          cenario,
          servico,
          idDono,
          idOutro,
          sessaoDono,
          sessaoOutro,
          idOrcamento,
          idVariacao,
        };
      }

      it('o responsável edita: sem aviso', async () => {
        const c = await montarRascunhoComItem();
        const detalhe = await c.servico.adicionarItem(
          c.idOrcamento,
          { idVariacao: c.idVariacao, granularidade: 'AVULSO', quantidade: 10 },
          c.sessaoDono,
        );
        expect(detalhe.ultimaAlteracaoDeOutro).toBeNull();
        expect(c.cenario.banco.linhas('orcamento')[0]?.id_operador_ultima_edicao).toBe(c.idDono);
      });

      it('outro operador altera item, cabeçalho ou condições: o responsável é avisado', async () => {
        const c = await montarRascunhoComItem();
        const aviso = { idOperador: c.idOutro, nome: 'colega', data: expect.any(String) };

        let detalhe = await c.servico.adicionarItem(
          c.idOrcamento,
          { idVariacao: c.idVariacao, granularidade: 'AVULSO', quantidade: 10 },
          c.sessaoOutro,
        );
        expect(detalhe.ultimaAlteracaoDeOutro).toEqual(aviso);

        await c.servico.atualizarCabecalho(
          c.idOrcamento,
          { contatoSolicitacao: 'Ana' },
          c.sessaoDono,
        );
        detalhe = await c.servico.atualizarCabecalho(
          c.idOrcamento,
          { contatoSolicitacao: 'Beto' },
          c.sessaoOutro,
        );
        expect(detalhe.ultimaAlteracaoDeOutro).toEqual(aviso);

        await c.servico.atualizarCondicoes(
          c.idOrcamento,
          {
            condicaoPagamento: 'ADIANTADO_100',
            origemTransportadora: 'SUPRIMAX',
            valorFrete: 2000,
          },
          c.sessaoDono,
        );
        detalhe = await c.servico.atualizarCondicoes(
          c.idOrcamento,
          {
            condicaoPagamento: 'ADIANTADO_100',
            origemTransportadora: 'SUPRIMAX',
            valorFrete: 2000,
          },
          c.sessaoOutro,
        );
        expect(detalhe.ultimaAlteracaoDeOutro).toEqual(aviso);
      });

      it('o aviso some quando o responsável volta a editar (alterar e remover item)', async () => {
        const c = await montarRascunhoComItem();
        const comItem = await c.servico.adicionarItem(
          c.idOrcamento,
          { idVariacao: c.idVariacao, granularidade: 'AVULSO', quantidade: 10 },
          c.sessaoOutro,
        );
        const idItem = comItem.itens[0]?.idItem as number;
        expect(comItem.ultimaAlteracaoDeOutro).not.toBeNull();

        const alterado = await c.servico.alterarQuantidade(c.idOrcamento, idItem, 11, c.sessaoDono);
        expect(alterado.ultimaAlteracaoDeOutro).toBeNull();

        const outraVez = await c.servico.alterarQuantidade(
          c.idOrcamento,
          idItem,
          12,
          c.sessaoOutro,
        );
        expect(outraVez.ultimaAlteracaoDeOutro?.idOperador).toBe(c.idOutro);

        const removido = await c.servico.removerItem(c.idOrcamento, idItem, c.sessaoDono);
        expect(removido.ultimaAlteracaoDeOutro).toBeNull();
      });

      it('orçamento legado (coluna nula) segue o histórico; edição do responsável depois do evento apaga o aviso', async () => {
        const c = await montarRascunhoComItem();
        await new RepositorioDeOrcamentos(c.cenario.proxy).registrarHistorico({
          idOrcamento: c.idOrcamento,
          idOperador: c.idOutro,
          tipoEvento: 'ATUALIZACAO_FOLLOWUP',
          statusAnterior: 'RASCUNHO',
          statusNovo: 'RASCUNHO',
          observacao: null,
        });
        expect((await c.servico.obter(c.idOrcamento)).ultimaAlteracaoDeOutro?.nome).toBe('colega');

        const detalhe = await c.servico.atualizarCabecalho(
          c.idOrcamento,
          { contatoSolicitacao: 'Ana' },
          c.sessaoDono,
        );
        expect(detalhe.ultimaAlteracaoDeOutro).toBeNull();
      });

      it('não grava o editor em orçamento fora de rascunho', async () => {
        const c = await montarRascunhoComItem();
        await new RepositorioDeOrcamentos(c.cenario.proxy).atualizarStatus(
          c.idOrcamento,
          'ALTERACAO_SOLICITADA',
          new Date(),
        );
        await c.servico.atualizarCabecalho(
          c.idOrcamento,
          { contatoSolicitacao: 'Ana' },
          c.sessaoOutro,
        );
        expect(c.cenario.banco.linhas('orcamento')[0]?.id_operador_ultima_edicao).toBeNull();
      });
    });
  });

  describe('cancelar', () => {
    it('cancela o orçamento com a justificativa', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-cancela');
      const idCliente = semearCliente(cenario);
      const sessao = sessaoDoOperador(idOperador, 'quem-cancela');
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessao,
      );

      await servico.cancelar(idOrcamento, 'Cliente desistiu', sessao);

      const [orcamento] = cenario.banco.linhas('orcamento');
      expect(orcamento?.status).toBe('CANCELADO');
      const historico = cenario.banco.linhas('historico_orcamento');
      expect(historico.at(-1)).toMatchObject({
        status_novo: 'CANCELADO',
        observacao: 'Cliente desistiu',
      });
    });
  });
  describe('condição de pagamento automática (UC18)', () => {
    async function montar(opcoes: {
      segundaCompra: boolean;
      precoUnitario: number;
      creditoReprovado?: boolean;
      creditoAprovado?: boolean;
    }) {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-padroniza');
      const sessao = sessaoDoOperador(idOperador, 'quem-padroniza');
      const idCliente = semearCliente(cenario);
      if (opcoes.segundaCompra) semearCompraAnterior(cenario, idCliente, idOperador);
      if (opcoes.creditoReprovado || opcoes.creditoAprovado) {
        cenario.banco.semear('analise_credito', {
          id_cliente: idCliente,
          resultado: opcoes.creditoReprovado ? 'REPROVADO' : 'APROVADO',
          data_solicitacao: '2026-11-01',
        });
      }
      const { idVariacao } = semearVariacao(cenario, { precoUnitario: opcoes.precoUnitario });
      const criado = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessao,
      );
      return { cenario, servico, sessao, idVariacao, idOrcamento: criado.idOrcamento, criado };
    }
    const avulso = (idVariacao: number, quantidade: number) =>
      ({ idVariacao, granularidade: 'AVULSO', quantidade }) as const;
    const frete = { origemTransportadora: 'SUPRIMAX', valorFrete: 2000 } as const;

    it('ao criar, grava 100% adiantado sem aviso (primeira compra)', async () => {
      const { criado } = await montar({ segundaCompra: false, precoUnitario: 60000 });

      expect(criado.condicoes.condicaoPagamento).toBe('ADIANTADO_100');
      expect(criado.condicoes.avisos).toEqual([]);
    });

    it('ao criar, grava 100% adiantado também na segunda compra', async () => {
      const { criado } = await montar({ segundaCompra: true, precoUnitario: 60000 });

      expect(criado.condicoes.condicaoPagamento).toBe('ADIANTADO_100');
    });

    it('crédito reprovado: o padrão é 50% adiantado + 50% após a entrega', async () => {
      const { criado } = await montar({
        segundaCompra: true,
        precoUnitario: 60000,
        creditoReprovado: true,
      });

      expect(criado.condicoes.condicaoPagamento).toBe('ADIANTADO_50_50');
      expect(criado.condicoes.condicoesPagamentoPermitidas).toEqual([
        'ADIANTADO_100',
        'ADIANTADO_50_50',
      ]);
    });

    it('o operador troca entre as permitidas e a escolha é mantida nas edições seguintes', async () => {
      const { servico, sessao, idVariacao, idOrcamento } = await montar({
        segundaCompra: true,
        precoUnitario: 60000,
        creditoReprovado: true,
      });
      await servico.adicionarItem(idOrcamento, avulso(idVariacao, 1), sessao);

      await servico.atualizarCondicoes(
        idOrcamento,
        { condicaoPagamento: 'ADIANTADO_100', ...frete },
        sessao,
      );
      const detalhe = await servico.adicionarItem(idOrcamento, avulso(idVariacao, 1), sessao);

      expect(detalhe.condicoes.condicaoPagamento).toBe('ADIANTADO_100');
      expect(detalhe.condicoes.avisos).toEqual([]);
      expect(detalhe.condicoes.bloqueios.map((b) => b.codigo)).not.toContain(
        'CONDICAO_NAO_PERMITIDA',
      );
    });

    it('segunda compra aceita escolher 50/50 com crédito reprovado', async () => {
      const { servico, sessao, idVariacao, idOrcamento } = await montar({
        segundaCompra: true,
        precoUnitario: 60000,
        creditoReprovado: true,
      });
      await servico.adicionarItem(idOrcamento, avulso(idVariacao, 1), sessao);

      const detalhe = await servico.atualizarCondicoes(
        idOrcamento,
        { condicaoPagamento: 'ADIANTADO_50_50', ...frete },
        sessao,
      );

      expect(detalhe.condicoes.condicaoPagamento).toBe('ADIANTADO_50_50');
      expect(detalhe.condicoes.bloqueios).toEqual([]);
    });

    it('recusa 50/50 quando o crédito não está reprovado', async () => {
      const { servico, sessao, idVariacao, idOrcamento } = await montar({
        segundaCompra: true,
        precoUnitario: 60000,
      });
      await servico.adicionarItem(idOrcamento, avulso(idVariacao, 1), sessao);

      await expect(
        servico.atualizarCondicoes(
          idOrcamento,
          { condicaoPagamento: 'ADIANTADO_50_50', ...frete },
          sessao,
        ),
      ).rejects.toBeInstanceOf(ErroDeValidacao);
    });

    it('valor cai abaixo de R$ 500,00: boleto volta ao padrão, zera o prazo e avisa', async () => {
      // 1 un. a 30000 = 35400 (abaixo do mínimo); 2 un. = 70800 (boleto liberado).
      const { servico, sessao, idVariacao, idOrcamento } = await montar({
        segundaCompra: true,
        precoUnitario: 30000,
      });
      const { itens } = await servico.adicionarItem(idOrcamento, avulso(idVariacao, 2), sessao);
      await servico.atualizarCondicoes(
        idOrcamento,
        { condicaoPagamento: 'BOLETO', prazoDias: 30, ...frete },
        sessao,
      );
      const idItem = (itens[0] as { idItem: number }).idItem;

      const detalhe = await servico.alterarQuantidade(idOrcamento, idItem, 1, sessao);

      expect(detalhe.condicoes.condicaoPagamento).toBe('ADIANTADO_100');
      expect(detalhe.condicoes.prazoDias).toBeNull();
      expect(detalhe.condicoes.numeroParcelas).toBeNull();
      expect(detalhe.condicoes.avisos).toEqual([
        expect.objectContaining({ codigo: 'CONDICAO_TROCADA_AUTOMATICAMENTE' }),
      ]);
      expect(detalhe.condicoes.bloqueios.map((b) => b.codigo)).not.toContain(
        'CONDICAO_NAO_PERMITIDA',
      );
      // Só a resposta da mutação traz o aviso; a leitura seguinte já vem sem ele.
      expect((await servico.obter(idOrcamento)).condicoes.avisos).toEqual([]);
    });

    it('parcelado volta ao padrão quando o total cai abaixo de R$ 1.500,00', async () => {
      // 2 un. a 63560: 127120 + 22882 de imposto = 150002 (parcelado liberado); 1 un. = 75001.
      const { servico, sessao, idVariacao, idOrcamento } = await montar({
        segundaCompra: true,
        precoUnitario: 63560,
        creditoAprovado: true,
      });
      const { itens } = await servico.adicionarItem(idOrcamento, avulso(idVariacao, 2), sessao);
      const comParcelado = await servico.atualizarCondicoes(
        idOrcamento,
        { condicaoPagamento: 'PARCELADO', numeroParcelas: 3, ...frete },
        sessao,
      );
      expect(comParcelado.condicoes.condicaoPagamento).toBe('PARCELADO');
      expect(comParcelado.condicoes.numeroParcelas).toBe(3);

      const detalhe = await servico.alterarQuantidade(
        idOrcamento,
        (itens[0] as { idItem: number }).idItem,
        1,
        sessao,
      );

      expect(detalhe.condicoes.valorTotalItens).toBe(75001);
      expect(detalhe.condicoes.condicaoPagamento).toBe('ADIANTADO_100');
      expect(detalhe.condicoes.numeroParcelas).toBeNull();
      expect(detalhe.condicoes.avisos).toHaveLength(1);
    });

    it('sem origemTransportadora abaixo de R$ 1.500,00 responde validação (400), não erro interno', async () => {
      const { servico, sessao, idVariacao, idOrcamento } = await montar({
        segundaCompra: true,
        precoUnitario: 60000,
      });
      await servico.adicionarItem(idOrcamento, avulso(idVariacao, 1), sessao);

      await expect(
        servico.atualizarCondicoes(idOrcamento, { condicaoPagamento: 'ADIANTADO_100' }, sessao),
      ).rejects.toBeInstanceOf(ErroDeValidacao);
    });

    it('segunda compra grava ADIANTADO_100 só com a origem do frete, sem prazo nem parcelas', async () => {
      const { servico, sessao, idVariacao, idOrcamento } = await montar({
        segundaCompra: true,
        precoUnitario: 60000,
      });
      await servico.adicionarItem(idOrcamento, avulso(idVariacao, 1), sessao);

      const detalhe = await servico.atualizarCondicoes(
        idOrcamento,
        { condicaoPagamento: 'ADIANTADO_100', origemTransportadora: 'SUPRIMAX' },
        sessao,
      );

      expect(detalhe.condicoes.condicaoPagamento).toBe('ADIANTADO_100');
      expect(detalhe.condicoes.prazoDias).toBeNull();
      expect(detalhe.condicoes.modalidadeFrete).toBe('FOB');
    });

    it('acima de R$ 1.500,00 (CIF) o corpo só com a condição é aceito', async () => {
      // 2 un. a 63560 = 150002.
      const { servico, sessao, idVariacao, idOrcamento } = await montar({
        segundaCompra: true,
        precoUnitario: 63560,
      });
      await servico.adicionarItem(idOrcamento, avulso(idVariacao, 2), sessao);

      const detalhe = await servico.atualizarCondicoes(
        idOrcamento,
        { condicaoPagamento: 'ADIANTADO_100' },
        sessao,
      );

      expect(detalhe.condicoes.modalidadeFrete).toBe('CIF');
      expect(detalhe.condicoes.condicaoPagamento).toBe('ADIANTADO_100');
    });

    it('limite inclusivo: exatamente R$ 500,00 mantém o boleto, sem aviso', async () => {
      // 42373 + 7627 de imposto = 50000.
      const { servico, sessao, idVariacao, idOrcamento } = await montar({
        segundaCompra: true,
        precoUnitario: 42373,
      });
      await servico.adicionarItem(idOrcamento, avulso(idVariacao, 1), sessao);
      const comBoleto = await servico.atualizarCondicoes(
        idOrcamento,
        { condicaoPagamento: 'BOLETO', prazoDias: 30, ...frete },
        sessao,
      );
      expect(comBoleto.condicoes.valorTotalItens).toBe(50000);

      const detalhe = await servico.adicionarItem(idOrcamento, avulso(idVariacao, 1), sessao);

      expect(detalhe.condicoes.valorTotalItens).toBe(100000);
      expect(detalhe.condicoes.condicaoPagamento).toBe('BOLETO');
      expect(detalhe.condicoes.avisos).toEqual([]);
    });

    it('escolha explícita fora das permitidas segue como bloqueio, sem troca automática', async () => {
      const { servico, sessao, idVariacao, idOrcamento } = await montar({
        segundaCompra: true,
        precoUnitario: 100000,
      });
      await servico.adicionarItem(idOrcamento, avulso(idVariacao, 1), sessao);

      const detalhe = await servico.atualizarCondicoes(
        idOrcamento,
        { condicaoPagamento: 'PARCELADO', numeroParcelas: 3, origemTransportadora: 'SUPRIMAX' },
        sessao,
      );

      expect(detalhe.condicoes.condicaoPagamento).toBe('PARCELADO');
      expect(detalhe.condicoes.bloqueios.map((b) => b.codigo)).toContain('CONDICAO_NAO_PERMITIDA');
      expect(detalhe.condicoes.avisos).toEqual([]);
    });

    it('GET devolve a condição sugerida (padrão) sem gravar nada', async () => {
      const { servico, idOrcamento, cenario } = await montar({
        segundaCompra: true,
        precoUnitario: 60000,
        creditoReprovado: true,
      });
      // Rascunho anterior à gravação automática: sem condição gravada.
      cenario.banco.executar('dados.atualizar', {
        tabela: 'orcamento',
        valores: { condicao_pagamento: null },
        filtros: { e: [['id_orcamento', '=', idOrcamento]] },
      });

      const detalhe = await servico.obter(idOrcamento);

      expect(detalhe.condicoes.condicaoPagamento).toBeNull();
      expect(detalhe.condicoes.condicaoPagamentoSugerida).toBe('ADIANTADO_50_50');
      expect((await servico.obter(idOrcamento)).condicoes.condicaoPagamento).toBeNull();
    });

    it('a sugerida é ADIANTADO_100 na primeira compra', async () => {
      const { criado } = await montar({ segundaCompra: false, precoUnitario: 60000 });

      expect(criado.condicoes.condicaoPagamentoSugerida).toBe('ADIANTADO_100');
    });

    it('boleto com crédito pendente grava o prazo (o banco exige) e fica PENDENTE_CREDITO', async () => {
      // Sem análise de crédito: resultado pendente. 2 un. a 30000 = 70800 (boleto liberado).
      const { servico, sessao, idVariacao, idOrcamento } = await montar({
        segundaCompra: true,
        precoUnitario: 30000,
      });
      await servico.adicionarItem(idOrcamento, avulso(idVariacao, 2), sessao);

      const detalhe = await servico.atualizarCondicoes(
        idOrcamento,
        { condicaoPagamento: 'BOLETO', prazoDias: 30, ...frete },
        sessao,
      );

      expect(detalhe.status).toBe('PENDENTE_CREDITO');
      expect(detalhe.condicoes.condicaoPagamento).toBe('BOLETO');
      expect(detalhe.condicoes.prazoDias).toBe(30);
    });

    it('parcelado com crédito pendente grava as parcelas', async () => {
      // 2 un. a 63560 = 150002 (parcelado liberado por valor).
      const { servico, sessao, idVariacao, idOrcamento } = await montar({
        segundaCompra: true,
        precoUnitario: 63560,
      });
      await servico.adicionarItem(idOrcamento, avulso(idVariacao, 2), sessao);

      const detalhe = await servico.atualizarCondicoes(
        idOrcamento,
        { condicaoPagamento: 'PARCELADO', numeroParcelas: 3 },
        sessao,
      );

      expect(detalhe.condicoes.condicaoPagamento).toBe('PARCELADO');
      expect(detalhe.condicoes.numeroParcelas).toBe(3);
      expect(detalhe.condicoes.prazoDias).toBeNull();
    });

    it('boleto sem prazo é recusado (400) e não grava a condição', async () => {
      const { servico, sessao, idVariacao, idOrcamento } = await montar({
        segundaCompra: true,
        precoUnitario: 30000,
      });
      await servico.adicionarItem(idOrcamento, avulso(idVariacao, 2), sessao);

      await expect(
        servico.atualizarCondicoes(idOrcamento, { condicaoPagamento: 'BOLETO', ...frete }, sessao),
      ).rejects.toBeInstanceOf(ErroDeValidacao);
      expect((await servico.obter(idOrcamento)).condicoes.condicaoPagamento).not.toBe('BOLETO');
    });

    describe('endereço de entrega único', () => {
      const endereco = (idCliente: number, tipo: string) => ({
        id_cliente: idCliente,
        tipo,
        logradouro: 'Rua A',
        numero: '1',
        bairro: 'Centro',
        cidade: 'Goiânia',
        uf: 'GO',
        cep: '74000000',
      });

      it('com exatamente um endereço de entrega, o orçamento criado já o grava', async () => {
        const cenario = montarCenarioDeCadastros();
        const servico = montarServico(cenario);
        const idOperador = cenario.semearUsuario('OPERADOR', 'quem-entrega');
        const idCliente = semearCliente(cenario);
        cenario.banco.semear('endereco_cliente', endereco(idCliente, 'CADASTRAL'));
        const [entrega] = cenario.banco.semear('endereco_cliente', endereco(idCliente, 'ENTREGA'));

        const criado = await servico.criar(
          { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
          sessaoDoOperador(idOperador, 'quem-entrega'),
        );

        expect(criado.idEnderecoEntrega).toBe(entrega?.id_endereco);
      });

      it('com vários endereços de entrega, deixa em branco', async () => {
        const cenario = montarCenarioDeCadastros();
        const servico = montarServico(cenario);
        const idOperador = cenario.semearUsuario('OPERADOR', 'quem-entrega-2');
        const idCliente = semearCliente(cenario);
        cenario.banco.semear('endereco_cliente', endereco(idCliente, 'ENTREGA'));
        cenario.banco.semear('endereco_cliente', endereco(idCliente, 'ENTREGA'));

        const criado = await servico.criar(
          { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
          sessaoDoOperador(idOperador, 'quem-entrega-2'),
        );

        expect(criado.idEnderecoEntrega).toBeNull();
      });

      describe('rascunho antigo, sem endereço gravado', () => {
        async function rascunhoAntigo(tiposDeEndereco: string[]) {
          const cenario = montarCenarioDeCadastros();
          const servico = montarServico(cenario);
          const idOperador = cenario.semearUsuario('OPERADOR', 'quem-antigo');
          const sessao = sessaoDoOperador(idOperador, 'quem-antigo');
          const idCliente = semearCliente(cenario);
          const { idVariacao } = semearVariacao(cenario, { precoUnitario: 600 });
          // Criado antes de o cliente ter o endereço: nasce sem `id_endereco_entrega`.
          const { idOrcamento } = await servico.criar(
            { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
            sessao,
          );
          const ids = tiposDeEndereco.map(
            (tipo) =>
              cenario.banco.semear('endereco_cliente', endereco(idCliente, tipo))[0]?.id_endereco,
          );
          return { cenario, servico, sessao, idVariacao, idOrcamento, ids };
        }

        it('o GET não grava; a próxima mutação grava o endereço único sem mexer no editor', async () => {
          const { cenario, servico, sessao, idVariacao, idOrcamento, ids } = await rascunhoAntigo([
            'CADASTRAL',
            'ENTREGA',
          ]);

          const lido = await servico.obter(idOrcamento);
          expect(lido.idEnderecoEntrega).toBeNull();
          expect(cenario.banco.linhas('orcamento')[0]?.id_endereco_entrega ?? null).toBeNull();

          const depois = await servico.adicionarItem(
            idOrcamento,
            { idVariacao, granularidade: 'AVULSO', quantidade: 1 },
            sessao,
          );

          expect(depois.idEnderecoEntrega).toBe(ids[1]);
          expect(cenario.banco.linhas('orcamento')[0]?.id_endereco_entrega).toBe(ids[1]);
          // O item grava o editor (edição do operador); o endereço, sozinho, não o faria.
          expect(depois.ultimaAlteracaoDeOutro).toBeNull();
        });

        it('com vários endereços de entrega, não grava nada', async () => {
          const { cenario, servico, sessao, idVariacao, idOrcamento } = await rascunhoAntigo([
            'ENTREGA',
            'ENTREGA',
          ]);

          const depois = await servico.adicionarItem(
            idOrcamento,
            { idVariacao, granularidade: 'AVULSO', quantidade: 1 },
            sessao,
          );

          expect(depois.idEnderecoEntrega).toBeNull();
          expect(cenario.banco.linhas('orcamento')[0]?.id_endereco_entrega ?? null).toBeNull();
        });

        it('não sobrescreve o endereço já escolhido pelo operador', async () => {
          const { cenario, servico, sessao, idVariacao, idOrcamento, ids } = await rascunhoAntigo([
            'ENTREGA',
          ]);
          const [outro] = cenario.banco.semear('endereco_cliente', {
            ...endereco(cenario.banco.linhas('orcamento')[0]?.id_cliente as number, 'CADASTRAL'),
          });
          await servico.atualizarCabecalho(
            idOrcamento,
            { idEnderecoEntrega: outro?.id_endereco as number },
            sessao,
          );

          await servico.adicionarItem(
            idOrcamento,
            { idVariacao, granularidade: 'AVULSO', quantidade: 1 },
            sessao,
          );

          expect(cenario.banco.linhas('orcamento')[0]?.id_endereco_entrega).toBe(
            outro?.id_endereco,
          );
          expect(ids[0]).not.toBe(outro?.id_endereco);
        });
      });
    });

    it('não grava o editor do rascunho ao aplicar o padrão (não é edição do operador)', async () => {
      const { cenario } = await montar({ segundaCompra: false, precoUnitario: 60000 });

      expect(cenario.banco.linhas('orcamento')[0]?.id_operador_ultima_edicao ?? null).toBeNull();
    });

    it('orçamento emitido é imutável: a condição nunca é alterada', async () => {
      const { cenario, servico, sessao, idVariacao, idOrcamento } = await montar({
        segundaCompra: false,
        precoUnitario: 60000,
      });
      const { itens } = await servico.adicionarItem(idOrcamento, avulso(idVariacao, 1), sessao);
      await servico.atualizarCondicoes(
        idOrcamento,
        { condicaoPagamento: 'ADIANTADO_100', ...frete },
        sessao,
      );
      await servico.emitir(idOrcamento, sessao);
      const antes = cenario.proxy.chamadas.length;

      await expect(
        servico.alterarQuantidade(idOrcamento, (itens[0] as { idItem: number }).idItem, 1, sessao),
      ).rejects.toBeInstanceOf(ErroDeOrcamentoNaoEditavel);

      const escritas = cenario.proxy.chamadas
        .slice(antes)
        .filter((chamada) => chamada.operacao === 'dados.atualizar');
      expect(escritas).toEqual([]);
      expect(cenario.banco.linhas('orcamento')[0]?.condicao_pagamento).toBe('ADIANTADO_100');
    });
  });

  describe('obter: chamadas ao proxy (RNF03)', () => {
    const LIMITE_DE_CHAMADAS = 4;

    async function contarChamadasDoDetalhe(quantidadeDeItens: number): Promise<number> {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-conta');
      const sessao = sessaoDoOperador(idOperador, 'quem-conta');
      const idCliente = semearCliente(cenario);
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessao,
      );
      for (let indice = 0; indice < quantidadeDeItens; indice += 1) {
        const { idVariacao } = semearVariacao(cenario);
        await servico.adicionarItem(
          idOrcamento,
          { idVariacao, granularidade: 'AVULSO', quantidade: 10 },
          sessao,
        );
      }
      const antes = cenario.proxy.chamadas.length;
      const detalhe = await servico.obter(idOrcamento);
      expect(detalhe.itens).toHaveLength(quantidadeDeItens);
      return cenario.proxy.chamadas.length - antes;
    }

    it.each([1, 10])('faz no máximo 4 chamadas com %i item(ns)', async (quantidade) => {
      expect(await contarChamadasDoDetalhe(quantidade)).toBeLessThanOrEqual(LIMITE_DE_CHAMADAS);
    });

    it('emitir monta o detalhe uma só vez (historico lido uma vez)', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-emite-conta');
      const sessao = sessaoDoOperador(idOperador, 'quem-emite-conta');
      const idCliente = semearCliente(cenario);
      const { idVariacao } = semearVariacao(cenario, { precoUnitario: 600 });
      const { idOrcamento } = await servico.criar(
        { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
        sessao,
      );
      await servico.adicionarItem(
        idOrcamento,
        { idVariacao, granularidade: 'AVULSO', quantidade: 1 },
        sessao,
      );
      await servico.atualizarCondicoes(
        idOrcamento,
        { condicaoPagamento: 'ADIANTADO_100', origemTransportadora: 'SUPRIMAX', valorFrete: 2000 },
        sessao,
      );
      const antes = cenario.proxy.chamadas.length;

      const detalhe = await servico.emitir(idOrcamento, sessao);

      expect(detalhe.status).toBe('ABERTO');
      const lidas = cenario.proxy.chamadas
        .slice(antes)
        .flatMap((chamada) =>
          chamada.operacao === 'dados.lote'
            ? (chamada.payload.passos as { payload: { tabela: string } }[]).map(
                (passo) => passo.payload.tabela,
              )
            : [(chamada.payload as { tabela?: string }).tabela],
        );
      // O histórico e os anexos só entram no detalhe devolvido, que é montado uma vez.
      expect(lidas.filter((tabela) => tabela === 'anexo_orcamento')).toHaveLength(1);
    });
  });
});
