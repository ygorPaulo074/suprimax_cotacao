// Item 9 do backend/TAREFAS.md — testes de ServicoDeJobsAgendados contra o banco em memória, um
// job por vez e depois os cinco juntos (`executarTodos`). Datas relativas a `AGORA_DO_TESTE`,
// para os limites de 29/30/31 e 59/60/61 dias ficarem exatos.
import { criarLogger } from '../../log';
import {
  montarCenarioDeCadastros,
  type CenarioDeCadastros,
} from '../../testing/cenarioDeCadastros';
import { RepositorioDeJobs } from './repositorio';
import {
  DIAS_DE_ATRASO_PARA_PROTESTO,
  DIAS_PARA_APAGAR_RASCUNHO_EXPIRADO,
  DIAS_PARA_EXPIRAR_RASCUNHO,
  ServicoDeJobsAgendados,
} from './servico';

const LOGGER_SILENCIOSO = criarLogger({ nivel: 'silent', destino: { write: () => undefined } });
const AGORA_DO_TESTE = new Date('2026-04-15T12:00:00.000Z');
const MILISSEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

let contador = 0;

/** `AGORA_DO_TESTE` menos `dias` dias corridos, como timestamp ISO. */
function isoHaDias(dias: number): string {
  return new Date(AGORA_DO_TESTE.getTime() - dias * MILISSEGUNDOS_POR_DIA).toISOString();
}

/** A mesma conta, só a parte de data (para colunas DATE). */
function dataHaDias(dias: number): string {
  return isoHaDias(dias).slice(0, 10);
}

function montarServico(cenario: CenarioDeCadastros): ServicoDeJobsAgendados {
  return new ServicoDeJobsAgendados({
    jobs: new RepositorioDeJobs(cenario.proxy),
    logger: LOGGER_SILENCIOSO,
    agora: () => AGORA_DO_TESTE,
  });
}

function semearCliente(cenario: CenarioDeCadastros): { idCliente: number; idOperador: number } {
  contador += 1;
  const idOperador = cenario.semearUsuario('OPERADOR', `operador-jobs-${contador}`);
  const [cliente] = cenario.banco.semear('cliente', {
    cnpj: String(40000000000000 + contador).padStart(14, '0'),
    razao_social: `Cliente Jobs ${contador}`,
    nome_contato: 'Contato',
    tipo_unidade: 'MATRIZ',
    id_operador_vendedor: idOperador,
    aceite_lgpd: true,
    data_aceite_lgpd: new Date().toISOString(),
  });
  return { idCliente: cliente?.id_cliente as number, idOperador };
}

function semearOrcamento(
  cenario: CenarioDeCadastros,
  idCliente: number,
  idOperador: number,
  dados: Record<string, unknown>,
): number {
  const [linha] = cenario.banco.semear('orcamento', {
    id_cliente: idCliente,
    id_operador: idOperador,
    ...dados,
  });
  return linha?.id_orcamento as number;
}

/** Variação de produto com saldo qualquer, só para pendurar um item de orçamento. */
function semearVariacao(cenario: CenarioDeCadastros): number {
  contador += 1;
  const [produto] = cenario.banco.semear('produto', {
    codigo_interno: `PROD-JOBS-${contador}`,
    descricao: `Produto Jobs ${contador}`,
  });
  const [variacao] = cenario.banco.semear('variacao_produto', {
    id_produto: produto?.id_produto,
    marca: 'MarcaJobs',
    tamanho_embalagem: '1kg',
    quantidade_estoque: 100,
  });
  return variacao?.id_variacao as number;
}

function semearItemAvulso(cenario: CenarioDeCadastros, idOrcamento: number): number {
  const idVariacao = semearVariacao(cenario);
  const [item] = cenario.banco.semear('item_orcamento', {
    id_orcamento: idOrcamento,
    id_variacao: idVariacao,
    granularidade: 'AVULSO',
    quantidade_avulsa: 1,
    preco_unitario_aplicado: '10.00',
    valor_imposto: '1.80',
    valor_total_item: '11.80',
    aprovacao_herdada: false,
  });
  return item?.id_item as number;
}

