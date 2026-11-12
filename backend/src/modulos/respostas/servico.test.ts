// UC20, UC21 — testes de ServicoDeRespostas contra o banco em memória, sem passar pelas rotas
// HTTP. `ServicoDeOrcamentos` entra de verdade como `GestorDeVersoesDeOrcamento`: é o mesmo
// serviço que roda em produção, não um dublê, porque a própria emissão (UC19) e o cancelamento
// (UC06) são regra de negócio real que o teste quer exercitar.
import { ErroDeRespostaJaTratada } from '../../erros';
import { criarLogger } from '../../log';
import {
  montarCenarioDeCadastros,
  type CenarioDeCadastros,
} from '../../testing/cenarioDeCadastros';
import type { Sessao } from '../auth/sessoes';
import { RepositorioDeClientes } from '../clientes/repositorio';
import { RepositorioDeOrcamentos } from '../orcamentos/repositorio';
import { ServicoDeOrcamentos } from '../orcamentos/servico';
import { RepositorioDeProdutos } from '../produtos/repositorio';
import { RepositorioDeUsuarios } from '../usuarios/repositorio';
import { RepositorioDeRespostas } from './repositorio';
import { ServicoDeRespostas } from './servico';

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

function montarServicos(cenario: CenarioDeCadastros): {
  orcamentos: ServicoDeOrcamentos;
  respostas: ServicoDeRespostas;
} {
  const orcamentos = new ServicoDeOrcamentos({
    orcamentos: new RepositorioDeOrcamentos(cenario.proxy),
    clientes: new RepositorioDeClientes(cenario.proxy),
    produtos: new RepositorioDeProdutos(cenario.proxy),
    usuarios: new RepositorioDeUsuarios(cenario.proxy),
    proxy: cenario.proxy,
    logger: LOGGER_SILENCIOSO,
  });
  const respostas = new ServicoDeRespostas({
    respostas: new RepositorioDeRespostas(cenario.proxy),
    orcamentos: new RepositorioDeOrcamentos(cenario.proxy),
    produtos: new RepositorioDeProdutos(cenario.proxy),
    clientes: new RepositorioDeClientes(cenario.proxy),
    usuarios: new RepositorioDeUsuarios(cenario.proxy),
    gestorDeVersoes: orcamentos,
    logger: LOGGER_SILENCIOSO,
  });
  return { orcamentos, respostas };
}

/** Semeia um cliente (ativo, sem dívida) e devolve o id e o vendedor dele. */
function semearCliente(cenario: CenarioDeCadastros): { idCliente: number; idVendedor: number } {
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
  return { idCliente: cliente?.id_cliente as number, idVendedor };
}

/** Semeia um produto com uma variação e uma faixa de preço (AVULSO). */
function semearVariacao(cenario: CenarioDeCadastros, precoUnitario = 600): number {
  contador += 1;
  const [produto] = cenario.banco.semear('produto', {
    codigo_interno: `PROD-${contador}`,
    descricao: 'Papel Higiênico',
  });
  const [variacao] = cenario.banco.semear('variacao_produto', {
    id_produto: produto?.id_produto,
    marca: 'MarcaX',
    tamanho_embalagem: '30m',
    quantidade_estoque: 1000,
  });
  const idVariacao = variacao?.id_variacao as number;
  cenario.banco.semear('faixa_preco', {
    id_variacao: idVariacao,
    quantidade_minima: 1,
    preco_unitario: (precoUnitario / 100).toFixed(2),
  });
  return idVariacao;
}

/**
 * Cria, adiciona os itens e emite um orçamento (UC14-19), pronto para receber uma resposta do
 * cliente (UC20). 300 unidades a R$6,00 cada (como em `orcamentos/servico.test.ts`) somam
 * R$2.124,00 com imposto — acima do limite CIF (R$1.500,00, `services/calculo/regras.ts`), então
 * o frete não depende de `origemTransportadora` estar configurada.
 */
async function criarOrcamentoEmitido(
  cenario: CenarioDeCadastros,
  orcamentos: ServicoDeOrcamentos,
  sessao: Sessao,
  idCliente: number,
  quantidadesPorItem: readonly number[],
): Promise<{ idOrcamento: number; idsDosItens: number[] }> {
  const { idOrcamento } = await orcamentos.criar(
    { idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null },
    sessao,
  );
  const idsDosItens: number[] = [];
  for (const quantidade of quantidadesPorItem) {
    const idVariacao = semearVariacao(cenario);
    const detalhe = await orcamentos.adicionarItem(
      idOrcamento,
      { idVariacao, granularidade: 'AVULSO', quantidade },
      sessao,
    );
    idsDosItens.push(detalhe.itens[detalhe.itens.length - 1]!.idItem);
  }
  await orcamentos.emitir(idOrcamento, sessao);
  return { idOrcamento, idsDosItens };
}

