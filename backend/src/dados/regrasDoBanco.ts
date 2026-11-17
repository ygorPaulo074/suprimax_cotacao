// RNF09 — tradução dos códigos de regra do banco (RAISE EXCEPTION) em erros do catálogo do backend.
// O proxy os devolve como 422 REGRA_DE_NEGOCIO com `detalhes.regra` (docs/12, 12.8.6); o texto ao
// usuário é daqui. A lista de códigos espelha REGRAS_DO_BANCO em proxy/src/erros.ts.
import { AppError, type CodigoDeErro } from '../erros';
import type { ErroProxy } from './proxyCliente';

/** Código do proxy para regra do banco sem código próprio. */
export const CODIGO_REGRA_DE_NEGOCIO = 'REGRA_DE_NEGOCIO';

interface TraducaoDeRegra {
  readonly codigo: CodigoDeErro;
  readonly mensagem: string;
  /** Emissão bloqueada leva `detalhes.bloqueios`, como o `condicoes.bloqueios` do GET. */
  readonly comoBloqueio?: boolean;
}

const MSG_ORIENTAR = 'Atualize a tela e tente novamente.';

/** Regra do banco → erro do catálogo. Reaproveita o código do backend quando o conceito é o mesmo. */
export const TRADUCAO_DAS_REGRAS_DO_BANCO: Readonly<Record<string, TraducaoDeRegra>> = {
  // Cliente
  CLIENTE_INADIMPLENTE: {
    codigo: 'CLIENTE_BLOQUEADO',
    mensagem: 'Este cliente tem dívida em aberto e não pode receber orçamento.',
  },
  CLIENTE_INATIVO: {
    codigo: 'CLIENTE_BLOQUEADO',
    mensagem: 'Este cliente está inativo e não pode receber orçamento.',
  },
  ENDERECO_CLIENTE_DIVERGENTE: {
    codigo: 'DADOS_INCONSISTENTES',
    mensagem: 'O endereço de entrega não pertence ao cliente do orçamento.',
  },
  // Emissão e orçamento
  FATURAMENTO_MINIMO_NAO_ATINGIDO: {
    codigo: 'EMISSAO_BLOQUEADA',
    mensagem: 'O orçamento está abaixo do faturamento mínimo.',
    comoBloqueio: true,
  },
  FRETE_PROVISORIO_NAO_EMITIVEL: {
    codigo: 'EMISSAO_BLOQUEADA',
    mensagem: 'O frete ainda é provisório: defina o frete definitivo antes de emitir.',
    comoBloqueio: true,
  },
  ORCAMENTO_SEM_ITENS: {
    codigo: 'EMISSAO_BLOQUEADA',
    mensagem: 'O orçamento não tem itens. Adicione ao menos um item antes de emitir.',
    comoBloqueio: true,
  },
  ORCAMENTO_NAO_ABERTO: {
    codigo: 'OPERACAO_NAO_PERMITIDA',
    mensagem: 'Esta operação só vale para orçamento aberto.',
  },
  ORCAMENTO_DEVE_INICIAR_EM_RASCUNHO: {
    codigo: 'OPERACAO_NAO_PERMITIDA',
    mensagem: 'Todo orçamento novo deve começar como rascunho.',
  },
  EMISSAO_DEVE_USAR_OPERACAO_NOMEADA: {
    codigo: 'OPERACAO_NAO_PERMITIDA',
    mensagem: 'O orçamento só pode ser emitido pela ação de emissão.',
  },
  TRANSICAO_ORCAMENTO_INVALIDA: {
    codigo: 'OPERACAO_NAO_PERMITIDA',
    mensagem: 'O orçamento não pode mudar para esse status a partir do status atual.',
  },
  ITEM_ORCAMENTO_INVALIDO: {
    codigo: 'DADOS_INCONSISTENTES',
    mensagem: 'O item não é válido para este orçamento.',
  },
  TOTAL_ITENS_DIVERGENTE: {
    codigo: 'DADOS_INCONSISTENTES',
    mensagem: `O total dos itens não confere com o total do orçamento. ${MSG_ORIENTAR}`,
  },
  TOTAL_IMPOSTO_DIVERGENTE: {
    codigo: 'DADOS_INCONSISTENTES',
    mensagem: `O total de imposto não confere com o dos itens. ${MSG_ORIENTAR}`,
  },
  FAIXA_VARIACAO_DIVERGENTE: {
    codigo: 'DADOS_INCONSISTENTES',
    mensagem: 'A faixa de preço não pertence à variação do produto.',
  },
  FARDO_VARIACAO_DIVERGENTE: {
    codigo: 'DADOS_INCONSISTENTES',
    mensagem: 'O fardo não pertence à variação do produto.',
  },
  // Reserva e estoque
  ESTOQUE_ABAIXO_DAS_RESERVAS: {
    codigo: 'AJUSTE_ABAIXO_DO_RESERVADO',
    mensagem: 'Esta operação deixaria o estoque físico menor que o total reservado.',
  },
  ESTOQUE_DEVE_SER_ALTERADO_POR_MOVIMENTACAO: {
    codigo: 'OPERACAO_NAO_PERMITIDA',
    mensagem: 'O estoque só pode ser alterado por uma movimentação.',
  },
  MOVIMENTACAO_E_IMUTAVEL: {
    codigo: 'OPERACAO_NAO_PERMITIDA',
    mensagem: 'Uma movimentação de estoque já registrada não pode ser alterada nem apagada.',
  },
  RESERVA_DEVE_SER_ATUALIZADA_POR_OPERACAO_NOMEADA: {
    codigo: 'OPERACAO_NAO_PERMITIDA',
    mensagem: 'A reserva de estoque só pode ser alterada pela ação própria.',
  },
  RESERVA_FORA_DA_EMISSAO: {
    codigo: 'OPERACAO_NAO_PERMITIDA',
    mensagem: 'A reserva de estoque só pode ser criada na emissão do orçamento.',
  },
  RESERVA_IMUTAVEL: {
    codigo: 'OPERACAO_NAO_PERMITIDA',
    mensagem: 'Esta reserva de estoque já foi encerrada e não pode ser alterada.',
  },
  RESERVA_NAO_EXCLUIVEL: {
    codigo: 'OPERACAO_NAO_PERMITIDA',
    mensagem: 'Uma reserva de estoque não pode ser apagada.',
  },
  RESERVA_NAO_ENCONTRADA: {
    codigo: 'NOT_FOUND',
    mensagem: 'Reserva de estoque não encontrada.',
  },
  TRANSICAO_RESERVA_INVALIDA: {
    codigo: 'OPERACAO_NAO_PERMITIDA',
    mensagem: 'A reserva não pode mudar para esse status a partir do status atual.',
  },
  QUANTIDADE_RESERVA_DIVERGENTE: {
    codigo: 'DADOS_INCONSISTENTES',
    mensagem: 'A quantidade reservada não confere com a quantidade do item.',
  },
  // Resposta do cliente (UC20, UC21)
  ACEITE_DEVE_USAR_OPERACAO_NOMEADA: {
    codigo: 'OPERACAO_NAO_PERMITIDA',
    mensagem: 'O aceite do cliente só pode ser registrado pela ação de processar a resposta.',
  },
  ACEITE_INCONSISTENTE: {
    codigo: 'DADOS_INCONSISTENTES',
    mensagem: 'Os dados do aceite do cliente são inconsistentes.',
  },
  APROVACAO_HERDADA_SEM_ORIGEM: {
    codigo: 'DADOS_INCONSISTENTES',
    mensagem: 'A aprovação herdada não indica o orçamento de origem.',
  },
  FAIXA_ACEITA_VARIACAO_DIVERGENTE: {
    codigo: 'DADOS_INCONSISTENTES',
    mensagem: 'A faixa aceita não pertence à variação do item.',
  },
  ITEM_RESPOSTA_NAO_ENCONTRADO: {
    codigo: 'NOT_FOUND',
    mensagem: 'Item da resposta do cliente não encontrado.',
  },
  ITEM_RESPOSTA_ORCAMENTO_DIVERGENTE: {
    codigo: 'DADOS_INCONSISTENTES',
    mensagem: 'O item da resposta não pertence ao orçamento respondido.',
  },
  MOTIVO_TRATAMENTO_INVALIDO: {
    codigo: 'MOTIVO_TRATAMENTO_INVALIDO',
    mensagem: 'O motivo informado para tratar a resposta é inválido.',
  },
  QUANTIDADE_APROVADA_EXCEDE_COTADA: {
    codigo: 'DADOS_INCONSISTENTES',
    mensagem: 'A quantidade aprovada pelo cliente é maior que a quantidade cotada.',
  },
  RESPOSTA_DEVE_CONTER_TODOS_ITENS: {
    codigo: 'DADOS_INCONSISTENTES',
    mensagem: 'A resposta precisa conter todos os itens do orçamento.',
  },
  RESPOSTA_DEVE_INICIAR_PENDENTE: {
    codigo: 'OPERACAO_NAO_PERMITIDA',
    mensagem: 'Toda resposta do cliente deve começar como pendente.',
  },
  RESPOSTA_IMUTAVEL: {
    codigo: 'OPERACAO_NAO_PERMITIDA',
    mensagem: 'Esta resposta do cliente já foi processada e não pode ser alterada.',
  },
  RESPOSTA_INCONSISTENTE: {
    codigo: 'DADOS_INCONSISTENTES',
    mensagem: 'Os dados da resposta do cliente são inconsistentes.',
  },
  RESPOSTA_NAO_EDITAVEL: {
    codigo: 'OPERACAO_NAO_PERMITIDA',
    mensagem: 'Esta resposta do cliente não pode mais ser alterada.',
  },
  SITUACAO_QUANTIDADE_DIVERGENTE: {
    codigo: 'DADOS_INCONSISTENTES',
    mensagem: 'A situação do item não confere com a quantidade aprovada.',
  },
  TOTAL_ACEITO_DIVERGENTE: {
    codigo: 'DADOS_INCONSISTENTES',
    mensagem: `O total aceito não confere com os itens aprovados. ${MSG_ORIENTAR}`,
  },
  TOTAL_ACEITO_OBRIGATORIO: {
    codigo: 'DADOS_INCONSISTENTES',
    mensagem: 'Informe o total aceito pelo cliente.',
  },
  TRANSICAO_RESPOSTA_INVALIDA: {
    codigo: 'OPERACAO_NAO_PERMITIDA',
    mensagem: 'A resposta não pode mudar para esse status a partir do status atual.',
  },
  // Crédito, dívida, usuários
  PRAZO_PROTESTO_NAO_ATINGIDO: {
    codigo: 'PRAZO_PROTESTO_NAO_ATINGIDO',
    mensagem: 'O prazo para protestar esta dívida ainda não foi atingido.',
  },
  RESPONSAVEL_CREDITO_NAO_E_FISCAL: {
    codigo: 'ACESSO_NEGADO',
    mensagem: 'Só o fiscal pode registrar o resultado da análise de crédito.',
  },
  LIBERADOR_NAO_E_OPERADOR_CHEFE: {
    codigo: 'LIBERACAO_NEGADA',
    mensagem: 'Só o operador chefe pode liberar a divergência na entrada de mercadoria.',
  },
  VENDEDOR_COM_CARTEIRA_ATIVA: {
    codigo: 'VENDEDOR_COM_CARTEIRA',
    mensagem: 'Este vendedor tem clientes na carteira. Transfira a carteira antes de continuar.',
  },
  TOKEN_RECUPERACAO_INVALIDO: {
    codigo: 'TOKEN_RECUPERACAO_INVALIDO',
    mensagem: 'Link de redefinição de senha inválido ou expirado. Peça um novo.',
  },
};

