// UC01, RNF03 — listagem paginada de orçamentos (repositório, serviço e rota) contra o banco em memória.
import request from 'supertest';
import { criarLogger } from '../../log';
import { CONFIG_DE_TESTE } from '../../testing/appDeTeste';
import {
  montarCenarioDeCadastros,
  type CenarioDeCadastros,
} from '../../testing/cenarioDeCadastros';
import { RepositorioDeClientes } from '../clientes/repositorio';
import { RepositorioDeProdutos } from '../produtos/repositorio';
import { RepositorioDeUsuarios } from '../usuarios/repositorio';
import { RepositorioDeOrcamentos } from './repositorio';
import { ServicoDeOrcamentos } from './servico';

const LOGGER_SILENCIOSO = criarLogger({ nivel: 'silent', destino: { write: () => undefined } });
let contador = 0;

function montarServico(cenario: CenarioDeCadastros): ServicoDeOrcamentos {
  return new ServicoDeOrcamentos({
    orcamentos: new RepositorioDeOrcamentos(cenario.proxy),
    clientes: new RepositorioDeClientes(cenario.proxy),
    produtos: new RepositorioDeProdutos(cenario.proxy),
    usuarios: new RepositorioDeUsuarios(cenario.proxy),
    proxy: cenario.proxy,
    armazenamento: cenario.armazenamento,
    logger: LOGGER_SILENCIOSO,
    empresaEmissora: CONFIG_DE_TESTE.empresaEmissora,
  });
}

function semearCliente(cenario: CenarioDeCadastros, razaoSocial: string): number {
  contador += 1;
  const idVendedor = cenario.semearUsuario('VENDEDOR', `vendedor-pag-${contador}`);
  const [cliente] = cenario.banco.semear('cliente', {
    cnpj: String(50000000000000 + contador).padStart(14, '0'),
    razao_social: razaoSocial,
    nome_contato: 'Contato',
    tipo_unidade: 'MATRIZ',
    id_operador_vendedor: idVendedor,
    aceite_lgpd: true,
    data_aceite_lgpd: new Date().toISOString(),
  });
  return cliente?.id_cliente as number;
}

function semearOrcamento(
  cenario: CenarioDeCadastros,
  idCliente: number,
  idOperador: number,
  extra: Record<string, unknown> = {},
): number {
  const [orcamento] = cenario.banco.semear('orcamento', {
    id_cliente: idCliente,
    id_operador: idOperador,
    ...extra,
  });
  return orcamento?.id_orcamento as number;
}