/** Semeia a resposta do cliente (UC11) direto no banco: só o Sistema 1 a grava, fora desta API. */
function semearResposta(
  cenario: CenarioDeCadastros,
  opcoes: {
    idOrcamento: number;
    idVendedor: number;
    tipo: 'ITENS' | 'RECUSA' | 'ALTERACAO';
    justificativa?: string | null;
    itens?: readonly { idItem: number; quantidadeAprovada: number }[];
  },
): number {
  const [resposta] = cenario.banco.semear('resposta_orcamento', {
    id_orcamento: opcoes.idOrcamento,
    tipo_resposta: opcoes.tipo,
    status_resposta: 'PENDENTE',
    id_operador_vendedor: opcoes.idVendedor,
    data_resposta: new Date().toISOString(),
    justificativa: opcoes.justificativa ?? null,
  });
  const idResposta = resposta?.id_resposta as number;
  for (const item of opcoes.itens ?? []) {
    cenario.banco.semear('item_resposta_orcamento', {
      id_resposta: idResposta,
      id_item: item.idItem,
      quantidade_aprovada: item.quantidadeAprovada,
      situacao: item.quantidadeAprovada > 0 ? 'APROVADO' : 'NAO_APROVADO',
    });
  }
  return idResposta;
}

function orcamentoAtual(cenario: CenarioDeCadastros, idOrcamento: number) {
  return cenario.banco.linhas('orcamento').find((linha) => linha.id_orcamento === idOrcamento);
}

function respostaAtual(cenario: CenarioDeCadastros, idResposta: number) {
  return cenario.banco
    .linhas('resposta_orcamento')
    .find((linha) => linha.id_resposta === idResposta);
}