describe('ServicoDeJobsAgendados (item 9)', () => {
  describe('expirarRascunhosEPendentesDeCredito (job 1, RN25)', () => {
    it('expira só quem está sem edição há 30 dias ou mais, nunca quem foi editado há menos', async () => {
      const cenario = montarCenarioDeCadastros({ agora: () => AGORA_DO_TESTE });
      const { idCliente, idOperador } = semearCliente(cenario);
      const idVencido = semearOrcamento(cenario, idCliente, idOperador, {
        status: 'RASCUNHO',
        data_ultima_edicao: isoHaDias(DIAS_PARA_EXPIRAR_RASCUNHO + 1),
      });
      const idNoLimiteExato = semearOrcamento(cenario, idCliente, idOperador, {
        status: 'PENDENTE_CREDITO',
        data_ultima_edicao: isoHaDias(DIAS_PARA_EXPIRAR_RASCUNHO),
      });
      const idRecente = semearOrcamento(cenario, idCliente, idOperador, {
        status: 'RASCUNHO',
        data_ultima_edicao: isoHaDias(DIAS_PARA_EXPIRAR_RASCUNHO - 1),
      });
      const servico = montarServico(cenario);

      const processados = await servico.expirarRascunhosEPendentesDeCredito();

      expect(processados).toBe(1);
      const orcamentos = cenario.banco.linhas('orcamento');
      const vencido = orcamentos.find((linha) => linha.id_orcamento === idVencido);
      expect(vencido).toMatchObject({
        status: 'EXPIRADO',
        motivo_expiracao: 'RASCUNHO',
        data_encerramento: AGORA_DO_TESTE.toISOString(),
      });
      expect(orcamentos.find((linha) => linha.id_orcamento === idNoLimiteExato)).toMatchObject({
        status: 'PENDENTE_CREDITO',
      });
      expect(orcamentos.find((linha) => linha.id_orcamento === idRecente)).toMatchObject({
        status: 'RASCUNHO',
      });
      const historico = cenario.banco
        .linhas('historico_orcamento')
        .filter((linha) => linha.id_orcamento === idVencido);
      expect(historico).toHaveLength(1);
      expect(historico[0]).toMatchObject({
        id_operador: null,
        tipo_evento: 'MUDANCA_STATUS',
        status_anterior: 'RASCUNHO',
        status_novo: 'EXPIRADO',
      });
    });

    it('não faz nada quando não há candidatos', async () => {
      const cenario = montarCenarioDeCadastros({ agora: () => AGORA_DO_TESTE });
      const servico = montarServico(cenario);

      expect(await servico.expirarRascunhosEPendentesDeCredito()).toBe(0);
    });
  });

  describe('apagarRascunhosExpirados (job 2, RN25)', () => {
    it('apaga o rascunho com itens, anexos e histórico (cascata do banco) pela função do banco', async () => {
      const cenario = montarCenarioDeCadastros({ agora: () => AGORA_DO_TESTE });
      const { idCliente, idOperador } = semearCliente(cenario);
      const idExpirado = semearOrcamento(cenario, idCliente, idOperador, {
        status: 'EXPIRADO',
        motivo_expiracao: 'RASCUNHO',
        data_encerramento: isoHaDias(DIAS_PARA_APAGAR_RASCUNHO_EXPIRADO + 1),
      });
      semearItemAvulso(cenario, idExpirado);
      cenario.banco.semear('anexo_orcamento', {
        id_orcamento: idExpirado,
        tipo_anexo: 'MATERIAL_APOIO',
        nome_arquivo: 'catalogo.pdf',
        caminho_arquivo: '/anexos/catalogo.pdf',
      });
      cenario.banco.semear('historico_orcamento', {
        id_orcamento: idExpirado,
        id_operador: null,
        tipo_evento: 'MUDANCA_STATUS',
        status_novo: 'RASCUNHO',
      });
      const servico = montarServico(cenario);

      const apagados = await servico.apagarRascunhosExpirados();

      expect(apagados).toBe(1);
      expect(cenario.banco.linhas('orcamento').some((l) => l.id_orcamento === idExpirado)).toBe(
        false,
      );
      expect(cenario.banco.linhas('item_orcamento')).toHaveLength(0);
      expect(cenario.banco.linhas('anexo_orcamento')).toHaveLength(0);
      expect(cenario.banco.linhas('historico_orcamento')).toHaveLength(0);
    });

    it('não apaga quem expirou há menos de 30 dias', async () => {
      const cenario = montarCenarioDeCadastros({ agora: () => AGORA_DO_TESTE });
      const { idCliente, idOperador } = semearCliente(cenario);
      semearOrcamento(cenario, idCliente, idOperador, {
        status: 'EXPIRADO',
        motivo_expiracao: 'RASCUNHO',
        data_encerramento: isoHaDias(DIAS_PARA_APAGAR_RASCUNHO_EXPIRADO - 1),
      });
      const servico = montarServico(cenario);

      expect(await servico.apagarRascunhosExpirados()).toBe(0);
      expect(cenario.banco.linhas('orcamento')).toHaveLength(1);
    });

    it('nunca mexe num orçamento emitido, mesmo EXPIRADO por VALIDADE', async () => {
      const cenario = montarCenarioDeCadastros({ agora: () => AGORA_DO_TESTE });
      const { idCliente, idOperador } = semearCliente(cenario);
      semearOrcamento(cenario, idCliente, idOperador, {
        status: 'EXPIRADO',
        motivo_expiracao: 'VALIDADE',
        data_encerramento: isoHaDias(DIAS_PARA_APAGAR_RASCUNHO_EXPIRADO + 10),
      });
      const servico = montarServico(cenario);

      expect(await servico.apagarRascunhosExpirados()).toBe(0);
      expect(cenario.banco.linhas('orcamento')).toHaveLength(1);
    });

    it('o DELETE direto continua recusado quando há histórico (só a função do banco apaga)', async () => {
      const cenario = montarCenarioDeCadastros({ agora: () => AGORA_DO_TESTE });
      const { idCliente, idOperador } = semearCliente(cenario);
      const idExpirado = semearOrcamento(cenario, idCliente, idOperador, {
        status: 'EXPIRADO',
        motivo_expiracao: 'RASCUNHO',
        data_encerramento: isoHaDias(DIAS_PARA_APAGAR_RASCUNHO_EXPIRADO + 1),
      });
      cenario.banco.semear('historico_orcamento', {
        id_orcamento: idExpirado,
        id_operador: null,
        tipo_evento: 'MUDANCA_STATUS',
        status_novo: 'RASCUNHO',
      });

      expect(() =>
        cenario.banco.executar('dados.excluir', {
          tabela: 'orcamento',
          filtros: { e: [['id_orcamento', '=', idExpirado]] },
        }),
      ).toThrow();
    });
  });

  describe('expirarOrcamentosEmitidos (job 3, RF16)', () => {
    it('expira o ABERTO cuja validade já passou, e registra o histórico', async () => {
      const cenario = montarCenarioDeCadastros({ agora: () => AGORA_DO_TESTE });
      const { idCliente, idOperador } = semearCliente(cenario);
      const idVencido = semearOrcamento(cenario, idCliente, idOperador, {
        status: 'ABERTO',
        data_validade: dataHaDias(1),
      });
      const idVigente = semearOrcamento(cenario, idCliente, idOperador, {
        status: 'ABERTO',
        data_validade: dataHaDias(-5), // vence daqui a 5 dias
      });
      const servico = montarServico(cenario);

      const processados = await servico.expirarOrcamentosEmitidos();

      expect(processados).toBe(1);
      const orcamentos = cenario.banco.linhas('orcamento');
      expect(orcamentos.find((l) => l.id_orcamento === idVencido)).toMatchObject({
        status: 'EXPIRADO',
        motivo_expiracao: 'VALIDADE',
      });
      expect(orcamentos.find((l) => l.id_orcamento === idVigente)).toMatchObject({
        status: 'ABERTO',
      });
      const historico = cenario.banco
        .linhas('historico_orcamento')
        .filter((l) => l.id_orcamento === idVencido);
      expect(historico).toHaveLength(1);
      expect(historico[0]).toMatchObject({ status_anterior: 'ABERTO', status_novo: 'EXPIRADO' });
    });

    it('não toca em RASCUNHO nem em orçamento já encerrado', async () => {
      const cenario = montarCenarioDeCadastros({ agora: () => AGORA_DO_TESTE });
      const { idCliente, idOperador } = semearCliente(cenario);
      semearOrcamento(cenario, idCliente, idOperador, { status: 'RASCUNHO' });
      semearOrcamento(cenario, idCliente, idOperador, {
        status: 'ACEITO',
        data_validade: dataHaDias(10),
        data_encerramento: isoHaDias(1),
      });
      const servico = montarServico(cenario);

      expect(await servico.expirarOrcamentosEmitidos()).toBe(0);
    });
  });

  describe('expirarReservas (job 4, "Ciclo da reserva de estoque")', () => {
    it('expira a reserva CONFIRMADA vencida, sem olhar o orçamento', async () => {
      const cenario = montarCenarioDeCadastros({ agora: () => AGORA_DO_TESTE });
      const { idCliente, idOperador } = semearCliente(cenario);
      const idOrcamento = semearOrcamento(cenario, idCliente, idOperador, { status: 'ABERTO' });
      const idItem = semearItemAvulso(cenario, idOrcamento);
      const [reservaVencida] = cenario.banco.semear('reserva_estoque', {
        id_item: idItem,
        quantidade_reservada: 1,
        status: 'CONFIRMADA',
        data_expiracao: dataHaDias(1),
      });
      const idItemVigente = semearItemAvulso(cenario, idOrcamento);
      cenario.banco.semear('reserva_estoque', {
        id_item: idItemVigente,
        quantidade_reservada: 1,
        status: 'CONFIRMADA',
        data_expiracao: dataHaDias(-5),
      });
      const servico = montarServico(cenario);

      const processados = await servico.expirarReservas();

      expect(processados).toBe(1);
      const reservas = cenario.banco.linhas('reserva_estoque');
      expect(reservas.find((r) => r.id_reserva === reservaVencida?.id_reserva)).toMatchObject({
        status: 'EXPIRADA',
      });
      expect(reservas.find((r) => r.id_item === idItemVigente)).toMatchObject({
        status: 'CONFIRMADA',
      });
    });

    it('não toca em reserva já BAIXADA ou LIBERADA', async () => {
      const cenario = montarCenarioDeCadastros({ agora: () => AGORA_DO_TESTE });
      const { idCliente, idOperador } = semearCliente(cenario);
      const idOrcamento = semearOrcamento(cenario, idCliente, idOperador, { status: 'ACEITO' });
      const idItem = semearItemAvulso(cenario, idOrcamento);
      cenario.banco.semear('reserva_estoque', {
        id_item: idItem,
        quantidade_reservada: 1,
        status: 'BAIXADA',
        data_expiracao: dataHaDias(1),
      });
      const servico = montarServico(cenario);

      expect(await servico.expirarReservas()).toBe(0);
    });
  });

  describe('marcarProtestoDeDividas (job 5, RN06)', () => {
    it('protesta a dívida EM_ABERTO vencida há mais de 60 dias', async () => {
      const cenario = montarCenarioDeCadastros({ agora: () => AGORA_DO_TESTE });
      const { idCliente, idOperador } = semearCliente(cenario);
      const [dividaVencida] = cenario.banco.semear('divida_inadimplencia', {
        id_cliente: idCliente,
        id_operador_registro: idOperador,
        valor_divida: '1000.00',
        status: 'EM_ABERTO',
        data_vencimento_original: dataHaDias(DIAS_DE_ATRASO_PARA_PROTESTO + 1),
      });
      const [dividaNoLimite] = cenario.banco.semear('divida_inadimplencia', {
        id_cliente: idCliente,
        id_operador_registro: idOperador,
        valor_divida: '500.00',
        status: 'EM_ABERTO',
        data_vencimento_original: dataHaDias(DIAS_DE_ATRASO_PARA_PROTESTO),
      });
      const servico = montarServico(cenario);

      const processados = await servico.marcarProtestoDeDividas();

      expect(processados).toBe(1);
      const dividas = cenario.banco.linhas('divida_inadimplencia');
      expect(dividas.find((d) => d.id_divida === dividaVencida?.id_divida)).toMatchObject({
        status: 'PROTESTADA',
        data_protesto: dataHaDias(0),
      });
      expect(dividas.find((d) => d.id_divida === dividaNoLimite?.id_divida)).toMatchObject({
        status: 'EM_ABERTO',
      });
    });

    it('não protesta dívida já renegociada, quitada ou protestada', async () => {
      const cenario = montarCenarioDeCadastros({ agora: () => AGORA_DO_TESTE });
      const { idCliente, idOperador } = semearCliente(cenario);
      cenario.banco.semear('divida_inadimplencia', {
        id_cliente: idCliente,
        id_operador_registro: idOperador,
        valor_divida: '1000.00',
        status: 'RENEGOCIADA',
        data_vencimento_original: dataHaDias(200),
        data_renegociacao: dataHaDias(10),
        valor_pago_renegociacao: '600.00',
      });
      const servico = montarServico(cenario);

      expect(await servico.marcarProtestoDeDividas()).toBe(0);
    });
  });

  describe('executarTodos', () => {
    it('executa os cinco jobs e isola a falha de um deles no resumo, sem parar os demais', async () => {
      const cenario = montarCenarioDeCadastros({ agora: () => AGORA_DO_TESTE });
      const { idCliente, idOperador } = semearCliente(cenario);
      // Job 1 tem um candidato de verdade.
      semearOrcamento(cenario, idCliente, idOperador, {
        status: 'RASCUNHO',
        data_ultima_edicao: isoHaDias(DIAS_PARA_EXPIRAR_RASCUNHO + 1),
      });
      // Candidato do job 2, com histórico: a função do banco apaga em cascata.
      const idParaApagar = semearOrcamento(cenario, idCliente, idOperador, {
        status: 'EXPIRADO',
        motivo_expiracao: 'RASCUNHO',
        data_encerramento: isoHaDias(DIAS_PARA_APAGAR_RASCUNHO_EXPIRADO + 1),
      });
      cenario.banco.semear('historico_orcamento', {
        id_orcamento: idParaApagar,
        id_operador: null,
        tipo_evento: 'MUDANCA_STATUS',
        status_novo: 'RASCUNHO',
      });
      const servico = montarServico(cenario);

      const resumo = await servico.executarTodos();

      expect(resumo).toHaveLength(5);
      const porJob = new Map(resumo.map((item) => [item.job, item]));
      expect(porJob.get('expirar_rascunhos_e_pendentes_de_credito')).toMatchObject({
        processados: 1,
      });
      expect(porJob.get('apagar_rascunhos_expirados')).toMatchObject({ processados: 1 });
      expect(porJob.get('expirar_orcamentos_emitidos')).toMatchObject({ processados: 0 });
      expect(porJob.get('expirar_reservas')).toMatchObject({ processados: 0 });
      expect(porJob.get('marcar_protesto_de_dividas')).toMatchObject({ processados: 0 });
    });
  });

  describe('executarTodos com o processamento de respostas (UC20)', () => {
    it('inclui o sexto passo, e a falha dele não derruba os outros jobs', async () => {
      const cenario = montarCenarioDeCadastros({ agora: () => AGORA_DO_TESTE });
      const processar = jest.fn().mockResolvedValueOnce(2).mockRejectedValueOnce(new Error('boom'));
      const servico = new ServicoDeJobsAgendados({
        jobs: new RepositorioDeJobs(cenario.proxy),
        logger: LOGGER_SILENCIOSO,
        agora: () => AGORA_DO_TESTE,
        processarRespostasPendentes: processar,
      });

      const primeira = await servico.executarTodos();
      const segunda = await servico.executarTodos();

      expect(primeira).toHaveLength(6);
      expect(primeira[5]).toEqual({ job: 'processar_respostas_pendentes', processados: 2 });
      expect(segunda).toHaveLength(6);
      expect(segunda[5]).toMatchObject({ job: 'processar_respostas_pendentes', erro: 'boom' });
      expect(segunda[0]).toMatchObject({ processados: 0 });
    });
  });

  describe('executarTodos com a limpeza das sessões no banco (UC13)', () => {
    it('inclui a remoção das sessões vencidas como último passo, com falha isolada', async () => {
      const cenario = montarCenarioDeCadastros({ agora: () => AGORA_DO_TESTE });
      const remover = jest.fn().mockResolvedValueOnce(3).mockRejectedValueOnce(new Error('proxy'));
      const servico = new ServicoDeJobsAgendados({
        jobs: new RepositorioDeJobs(cenario.proxy),
        logger: LOGGER_SILENCIOSO,
        agora: () => AGORA_DO_TESTE,
        removerSessoesExpiradas: remover,
      });

      const primeira = await servico.executarTodos();
      const segunda = await servico.executarTodos();

      expect(primeira).toHaveLength(6);
      expect(primeira[5]).toEqual({ job: 'remover_sessoes_expiradas', processados: 3 });
      expect(segunda[5]).toMatchObject({ job: 'remover_sessoes_expiradas', erro: 'proxy' });
    });
  });
});
