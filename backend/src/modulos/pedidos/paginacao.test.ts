// UC10, RNF03 — fila de pedidos paginada (serviço e rota) contra o banco em memória.
import request from 'supertest';
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
import { ServicoDePedidos } from './servico';

const LOGGER_SILENCIOSO = criarLogger({ nivel: 'silent', destino: { write: () => undefined } });
let contador = 0;

function montarServico(cenario: CenarioDeCadastros): ServicoDePedidos {
  return new ServicoDePedidos({
    pedidos: new RepositorioDePedidos(cenario.proxy),
    clientes: new RepositorioDeClientes(cenario.proxy),
    produtos: new RepositorioDeProdutos(cenario.proxy),
    usuarios: new RepositorioDeUsuarios(cenario.proxy),
    proxy: cenario.proxy,
    orcamentos: { montarAPartirDoPedido: jest.fn() },
    logger: LOGGER_SILENCIOSO,
  });
}

function sessao(idOperador: number): Sessao {
  return {
    idOperador,
    usuario: 'op',
    nome: 'op',
    email: 'op@suprimax.com.br',
    perfil: 'OPERADOR',
  };
}

/** Semeia um pedido com `itens` itens (cliente e vendedor próprios) e devolve o id. */
function semearPedido(cenario: CenarioDeCadastros, status = 'SOLICITADO', itens = 1): number {
  contador += 1;
  const idVendedor = cenario.semearUsuario('VENDEDOR', `vendedor-ped-${contador}`);
  const [cliente] = cenario.banco.semear('cliente', {
    cnpj: String(60000000000000 + contador).padStart(14, '0'),
    razao_social: `Cliente ${contador}`,
    nome_contato: 'Contato',
    tipo_unidade: 'MATRIZ',
    id_operador_vendedor: idVendedor,
    aceite_lgpd: true,
    data_aceite_lgpd: new Date().toISOString(),
  });
  const [produto] = cenario.banco.semear('produto', {
    codigo_interno: `PROD-PED-${contador}`,
    descricao: 'Papel',
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
    status,
  });
  for (let n = 0; n < itens; n += 1) {
    cenario.banco.semear('item_pedido', {
      id_pedido: pedido?.id_pedido,
      id_variacao: variacao?.id_variacao,
      granularidade: 'AVULSO',
      id_fardo: null,
      quantidade_solicitada: 10,
    });
  }
  return pedido?.id_pedido as number;
}

describe('fila de pedidos paginada', () => {
  it('pagina em ordem de id decrescente, com indicadores, temMais e proximo', async () => {
    const cenario = montarCenarioDeCadastros();
    const servico = montarServico(cenario);
    const quem = cenario.semearUsuario('OPERADOR', 'quem');
    const ids = [1, 2, 3, 4, 5].map(() => semearPedido(cenario));

    const primeira = await servico.listarFilaPaginada(sessao(quem), undefined, { limite: 2 });
    expect(primeira.itens.map((p) => p.idPedido)).toEqual([ids[4], ids[3]]);
    expect(primeira.temMais).toBe(true);
    expect(primeira.proximo).toBe(ids[3]);
    expect(primeira.indicadores.aguardandoAnalise).toBe(5);
    expect(primeira.itens[0]).toMatchObject({ quantidadeItens: 1 });

    const segunda = await servico.listarFilaPaginada(sessao(quem), undefined, {
      limite: 2,
      depois: primeira.proximo ?? 0,
    });
    expect(segunda.itens.map((p) => p.idPedido)).toEqual([ids[2], ids[1]]);

    const ultima = await servico.listarFilaPaginada(sessao(quem), undefined, {
      limite: 2,
      depois: segunda.proximo ?? 0,
    });
    expect(ultima.itens.map((p) => p.idPedido)).toEqual([ids[0]]);
    expect(ultima.temMais).toBe(false);
    expect(ultima.proximo).toBeNull();
  });

  it('filtra por status e conta os itens de cada pedido', async () => {
    const cenario = montarCenarioDeCadastros();
    const servico = montarServico(cenario);
    const quem = cenario.semearUsuario('OPERADOR', 'quem');
    semearPedido(cenario, 'NEGADO');
    const solicitado = semearPedido(cenario, 'SOLICITADO', 3);

    const { itens } = await servico.listarFilaPaginada(sessao(quem), 'SOLICITADO', { limite: 10 });

    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ idPedido: solicitado, quantidadeItens: 3 });
  });

  it('faz um número fixo de leituras ao proxy, qualquer que seja o tamanho da página', async () => {
    const cenario = montarCenarioDeCadastros();
    const servico = montarServico(cenario);
    const quem = cenario.semearUsuario('OPERADOR', 'quem');
    for (let n = 0; n < 6; n += 1) {
      semearPedido(cenario);
    }

    const inicio = cenario.proxy.chamadas.length;
    await servico.listarFilaPaginada(sessao(quem), undefined, { limite: 2 });
    const comDois = cenario.proxy.chamadas.length - inicio;
    const inicio2 = cenario.proxy.chamadas.length;
    await servico.listarFilaPaginada(sessao(quem), undefined, { limite: 6 });
    const comSeis = cenario.proxy.chamadas.length - inicio2;

    expect(comSeis).toBe(comDois);
  });

  describe('GET /pedidos', () => {
    it('sem limite nem depois devolve o formato antigo (sem temMais)', async () => {
      const cenario = montarCenarioDeCadastros();
      const operador = await cenario.entrarComo('OPERADOR');
      semearPedido(cenario);

      const resposta = await request(cenario.app)
        .get('/pedidos')
        .set('Authorization', operador.autorizacao);

      expect(resposta.status).toBe(200);
      expect(resposta.body.itens).toHaveLength(1);
      expect(resposta.body).not.toHaveProperty('temMais');
      expect(resposta.body).not.toHaveProperty('proximo');
    });

    it('com limite devolve temMais e proximo', async () => {
      const cenario = montarCenarioDeCadastros();
      const operador = await cenario.entrarComo('OPERADOR');
      semearPedido(cenario);
      const ultimo = semearPedido(cenario);

      const resposta = await request(cenario.app)
        .get('/pedidos?limite=1')
        .set('Authorization', operador.autorizacao);

      expect(resposta.status).toBe(200);
      expect(resposta.body).toMatchObject({ temMais: true, proximo: ultimo });
      expect(resposta.body.itens).toHaveLength(1);
      expect(resposta.body.indicadores).toBeDefined();
    });

    it.each(['limite=0', 'limite=201', 'limite=abc', 'depois=0', 'depois=x'])(
      'rejeita %s com 400',
      async (consulta) => {
        const cenario = montarCenarioDeCadastros();
        const operador = await cenario.entrarComo('OPERADOR');

        const resposta = await request(cenario.app)
          .get(`/pedidos?${consulta}`)
          .set('Authorization', operador.autorizacao);

        expect(resposta.status).toBe(400);
      },
    );
  });
});
