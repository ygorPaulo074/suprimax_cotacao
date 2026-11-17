// UC10 — testes de ServicoDePedidos contra o banco em memória, sem passar pelas rotas HTTP.
import {
  ErroDePedidoJaAssumido,
  ErroDePedidoNaoAssumidoPorVoce,
  ErroDePedidoNaoEncontrado,
} from '../../erros';
import { criarLogger } from '../../log';
import type { Sessao } from '../auth/sessoes';
import { RepositorioDeClientes } from '../clientes/repositorio';
import { RepositorioDeProdutos } from '../produtos/repositorio';
import { RepositorioDeUsuarios } from '../usuarios/repositorio';
import {
  montarCenarioDeCadastros,
  type CenarioDeCadastros,
} from '../../testing/cenarioDeCadastros';
import { RepositorioDePedidos } from './repositorio';
import { ServicoDePedidos, type MontadorDeOrcamentos } from './servico';

const LOGGER_SILENCIOSO = criarLogger({ nivel: 'silent', destino: { write: () => undefined } });

function sessaoDoOperador(idOperador: number, usuario: string): Sessao {
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
  orcamentos: MontadorDeOrcamentos = { montarAPartirDoPedido: jest.fn() },
): ServicoDePedidos {
  return new ServicoDePedidos({
    pedidos: new RepositorioDePedidos(cenario.proxy),
    clientes: new RepositorioDeClientes(cenario.proxy),
    produtos: new RepositorioDeProdutos(cenario.proxy),
    usuarios: new RepositorioDeUsuarios(cenario.proxy),
    proxy: cenario.proxy,
    orcamentos,
    logger: LOGGER_SILENCIOSO,
  });
}

let contadorDeCnpj = 0;

/** Semeia cliente, vendedor, produto/variação e um pedido com um item, e devolve os ids. */
function semearPedido(
  cenario: CenarioDeCadastros,
  opcoes: { status?: string; idOperadorAtendimento?: number | null } = {},
) {
  contadorDeCnpj += 1;
  const idVendedor = cenario.semearUsuario('VENDEDOR', `vendedor-${contadorDeCnpj}`);
  const [cliente] = cenario.banco.semear('cliente', {
    cnpj: String(11222333000180 + contadorDeCnpj).padStart(14, '0'),
    razao_social: 'Mercado Bom Preço',
    nome_contato: 'João',
    tipo_unidade: 'MATRIZ',
    id_operador_vendedor: idVendedor,
    aceite_lgpd: true,
    data_aceite_lgpd: new Date().toISOString(),
  });
  const [produto] = cenario.banco.semear('produto', {
    codigo_interno: `PROD-${contadorDeCnpj}`,
    descricao: 'Papel Higiênico',
  });
  const [variacao] = cenario.banco.semear('variacao_produto', {
    id_produto: produto?.id_produto,
    marca: 'MarcaX',
    tamanho_embalagem: '30m',
    quantidade_estoque: 100,
  });
  const [pedido] = cenario.banco.semear('pedido', {
    id_cliente: cliente?.id_cliente,
    id_operador_vendedor: idVendedor,
    status: opcoes.status ?? 'SOLICITADO',
    id_operador_atendimento: opcoes.idOperadorAtendimento ?? null,
  });
  cenario.banco.semear('item_pedido', {
    id_pedido: pedido?.id_pedido,
    id_variacao: variacao?.id_variacao,
    granularidade: 'AVULSO',
    id_fardo: null,
    quantidade_solicitada: 10,
  });
  return {
    idPedido: pedido?.id_pedido as number,
    idCliente: cliente?.id_cliente as number,
    idVendedor,
  };
}

