// RNF03 — LeitorEmLote: leituras pedidas juntas viram uma só chamada `dados.lote`.
import { ProxyClienteFalso, type ChamadaAoProxy } from '../testing/proxyClienteFalso';
import { consultar } from './consultas';
import { LeitorEmLote, MAXIMO_DE_PASSOS_DO_LOTE } from './lote';

function programarLote(proxy: ProxyClienteFalso): void {
  proxy.responder('dados.lote', (chamada: ChamadaAoProxy) => ({
    resultados: Object.fromEntries(
      (chamada.payload.passos as { id: string; payload: { tabela: string } }[]).map((passo) => [
        passo.id,
        { ok: true, dados: [{ tabela: passo.payload.tabela }] },
      ]),
    ),
  }));
}

describe('LeitorEmLote', () => {
  it('junta as leituras simultâneas em um só dados.lote e devolve cada resposta ao seu pedido', async () => {
    const proxy = new ProxyClienteFalso();
    programarLote(proxy);
    const leitor = new LeitorEmLote(proxy, 'teste-lote');

    const [a, b, c] = await Promise.all(
      ['a', 'b', 'c'].map((tabela) => consultar(leitor, { tabela }, 'teste')),
    );

    expect(proxy.chamadas).toHaveLength(1);
    expect(proxy.chamadas[0]?.operacao).toBe('dados.lote');
    expect(proxy.chamadas[0]?.operationId).toBe('teste-lote');
    expect([a, b, c]).toEqual([[{ tabela: 'a' }], [{ tabela: 'b' }], [{ tabela: 'c' }]]);
  });

  it('manda uma leitura isolada como dados.consultar comum', async () => {
    const proxy = new ProxyClienteFalso().responder('dados.consultar', { dados: [{ id: 1 }] });
    const leitor = new LeitorEmLote(proxy, 'teste-lote');

    await expect(consultar(leitor, { tabela: 'a' }, 'teste')).resolves.toEqual([{ id: 1 }]);
    expect(proxy.chamadas.map((chamada) => chamada.operacao)).toEqual(['dados.consultar']);
  });

  it('deixa a leitura que depende de outra para a rodada seguinte', async () => {
    const proxy = new ProxyClienteFalso();
    programarLote(proxy);
    const leitor = new LeitorEmLote(proxy, 'teste-lote');

    await Promise.all([
      consultar(leitor, { tabela: 'a' }, 't').then(() => consultar(leitor, { tabela: 'c' }, 't')),
      consultar(leitor, { tabela: 'b' }, 't').then(() => consultar(leitor, { tabela: 'd' }, 't')),
    ]);

    expect(proxy.chamadas).toHaveLength(2);
  });

  it('divide em mais de um lote quando passa do máximo de passos', async () => {
    const proxy = new ProxyClienteFalso();
    programarLote(proxy);
    const leitor = new LeitorEmLote(proxy, 'teste-lote');

    await Promise.all(
      Array.from({ length: MAXIMO_DE_PASSOS_DO_LOTE + 1 }, (_, i) =>
        consultar(leitor, { tabela: `t${i}` }, 'teste'),
      ),
    );

    // O 21º passo vai em um segundo lote: um grupo de leituras nunca passa de 20 passos.
    expect(proxy.chamadas).toHaveLength(2);
  });

  it('repassa a falha do lote a todas as leituras da rodada', async () => {
    const proxy = new ProxyClienteFalso().responder('dados.lote', new Error('falhou'));
    const leitor = new LeitorEmLote(proxy, 'teste-lote');

    const resultados = await Promise.allSettled([
      consultar(leitor, { tabela: 'a' }, 't'),
      consultar(leitor, { tabela: 'b' }, 't'),
    ]);

    expect(resultados.map((resultado) => resultado.status)).toEqual(['rejected', 'rejected']);
  });

  it('não agrupa operações que não são leituras', async () => {
    const proxy = new ProxyClienteFalso().responder('dados.inserir', { dados: [] });
    const leitor = new LeitorEmLote(proxy, 'teste-lote');

    await leitor.executar('dados.inserir', { tabela: 'a', valores: {} }, 'teste');

    expect(proxy.chamadas.map((chamada) => chamada.operacao)).toEqual(['dados.inserir']);
  });
});
