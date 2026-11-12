// UC01, UC14-19 — testes de ServicoDeOrcamentos contra o banco em memória, sem passar pelas
// rotas HTTP.
import {
  ErroDeEmissaoBloqueada,
  ErroDeEstoqueIndisponivel,
  ErroDeItemNaoEncontrado,
  ErroDeOrcamentoNaoEditavel,
  ErroDeOrcamentoNaoEncontrado,
} from '../../erros';
import { criarLogger } from '../../log';
import {
  montarCenarioDeCadastros,
  type CenarioDeCadastros,
} from '../../testing/cenarioDeCadastros';
import type { Sessao } from '../auth/sessoes';
import { RepositorioDeClientes } from '../clientes/repositorio';
import { RepositorioDeProdutos } from '../produtos/repositorio';
import { RepositorioDeUsuarios } from '../usuarios/repositorio';
import { RepositorioDeOrcamentos } from './repositorio';
import { ServicoDeOrcamentos } from './servico';

const LOGGER_SILENCIOSO = criarLogger({ nivel: 'silent', destino: { write: () => undefined } });
let contador = 0;

function sessaoDoOperador(idOperador: number, usuario = 'operador'): Sessao {
  return {
    idOperador,
    usuario,
    nome: usuario,
    email: `${usuario}@suprimax.com.br`,
    perfil: 'OPERADOR',
  };
}

function montarServico(cenario: CenarioDeCadastros): ServicoDeOrcamentos {
  return new ServicoDeOrcamentos({
    orcamentos: new RepositorioDeOrcamentos(cenario.proxy),
    clientes: new RepositorioDeClientes(cenario.proxy),
    produtos: new RepositorioDeProdutos(cenario.proxy),
    usuarios: new RepositorioDeUsuarios(cenario.proxy),
    proxy: cenario.proxy,
    logger: LOGGER_SILENCIOSO,
  });
}

/** Semeia um cliente (ativo, sem dívida) e devolve o id; `primeiraCompra` controla o histórico. */
function semearCliente(cenario: CenarioDeCadastros): number {
  contador += 1;
  const idVendedor = cenario.semearUsuario('VENDEDOR', `vendedor-${contador}`);
  const [cliente] = cenario.banco.semear('cliente', {
    cnpj: String(20000000000000 + contador).padStart(14, '0'),
    razao_social: `Cliente ${contador}`,
    nome_contato: 'Contato',
    tipo_unidade: 'MATRIZ',
    id_operador_vendedor: idVendedor,
    aceite_lgpd: true,
    data_aceite_lgpd: new Date().toISOString(),
  });
  return cliente?.id_cliente as number;
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
      ]);
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
      expect(detalhe.condicoes.bloqueios).toEqual([]);
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

      const emitido = await servico.emitir(idOrcamento, sessao);

      expect(emitido.status).toBe('ABERTO');
      expect(emitido.numeroOrcamento).not.toBeNull();
      expect(emitido.chaveSeguranca).not.toBeNull();
      expect(emitido.dataValidade).not.toBeNull();

      const [reserva] = cenario.banco.linhas('reserva_estoque');
      expect(reserva?.quantidade_reservada).toBe(300);
      expect(reserva?.status).toBe('CONFIRMADA');
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
});