describe('ServicoDePedidos', () => {
  describe('listarFila', () => {
    it('lista os pedidos com os indicadores e marca os assumidos por outro operador', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOutroOperador = cenario.semearUsuario('OPERADOR', 'outro-operador');
      const quemConsulta = cenario.semearUsuario('OPERADOR', 'quem-consulta');
      const { idPedido } = semearPedido(cenario, {
        status: 'EM_ANALISE',
        idOperadorAtendimento: idOutroOperador,
      });

      const { itens, indicadores } = await servico.listarFila(
        sessaoDoOperador(quemConsulta, 'quem-consulta'),
      );

      expect(itens).toHaveLength(1);
      expect(itens[0]).toMatchObject({
        idPedido,
        numero: `PED-${String(idPedido).padStart(4, '0')}`,
        cliente: 'Mercado Bom Preço',
        quantidadeItens: 1,
        status: 'EM_ANALISE',
        operadorAtendimento: 'outro-operador',
        assumidoPorOutro: true,
      });
      expect(indicadores).toEqual({
        aguardandoAnalise: 0,
        emAnalise: 1,
        orcamentosEmAberto: 0,
        pendentesCredito: 0,
      });
    });

    it('filtra por status', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const quemConsulta = cenario.semearUsuario('OPERADOR', 'quem-consulta');
      semearPedido(cenario, { status: 'SOLICITADO' });
      semearPedido(cenario, { status: 'NEGADO' });

      const { itens } = await servico.listarFila(
        sessaoDoOperador(quemConsulta, 'quem-consulta'),
        'NEGADO',
      );

      expect(itens).toHaveLength(1);
      expect(itens[0]?.status).toBe('NEGADO');
    });
  });

  describe('obterDetalhe', () => {
    it('traz os itens com o saldo disponível e a situação de crédito do cliente', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const quemConsulta = cenario.semearUsuario('OPERADOR', 'quem-consulta');
      const { idPedido } = semearPedido(cenario);

      const detalhe = await servico.obterDetalhe(
        idPedido,
        sessaoDoOperador(quemConsulta, 'quem-consulta'),
      );

      expect(detalhe.itens).toEqual([
        expect.objectContaining({
          produto: 'Papel Higiênico',
          marca: 'MarcaX',
          embalagem: '30m',
          quantidadeSolicitada: 10,
          saldoDisponivel: 100,
        }),
      ]);
      expect(detalhe.situacaoCliente).toEqual({
        creditoAprovado: null,
        limiteCredito: null,
        dividaEmAberto: 0,
        primeiraCompra: true,
      });
    });

    it('informa o orçamento em RASCUNHO vinculado ao pedido devolvido (o mais recente)', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-consulta');
      const { idPedido } = semearPedido(cenario, { status: 'SOLICITADO' });
      const outroPedido = semearPedido(cenario).idPedido;
      const idCliente = cenario.banco.linhas('pedido')[0]?.id_cliente;
      const semear = (status: string, idDoPedido: number) =>
        cenario.banco.semear('orcamento', {
          id_cliente: idCliente,
          id_operador: idOperador,
          id_pedido: idDoPedido,
          status,
        })[0]?.id_orcamento;
      semear('RASCUNHO', idPedido);
      const maisRecente = semear('RASCUNHO', idPedido);
      semear('CANCELADO', idPedido);
      semear('RASCUNHO', outroPedido);

      const detalhe = await servico.obterDetalhe(idPedido, sessaoDoOperador(idOperador, 'x'));

      expect(detalhe.idOrcamentoRascunho).toBe(maisRecente);
    });

    it('devolve idOrcamentoRascunho nulo quando o pedido não tem rascunho', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-consulta');
      const { idPedido } = semearPedido(cenario);

      const detalhe = await servico.obterDetalhe(idPedido, sessaoDoOperador(idOperador, 'x'));

      expect(detalhe.idOrcamentoRascunho).toBeNull();
    });

    it('rejeita um pedido inexistente', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const quemConsulta = cenario.semearUsuario('OPERADOR', 'quem-consulta');

      await expect(
        servico.obterDetalhe(999, sessaoDoOperador(quemConsulta, 'quem-consulta')),
      ).rejects.toBeInstanceOf(ErroDePedidoNaoEncontrado);
    });
  });

  describe('assumir', () => {
    it('muda o pedido de SOLICITADO para EM_ANALISE', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-assume');
      const { idPedido } = semearPedido(cenario, { status: 'SOLICITADO' });

      const detalhe = await servico.assumir(idPedido, sessaoDoOperador(idOperador, 'quem-assume'));

      expect(detalhe.status).toBe('EM_ANALISE');
      expect(detalhe.operadorAtendimento).toBe('quem-assume');
      expect(detalhe.assumidoPorOutro).toBe(false);
    });

    it('rejeita quando outro operador já assumiu (UC10-E1)', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOutroOperador = cenario.semearUsuario('OPERADOR', 'outro-operador');
      const idQuemTenta = cenario.semearUsuario('OPERADOR', 'quem-tenta');
      const { idPedido } = semearPedido(cenario, {
        status: 'EM_ANALISE',
        idOperadorAtendimento: idOutroOperador,
      });

      await expect(
        servico.assumir(idPedido, sessaoDoOperador(idQuemTenta, 'quem-tenta')),
      ).rejects.toBeInstanceOf(ErroDePedidoJaAssumido);
    });
  });

  describe('negar', () => {
    it('exige que a sessão tenha assumido o pedido', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idQuemTenta = cenario.semearUsuario('OPERADOR', 'quem-tenta');
      const { idPedido } = semearPedido(cenario, { status: 'SOLICITADO' });

      await expect(
        servico.negar(idPedido, 'Fora de linha', sessaoDoOperador(idQuemTenta, 'quem-tenta')),
      ).rejects.toBeInstanceOf(ErroDePedidoNaoAssumidoPorVoce);
    });

    it('nega o pedido assumido pela própria sessão', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-assumiu');
      const { idPedido } = semearPedido(cenario, {
        status: 'EM_ANALISE',
        idOperadorAtendimento: idOperador,
      });

      await servico.negar(idPedido, 'Fora de linha', sessaoDoOperador(idOperador, 'quem-assumiu'));

      const [pedido] = cenario.banco.linhas('pedido');
      expect(pedido?.status).toBe('NEGADO');
      expect(pedido?.motivo_negativa).toBe('Fora de linha');
    });
  });

  describe('devolver (UC10-A3)', () => {
    it('devolve à lista o pedido assumido pela própria sessão e libera o operador', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-assumiu');
      const { idPedido } = semearPedido(cenario, {
        status: 'EM_ANALISE',
        idOperadorAtendimento: idOperador,
      });

      await servico.devolver(idPedido, sessaoDoOperador(idOperador, 'quem-assumiu'));

      const [pedido] = cenario.banco.linhas('pedido');
      expect(pedido?.status).toBe('SOLICITADO');
      expect(pedido?.id_operador_atendimento ?? null).toBeNull();
    });

    it('recusa quando outro operador assumiu o pedido e nada muda', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOutro = cenario.semearUsuario('OPERADOR', 'outro-operador');
      const idQuemTenta = cenario.semearUsuario('OPERADOR', 'quem-tenta');
      const { idPedido } = semearPedido(cenario, {
        status: 'EM_ANALISE',
        idOperadorAtendimento: idOutro,
      });

      await expect(
        servico.devolver(idPedido, sessaoDoOperador(idQuemTenta, 'quem-tenta')),
      ).rejects.toBeInstanceOf(ErroDePedidoNaoAssumidoPorVoce);
      const [pedido] = cenario.banco.linhas('pedido');
      expect(pedido?.status).toBe('EM_ANALISE');
      expect(pedido?.id_operador_atendimento).toBe(idOutro);
    });

    it.each(['SOLICITADO', 'APROVADO', 'NEGADO', 'CANCELADO'] as const)(
      'recusa o pedido que está %s',
      async (status) => {
        const cenario = montarCenarioDeCadastros();
        const servico = montarServico(cenario);
        const idOperador = cenario.semearUsuario('OPERADOR', 'quem-tenta');
        const { idPedido } = semearPedido(cenario, { status });

        await expect(
          servico.devolver(idPedido, sessaoDoOperador(idOperador, 'quem-tenta')),
        ).rejects.toBeInstanceOf(ErroDePedidoNaoAssumidoPorVoce);
        expect(cenario.banco.linhas('pedido')[0]?.status).toBe(status);
      },
    );

    it('deixa o ADMIN devolver o pedido assumido por outro operador', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOutro = cenario.semearUsuario('OPERADOR', 'outro-operador');
      const idAdmin = cenario.semearUsuario('ADMIN', 'adm');
      const { idPedido } = semearPedido(cenario, {
        status: 'EM_ANALISE',
        idOperadorAtendimento: idOutro,
      });

      await servico.devolver(idPedido, { ...sessaoDoOperador(idAdmin, 'adm'), perfil: 'ADMIN' });

      expect(cenario.banco.linhas('pedido')[0]?.status).toBe('SOLICITADO');
    });

    it('rejeita um pedido inexistente', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-tenta');

      await expect(
        servico.devolver(999, sessaoDoOperador(idOperador, 'quem-tenta')),
      ).rejects.toBeInstanceOf(ErroDePedidoNaoEncontrado);
    });

    it('permite assumir de novo o pedido devolvido', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idPrimeiro = cenario.semearUsuario('OPERADOR', 'primeiro');
      const idSegundo = cenario.semearUsuario('OPERADOR', 'segundo');
      const { idPedido } = semearPedido(cenario, { status: 'SOLICITADO' });

      await servico.assumir(idPedido, sessaoDoOperador(idPrimeiro, 'primeiro'));
      await servico.devolver(idPedido, sessaoDoOperador(idPrimeiro, 'primeiro'));
      const detalhe = await servico.assumir(idPedido, sessaoDoOperador(idSegundo, 'segundo'));

      expect(detalhe.operadorAtendimento).toBe('segundo');
    });
  });

  describe('montarOrcamento', () => {
    it('delega ao montador de orçamentos com o pedido e os itens', async () => {
      const cenario = montarCenarioDeCadastros();
      const montarAPartirDoPedido = jest.fn().mockResolvedValue(42);
      const servico = montarServico(cenario, { montarAPartirDoPedido });
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-assumiu');
      const { idPedido } = semearPedido(cenario, {
        status: 'EM_ANALISE',
        idOperadorAtendimento: idOperador,
      });

      const resultado = await servico.montarOrcamento(
        idPedido,
        sessaoDoOperador(idOperador, 'quem-assumiu'),
      );

      expect(resultado).toEqual({ idOrcamento: 42 });
      expect(montarAPartirDoPedido).toHaveBeenCalledTimes(1);
      const [pedidoPassado, itensPassados] = montarAPartirDoPedido.mock.calls[0] as [
        { idPedido: number },
        { quantidadeSolicitada: number }[],
      ];
      expect(pedidoPassado.idPedido).toBe(idPedido);
      expect(itensPassados).toHaveLength(1);
    });

    it('exige que a sessão tenha assumido o pedido', async () => {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const idQuemTenta = cenario.semearUsuario('OPERADOR', 'quem-tenta');
      const { idPedido } = semearPedido(cenario, { status: 'SOLICITADO' });

      await expect(
        servico.montarOrcamento(idPedido, sessaoDoOperador(idQuemTenta, 'quem-tenta')),
      ).rejects.toBeInstanceOf(ErroDePedidoNaoAssumidoPorVoce);
    });
  });
});