/** Só um identificador de regra (letras maiúsculas, dígitos e sublinhado) vai para `detalhes`. */
const FORMATO_DE_REGRA = /^[A-Z][A-Z0-9_]{0,79}$/;

/** Lê `detalhes.regra` do erro do proxy; `undefined` se faltar ou não parecer um código. */
export function regraDoErro(erro: ErroProxy): string | undefined {
  const regra = erro.detalhes?.regra;
  return typeof regra === 'string' && FORMATO_DE_REGRA.test(regra) ? regra : undefined;
}

/**
 * Traduz o 422 REGRA_DE_NEGOCIO do proxy. Código mapeado: erro do catálogo com mensagem em
 * português e `detalhes.regra`. Código sem mapeamento (ou ausente): `REGRA_DE_NEGOCIO` genérico,
 * mensagem neutra. Nunca expõe a mensagem do proxy nem texto do banco; o ErroProxy vai em `causa`.
 */
export function traduzirRegraDoBanco(erro: ErroProxy): AppError {
  const regra = regraDoErro(erro);
  const traducao =
    regra !== undefined && Object.hasOwn(TRADUCAO_DAS_REGRAS_DO_BANCO, regra)
      ? TRADUCAO_DAS_REGRAS_DO_BANCO[regra]
      : undefined;
  if (regra === undefined || traducao === undefined) {
    return new AppError(CODIGO_REGRA_DE_NEGOCIO, {
      ...(regra !== undefined && { detalhes: { regra } }),
      causa: erro,
    });
  }
  const detalhes = traducao.comoBloqueio
    ? { regra, bloqueios: [{ codigo: regra, mensagem: traducao.mensagem }] }
    : { regra };
  return new AppError(traducao.codigo, { mensagem: traducao.mensagem, detalhes, causa: erro });
}