describe('listagem paginada de orçamentos', () => {
  it('pagina em ordem de id decrescente, com temMais e proximo', async () => {
    const cenario = montarCenarioDeCadastros();
    const servico = montarServico(cenario);
    const operador = cenario.semearUsuario('OPERADOR', 'op');
    const cliente = semearCliente(cenario, 'Alfa');
    const ids = [1, 2, 3, 4, 5].map(() => semearOrcamento(cenario, cliente, operador));

    const primeira = await servico.listarPagina({}, { limite: 2 });
    expect(primeira.itens.map((o) => o.idOrcamento)).toEqual([ids[4], ids[3]]);
    expect(primeira.temMais).toBe(true);
    expect(primeira.proximo).toBe(ids[3]);
    expect(primeira.itens[0]?.cliente).toBe('Alfa');

    const segunda = await servico.listarPagina({}, { limite: 2, depois: primeira.proximo ?? 0 });
    expect(segunda.itens.map((o) => o.idOrcamento)).toEqual([ids[2], ids[1]]);
    expect(segunda.proximo).toBe(ids[1]);

    const ultima = await servico.listarPagina({}, { limite: 2, depois: segunda.proximo ?? 0 });
    expect(ultima.itens.map((o) => o.idOrcamento)).toEqual([ids[0]]);
    expect(ultima.temMais).toBe(false);
    expect(ultima.proximo).toBeNull();
  });

  it('página exatamente cheia no fim não tem mais', async () => {
    const cenario = montarCenarioDeCadastros();
    const servico = montarServico(cenario);
    const operador = cenario.semearUsuario('OPERADOR', 'op');
    const cliente = semearCliente(cenario, 'Alfa');
    semearOrcamento(cenario, cliente, operador);
    semearOrcamento(cenario, cliente, operador);

    const pagina = await servico.listarPagina({}, { limite: 2 });
    expect(pagina.itens).toHaveLength(2);
    expect(pagina.temMais).toBe(false);
    expect(pagina.proximo).toBeNull();
  });

  it('aplica status, cliente, cnpj e número no banco', async () => {
    const cenario = montarCenarioDeCadastros();
    const servico = montarServico(cenario);
    const operador = cenario.semearUsuario('OPERADOR', 'op');
    const alfa = semearCliente(cenario, 'Mercado Alfa');
    const cnpjAlfa = String(50000000000000 + contador).padStart(14, '0');
    const beta = semearCliente(cenario, 'Padaria Beta');
    const a = semearOrcamento(cenario, alfa, operador, { status: 'ABERTO', numero_orcamento: 17 });
    const b = semearOrcamento(cenario, beta, operador, { status: 'ABERTO', numero_orcamento: 18 });
    semearOrcamento(cenario, alfa, operador, { status: 'RASCUNHO' });

    const ids = async (filtro: Parameters<ServicoDeOrcamentos['listarPagina']>[0]) =>
      (await servico.listarPagina(filtro, { limite: 10 })).itens.map((o) => o.idOrcamento);

    expect(await ids({ status: 'ABERTO' })).toEqual([b, a]);
    expect(await ids({ cliente: 'mercado' })).toHaveLength(2);
    expect(await ids({ cliente: 'padaria', status: 'ABERTO' })).toEqual([b]);
    expect(await ids({ cnpj: cnpjAlfa })).toHaveLength(2);
    expect(await ids({ cnpj: cnpjAlfa })).toContain(a);
    expect(await ids({ numero: '17' })).toEqual([a]);
    expect(await ids({ numero: '017' })).toEqual([]);
    expect(await ids({ numero: 'abc' })).toEqual([]);
    expect(await ids({ cliente: 'inexistente' })).toEqual([]);
  });

  it('faz um número fixo de leituras ao proxy, qualquer que seja o tamanho da página', async () => {
    const cenario = montarCenarioDeCadastros();
    const servico = montarServico(cenario);
    const operador = cenario.semearUsuario('OPERADOR', 'op');
    for (let n = 1; n <= 6; n += 1) {
      semearOrcamento(cenario, semearCliente(cenario, `Cliente ${n}`), operador);
    }

    const inicio = cenario.proxy.chamadas.length;
    await servico.listarPagina({}, { limite: 2 });
    const comDois = cenario.proxy.chamadas.length - inicio;
    const inicio2 = cenario.proxy.chamadas.length;
    await servico.listarPagina({}, { limite: 6 });
    const comSeis = cenario.proxy.chamadas.length - inicio2;

    expect(comDois).toBe(2);
    expect(comSeis).toBe(2);
  });

  describe('filtro de período (de, ate)', () => {
    async function montarComEmissoes() {
      const cenario = montarCenarioDeCadastros();
      const servico = montarServico(cenario);
      const operador = cenario.semearUsuario('OPERADOR', 'op');
      const cliente = semearCliente(cenario, 'Alfa');
      const emitir = (data: string | null) =>
        semearOrcamento(cenario, cliente, operador, {
          data_emissao: data,
          ...(data && { status: 'ABERTO', numero_orcamento: (contador += 1) }),
        });
      const rascunho = emitir(null);
      const dia10 = emitir('2026-11-10');
      const dia15 = emitir('2026-11-15');
      const dia20 = emitir('2026-11-20');
      return { cenario, servico, rascunho, dia10, dia15, dia20 };
    }

    it('inclui os dois extremos na listagem paginada', async () => {
      const { servico, dia10, dia15, dia20 } = await montarComEmissoes();
      const ids = async (de?: string, ate?: string) =>
        (
          await servico.listarPagina({ ...(de && { de }), ...(ate && { ate }) }, { limite: 10 })
        ).itens.map((o) => o.idOrcamento);

      expect(await ids('2026-11-10', '2026-11-20')).toEqual([dia20, dia15, dia10]);
      expect(await ids('2026-11-11', '2026-11-19')).toEqual([dia15]);
      expect(await ids('2026-11-15')).toEqual([dia20, dia15]);
      expect(await ids(undefined, '2026-11-15')).toEqual([dia15, dia10]);
      expect(await ids('2026-11-21')).toEqual([]);
    });

    it('aplica o mesmo filtro na lista antiga e deixa os rascunhos de fora', async () => {
      const { servico, rascunho, dia10, dia15 } = await montarComEmissoes();

      const comPeriodo = await servico.listar({ de: '2026-11-10', ate: '2026-11-15' });
      expect(comPeriodo.map((o) => o.idOrcamento)).toEqual([dia15, dia10]);
      const semPeriodo = await servico.listar({});
      expect(semPeriodo.map((o) => o.idOrcamento)).toContain(rascunho);
    });

    it('GET /orcamentos rejeita datas inválidas com 400 e aceita as válidas', async () => {
      const cenario = montarCenarioDeCadastros();
      const operador = await cenario.entrarComo('OPERADOR');
      const chamar = (consulta: string) =>
        request(cenario.app)
          .get(`/orcamentos?${consulta}`)
          .set('Authorization', operador.autorizacao);

      for (const consulta of ['de=2026-02-31', 'ate=ontem', 'de=10/11/2026', 'ate=2026-13-01']) {
        expect((await chamar(consulta)).status).toBe(400);
      }
      expect((await chamar('de=2026-11-01&ate=2026-11-30')).status).toBe(200);
      expect((await chamar('de=2026-11-01&limite=5')).status).toBe(200);
    });
  });

  describe('GET /orcamentos', () => {
    it('sem limite nem depois devolve o formato antigo (lista)', async () => {
      const cenario = montarCenarioDeCadastros();
      const operador = await cenario.entrarComo('OPERADOR');
      semearOrcamento(cenario, semearCliente(cenario, 'Alfa'), operador.idOperador);

      const resposta = await request(cenario.app)
        .get('/orcamentos')
        .set('Authorization', operador.autorizacao);

      expect(resposta.status).toBe(200);
      expect(Array.isArray(resposta.body)).toBe(true);
      expect(resposta.body).toHaveLength(1);
    });

    it('com limite devolve {itens, temMais, proximo}', async () => {
      const cenario = montarCenarioDeCadastros();
      const operador = await cenario.entrarComo('OPERADOR');
      const cliente = semearCliente(cenario, 'Alfa');
      semearOrcamento(cenario, cliente, operador.idOperador);
      const ultimo = semearOrcamento(cenario, cliente, operador.idOperador);

      const resposta = await request(cenario.app)
        .get('/orcamentos?limite=1')
        .set('Authorization', operador.autorizacao);

      expect(resposta.status).toBe(200);
      expect(resposta.body).toMatchObject({ temMais: true, proximo: ultimo });
      expect(resposta.body.itens).toHaveLength(1);
    });

    it.each(['limite=0', 'limite=201', 'limite=abc', 'depois=0', 'depois=x'])(
      'rejeita %s com 400',
      async (consulta) => {
        const cenario = montarCenarioDeCadastros();
        const operador = await cenario.entrarComo('OPERADOR');

        const resposta = await request(cenario.app)
          .get(`/orcamentos?${consulta}`)
          .set('Authorization', operador.autorizacao);

        expect(resposta.status).toBe(400);
      },
    );
  });
});
