// RF17 — teste de rota do resumo de indicadores de BI (UC09), pela aplicação real montada em
// `app.ts`. Os orçamentos são semeados direto no banco, em todos os status e datas relevantes: o
// que importa aqui é a agregação, não o fluxo que leva o orçamento a cada status.
import request from 'supertest';
import { montarCenarioDeCadastros } from '../../testing/cenarioDeCadastros';

const AGORA_DO_TESTE = new Date('2026-03-15T10:00:00.000Z');

async function montarCenario() {
  const cenario = montarCenarioDeCadastros({ agora: () => AGORA_DO_TESTE });
  const gestor = await cenario.entrarComo('GESTOR');
  const idVendedor = cenario.semearUsuario('VENDEDOR', 'vera-indicadores');
  const [cliente] = cenario.banco.semear('cliente', {
    cnpj: '33444555000166',
    razao_social: 'Cliente Indicadores',
    nome_contato: 'Ana',
    tipo_unidade: 'MATRIZ',
    id_operador_vendedor: idVendedor,
    aceite_lgpd: true,
    data_aceite_lgpd: new Date().toISOString(),
  });
  const idCliente = cliente?.id_cliente as number;
  const idOperador = gestor.idOperador;

  const semearOrcamento = (dados: Record<string, unknown>): number => {
    const [linha] = cenario.banco.semear('orcamento', {
      id_cliente: idCliente,
      id_operador: idOperador,
      ...dados,
    });
    return linha?.id_orcamento as number;
  };

  // `valor_total_aceito` fica em `resposta_orcamento` (gravado só no ramo de aceite de
  // `resposta.processar`, docs/13 seção 13.7.17), não em `orcamento`.
  const semearRespostaAceita = (idOrcamento: number, dataProcessamento: string, valor: string) =>
    cenario.banco.semear('resposta_orcamento', {
      id_orcamento: idOrcamento,
      tipo_resposta: 'ITENS',
      status_resposta: 'CONSOLIDADA',
      id_operador_vendedor: idVendedor,
      data_resposta: dataProcessamento,
      data_processamento: dataProcessamento,
      valor_total_aceito: valor,
    });

  // Em aberto (qualquer um dos status "ainda não encerrados").
  semearOrcamento({ status: 'RASCUNHO' });
  semearOrcamento({ status: 'ABERTO' });
  semearOrcamento({ status: 'ALTERACAO_SOLICITADA' });

  // Aceito hoje: conta como fechado hoje e entra no faturamento do dia e do mês.
  const idAceitoHoje = semearOrcamento({
    status: 'ACEITO',
    data_encerramento: '2026-03-15T08:00:00.000Z',
  });
  semearRespostaAceita(idAceitoHoje, '2026-03-15T08:00:00.000Z', '500.00');
  // Aceito ontem (mesmo mês): só entra no faturamento do mês.
  const idAceitoOntem = semearOrcamento({
    status: 'ACEITO',
    data_encerramento: '2026-03-14T08:00:00.000Z',
  });
  semearRespostaAceita(idAceitoOntem, '2026-03-14T08:00:00.000Z', '300.00');
  // Aceito no mês anterior: não entra em nenhum dos dois.
  const idAceitoMesPassado = semearOrcamento({
    status: 'ACEITO',
    data_encerramento: '2026-02-20T08:00:00.000Z',
  });
  semearRespostaAceita(idAceitoMesPassado, '2026-02-20T08:00:00.000Z', '900.00');

  // Recusado hoje: conta como recusado hoje.
  semearOrcamento({ status: 'RECUSADO', data_encerramento: '2026-03-15T09:00:00.000Z' });
  // Recusado ontem: não conta no resumo de hoje.
  semearOrcamento({ status: 'RECUSADO', data_encerramento: '2026-03-14T09:00:00.000Z' });

  // Encerrado por outro motivo: nunca entra no resumo (nem em aberto, nem fechado, nem recusado).
  semearOrcamento({ status: 'CANCELADO', data_encerramento: '2026-03-15T09:30:00.000Z' });

  return { ...cenario, cabecalhoGestor: { Authorization: gestor.autorizacao } };
}

describe('GET /indicadores (RF17)', () => {
  it('resume orçamentos em aberto, fechados e recusados no dia, e o faturamento do dia e do mês', async () => {
    const { app, cabecalhoGestor } = await montarCenario();

    const resposta = await request(app).get('/indicadores').set(cabecalhoGestor);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      orcamentosEmAberto: 3,
      orcamentosFechadosNoDia: 1,
      orcamentosRecusadosNoDia: 1,
      faturamentoNoDia: 50000,
      faturamentoNoMes: 80000,
    });
  });

  it('responde 403 para quem não é gestor', async () => {
    const cenario = montarCenarioDeCadastros({ agora: () => AGORA_DO_TESTE });
    const operador = await cenario.entrarComo('OPERADOR');

    const resposta = await request(cenario.app)
      .get('/indicadores')
      .set('Authorization', operador.autorizacao);

    expect(resposta.status).toBe(403);
  });

  it('devolve zeros quando não há nenhum orçamento', async () => {
    const cenario = montarCenarioDeCadastros({ agora: () => AGORA_DO_TESTE });
    const gestor = await cenario.entrarComo('GESTOR');

    const resposta = await request(cenario.app)
      .get('/indicadores')
      .set('Authorization', gestor.autorizacao);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      orcamentosEmAberto: 0,
      orcamentosFechadosNoDia: 0,
      orcamentosRecusadosNoDia: 0,
      faturamentoNoDia: 0,
      faturamentoNoMes: 0,
    });
  });
});