describe('ServicoDeRespostas', () => {
  describe('processarPendentes (UC20)', () => {
    it('recusa: orçamento RECUSADO, reserva liberada, resposta AGUARDA_OPERADOR (motivo RECUSA)', async () => {
      const cenario = montarCenarioDeCadastros();
      const { orcamentos, respostas } = montarServicos(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-emite');
      const sessao = sessaoDoOperador(idOperador, 'quem-emite');
      const { idCliente, idVendedor } = semearCliente(cenario);
      const { idOrcamento } = await criarOrcamentoEmitido(
        cenario,
        orcamentos,
        sessao,
        idCliente,
        [300],
      );
      const idResposta = semearResposta(cenario, {
        idOrcamento,
        idVendedor,
        tipo: 'RECUSA',
        justificativa: 'Preço acima do praticado pela concorrência.',
      });

      const processadas = await respostas.processarPendentes();

      expect(processadas).toBe(1);
      expect(orcamentoAtual(cenario, idOrcamento)?.status).toBe('RECUSADO');
      expect(respostaAtual(cenario, idResposta)).toMatchObject({
        status_resposta: 'AGUARDA_OPERADOR',
        motivo_tratamento: 'RECUSA',
      });
      const [reserva] = cenario.banco.linhas('reserva_estoque');
      expect(reserva?.status).toBe('LIBERADA');
      const historico = cenario.banco
        .linhas('historico_orcamento')
        .filter((linha) => linha.id_orcamento === idOrcamento);
      expect(historico.at(-1)).toMatchObject({
        status_anterior: 'ABERTO',
        status_novo: 'RECUSADO',
      });
    });

    it('aprovação total: orçamento ACEITO, reserva BAIXADA com movimentação BAIXA, resposta CONSOLIDADA', async () => {
      const cenario = montarCenarioDeCadastros();
      const { orcamentos, respostas } = montarServicos(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-emite');
      const sessao = sessaoDoOperador(idOperador, 'quem-emite');
      const { idCliente, idVendedor } = semearCliente(cenario);
      const { idOrcamento, idsDosItens } = await criarOrcamentoEmitido(
        cenario,
        orcamentos,
        sessao,
        idCliente,
        [300],
      );
      const idResposta = semearResposta(cenario, {
        idOrcamento,
        idVendedor,
        tipo: 'ITENS',
        itens: [{ idItem: idsDosItens[0]!, quantidadeAprovada: 300 }],
      });

      await respostas.processarPendentes();

      expect(orcamentoAtual(cenario, idOrcamento)?.status).toBe('ACEITO');
      expect(respostaAtual(cenario, idResposta)).toMatchObject({ status_resposta: 'CONSOLIDADA' });
      // 300 × R$6,00 = R$1.800,00 de linha; 18% de imposto = R$324,00; total R$2.124,00 (CIF).
      expect(Number(respostaAtual(cenario, idResposta)?.valor_total_aceito)).toBeCloseTo(2124, 2);
      const [reserva] = cenario.banco.linhas('reserva_estoque');
      expect(reserva?.status).toBe('BAIXADA');
      const [movimentacao] = cenario.banco.linhas('movimentacao_estoque');
      expect(movimentacao).toMatchObject({ tipo: 'BAIXA', quantidade: -300 });
      const [variacao] = cenario.banco.linhas('variacao_produto');
      expect(variacao?.quantidade_estoque).toBe(700);
    });

    it('aprovação parcial com um item zerado: orçamento continua ABERTO (motivo ITENS_NAO_APROVADOS)', async () => {
      const cenario = montarCenarioDeCadastros();
      const { orcamentos, respostas } = montarServicos(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-emite');
      const sessao = sessaoDoOperador(idOperador, 'quem-emite');
      const { idCliente, idVendedor } = semearCliente(cenario);
      const { idOrcamento, idsDosItens } = await criarOrcamentoEmitido(
        cenario,
        orcamentos,
        sessao,
        idCliente,
        [300, 100],
      );
      const idResposta = semearResposta(cenario, {
        idOrcamento,
        idVendedor,
        tipo: 'ITENS',
        itens: [
          { idItem: idsDosItens[0]!, quantidadeAprovada: 300 },
          { idItem: idsDosItens[1]!, quantidadeAprovada: 0 },
        ],
      });

      await respostas.processarPendentes();

      expect(orcamentoAtual(cenario, idOrcamento)?.status).toBe('ABERTO');
      expect(respostaAtual(cenario, idResposta)).toMatchObject({
        status_resposta: 'AGUARDA_OPERADOR',
        motivo_tratamento: 'ITENS_NAO_APROVADOS',
      });
      const reservas = cenario.banco.linhas('reserva_estoque');
      // Fora do ACEITO, `resposta.processar` não toca nas reservas: continuam CONFIRMADA.
      expect(reservas.every((reserva) => reserva.status === 'CONFIRMADA')).toBe(true);
    });

    it('não reprocessa uma resposta que não está mais PENDENTE', async () => {
      const cenario = montarCenarioDeCadastros();
      const { orcamentos, respostas } = montarServicos(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-emite');
      const sessao = sessaoDoOperador(idOperador, 'quem-emite');
      const { idCliente, idVendedor } = semearCliente(cenario);
      const { idOrcamento } = await criarOrcamentoEmitido(
        cenario,
        orcamentos,
        sessao,
        idCliente,
        [300],
      );
      semearResposta(cenario, { idOrcamento, idVendedor, tipo: 'RECUSA' });

      const primeira = await respostas.processarPendentes();
      const segunda = await respostas.processarPendentes();

      expect(primeira).toBe(1);
      expect(segunda).toBe(0);
    });
  });

  describe('UC21 — tratamento pelo operador', () => {
    async function montarCenarioAguardandoOperador(quantidadeAprovadaDoSegundo = 0) {
      const cenario = montarCenarioDeCadastros();
      const { orcamentos, respostas } = montarServicos(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-trata');
      const sessao = sessaoDoOperador(idOperador, 'quem-trata');
      const { idCliente, idVendedor } = semearCliente(cenario);
      const { idOrcamento, idsDosItens } = await criarOrcamentoEmitido(
        cenario,
        orcamentos,
        sessao,
        idCliente,
        [300, 100],
      );
      const idResposta = semearResposta(cenario, {
        idOrcamento,
        idVendedor,
        tipo: 'ITENS',
        itens: [
          { idItem: idsDosItens[0]!, quantidadeAprovada: 300 },
          { idItem: idsDosItens[1]!, quantidadeAprovada: quantidadeAprovadaDoSegundo },
        ],
      });
      await respostas.processarPendentes();
      return { cenario, orcamentos, respostas, sessao, idOrcamento, idResposta };
    }

    it('lista e conta as respostas que aguardam tratamento, com o filtro por motivo', async () => {
      const { cenario, respostas, idResposta } = await montarCenarioAguardandoOperador();

      expect(await respostas.contarPendentes()).toBe(1);
      const lista = await respostas.listarPendentes({});
      expect(lista).toEqual([expect.objectContaining({ idResposta, tipo: 'ITENS_NAO_APROVADOS' })]);
      expect(await respostas.listarPendentes({ tipo: 'RECUSA' })).toEqual([]);
      void cenario;
    });

    it('obterDetalhe cria o rascunho da nova versão e o reabre em chamadas seguintes (idempotente)', async () => {
      const { respostas, sessao, idOrcamento, idResposta } =
        await montarCenarioAguardandoOperador();

      const primeiro = await respostas.obterDetalhe(idResposta, sessao);
      const segundo = await respostas.obterDetalhe(idResposta, sessao);

      expect(primeiro.itensOriginal).toHaveLength(2);
      expect(primeiro.itensOriginal[1]).toMatchObject({
        situacao: 'NAO_APROVADO',
        quantidadeAprovada: 0,
      });
      const idRascunho1 = (primeiro.novaVersao as { idOrcamento: number }).idOrcamento;
      const idRascunho2 = (segundo.novaVersao as { idOrcamento: number }).idOrcamento;
      expect(idRascunho1).toBe(idRascunho2);
      expect(idRascunho1).not.toBe(idOrcamento);
    });

    it('emitirNovaVersao substitui o original (SUBSTITUIDO, reservas liberadas) e trata a resposta', async () => {
      const { cenario, respostas, sessao, idOrcamento, idResposta } =
        await montarCenarioAguardandoOperador();
      await respostas.obterDetalhe(idResposta, sessao);

      const emitida = await respostas.emitirNovaVersao(idResposta, sessao);

      expect(orcamentoAtual(cenario, idOrcamento)?.status).toBe('SUBSTITUIDO');
      expect(orcamentoAtual(cenario, emitida.idOrcamento)?.status).toBe('ABERTO');
      expect(respostaAtual(cenario, idResposta)).toMatchObject({ status_resposta: 'TRATADA' });
      const reservasDoOriginal = cenario.banco.linhas('reserva_estoque').filter((reserva) => {
        const item = cenario.banco
          .linhas('item_orcamento')
          .find((linha) => linha.id_item === reserva.id_item);
        return item?.id_orcamento === idOrcamento;
      });
      expect(reservasDoOriginal.every((reserva) => reserva.status === 'LIBERADA')).toBe(true);

      await expect(respostas.emitirNovaVersao(idResposta, sessao)).rejects.toBeInstanceOf(
        ErroDeRespostaJaTratada,
      );
    });

    it('tratarSemNovaVersao conclui sem reestruturar (UC21-A1): a resposta vira TRATADA', async () => {
      const cenario = montarCenarioDeCadastros();
      const { orcamentos, respostas } = montarServicos(cenario);
      const idOperador = cenario.semearUsuario('OPERADOR', 'quem-trata');
      const sessao = sessaoDoOperador(idOperador, 'quem-trata');
      const { idCliente, idVendedor } = semearCliente(cenario);
      const { idOrcamento } = await criarOrcamentoEmitido(
        cenario,
        orcamentos,
        sessao,
        idCliente,
        [300],
      );
      const idResposta = semearResposta(cenario, { idOrcamento, idVendedor, tipo: 'RECUSA' });
      await respostas.processarPendentes();

      await respostas.tratarSemNovaVersao(idResposta, sessao);

      expect(respostaAtual(cenario, idResposta)).toMatchObject({ status_resposta: 'TRATADA' });
      // A recusa não cria rascunho (UC21-A1): status do orçamento original não muda.
      expect(orcamentoAtual(cenario, idOrcamento)?.status).toBe('RECUSADO');
    });

    it('descartarRascunho cancela o rascunho (UC21-A2): a resposta continua aguardando tratamento', async () => {
      const { cenario, respostas, sessao, idOrcamento, idResposta } =
        await montarCenarioAguardandoOperador();
      const detalhe = await respostas.obterDetalhe(idResposta, sessao);
      const idRascunho = (detalhe.novaVersao as { idOrcamento: number }).idOrcamento;

      await respostas.descartarRascunho(idResposta, sessao);

      expect(orcamentoAtual(cenario, idRascunho)?.status).toBe('CANCELADO');
      expect(respostaAtual(cenario, idResposta)).toMatchObject({
        status_resposta: 'AGUARDA_OPERADOR',
      });
      expect(orcamentoAtual(cenario, idOrcamento)?.status).toBe('ABERTO');
    });
  });
});
