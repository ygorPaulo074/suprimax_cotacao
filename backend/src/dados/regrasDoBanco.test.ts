import { AppError, CATALOGO_DE_ERROS } from '../erros';
import { ErroProxy } from './proxyCliente';
import { TRADUCAO_DAS_REGRAS_DO_BANCO } from './regrasDoBanco';
import { traduzirErroDeProxy } from './traducaoDeErros';

// Espelho de REGRAS_DO_BANCO (proxy/src/erros.ts): os 47 códigos que o proxy devolve em
// 422 REGRA_DE_NEGOCIO. Se o proxy ganhar um código, a primeira prova abaixo acusa.
const REGRAS_DO_PROXY = [
  'ACEITE_DEVE_USAR_OPERACAO_NOMEADA',
  'ACEITE_INCONSISTENTE',
  'APROVACAO_HERDADA_SEM_ORIGEM',
  'CLIENTE_INADIMPLENTE',
  'CLIENTE_INATIVO',
  'EMISSAO_DEVE_USAR_OPERACAO_NOMEADA',
  'ENDERECO_CLIENTE_DIVERGENTE',
  'ESTOQUE_ABAIXO_DAS_RESERVAS',
  'ESTOQUE_DEVE_SER_ALTERADO_POR_MOVIMENTACAO',
  'FAIXA_ACEITA_VARIACAO_DIVERGENTE',
  'FAIXA_VARIACAO_DIVERGENTE',
  'FARDO_VARIACAO_DIVERGENTE',
  'FATURAMENTO_MINIMO_NAO_ATINGIDO',
  'FRETE_PROVISORIO_NAO_EMITIVEL',
  'ITEM_ORCAMENTO_INVALIDO',
  'ITEM_RESPOSTA_NAO_ENCONTRADO',
  'ITEM_RESPOSTA_ORCAMENTO_DIVERGENTE',
  'LIBERADOR_NAO_E_OPERADOR_CHEFE',
  'MOTIVO_TRATAMENTO_INVALIDO',
  'MOVIMENTACAO_E_IMUTAVEL',
  'ORCAMENTO_DEVE_INICIAR_EM_RASCUNHO',
  'ORCAMENTO_NAO_ABERTO',
  'ORCAMENTO_SEM_ITENS',
  'PRAZO_PROTESTO_NAO_ATINGIDO',
  'QUANTIDADE_APROVADA_EXCEDE_COTADA',
  'QUANTIDADE_RESERVA_DIVERGENTE',
  'RESERVA_DEVE_SER_ATUALIZADA_POR_OPERACAO_NOMEADA',
  'RESERVA_FORA_DA_EMISSAO',
  'RESERVA_IMUTAVEL',
  'RESERVA_NAO_ENCONTRADA',
  'RESERVA_NAO_EXCLUIVEL',
  'RESPONSAVEL_CREDITO_NAO_E_FISCAL',
  'RESPOSTA_DEVE_CONTER_TODOS_ITENS',
  'RESPOSTA_DEVE_INICIAR_PENDENTE',
  'RESPOSTA_IMUTAVEL',
  'RESPOSTA_INCONSISTENTE',
  'RESPOSTA_NAO_EDITAVEL',
  'SITUACAO_QUANTIDADE_DIVERGENTE',
  'TOKEN_RECUPERACAO_INVALIDO',
  'TOTAL_ACEITO_DIVERGENTE',
  'TOTAL_ACEITO_OBRIGATORIO',
  'TOTAL_IMPOSTO_DIVERGENTE',
  'TOTAL_ITENS_DIVERGENTE',
  'TRANSICAO_ORCAMENTO_INVALIDA',
  'TRANSICAO_RESERVA_INVALIDA',
  'TRANSICAO_RESPOSTA_INVALIDA',
  'VENDEDOR_COM_CARTEIRA_ATIVA',
];

const erroDeRegra = (
  regra: unknown,
  mensagem = 'P0001: texto do banco SELECT x FROM y',
): ErroProxy => new ErroProxy(422, 'REGRA_DE_NEGOCIO', mensagem, { regra });

describe('regras do banco (RNF09)', () => {
  it('cobre exatamente os 47 códigos do proxy', () => {
    expect(REGRAS_DO_PROXY).toHaveLength(47);
    expect(Object.keys(TRADUCAO_DAS_REGRAS_DO_BANCO).sort()).toEqual([...REGRAS_DO_PROXY].sort());
  });

  it.each(REGRAS_DO_PROXY)(
    '%s vira erro do catálogo, em português, sem texto do proxy',
    (regra) => {
      const erro = erroDeRegra(regra);
      const traduzido = traduzirErroDeProxy(erro);
      const esperado = TRADUCAO_DAS_REGRAS_DO_BANCO[regra];
      if (esperado === undefined) {
        throw new Error(`sem tradução para ${regra}`);
      }

      expect(traduzido).toBeInstanceOf(AppError);
      expect(traduzido?.codigo).toBe(esperado.codigo);
      expect(traduzido?.status).toBe(CATALOGO_DE_ERROS[esperado.codigo].status);
      expect(traduzido?.status).toBeLessThan(500);
      expect(traduzido?.message).toBe(esperado.mensagem);
      expect(traduzido?.message).toMatch(/[a-záéíóúãõç]/);
      expect(traduzido?.message).not.toMatch(/P0001|SELECT|_[A-Z]+_/);
      expect(traduzido?.detalhes).toMatchObject({ regra });
      expect(traduzido?.cause).toBe(erro);
    },
  );

  it('reaproveita os códigos que o backend já tinha', () => {
    const codigo = (regra: string): string | undefined =>
      traduzirErroDeProxy(erroDeRegra(regra))?.codigo;

    expect(codigo('CLIENTE_INADIMPLENTE')).toBe('CLIENTE_BLOQUEADO');
    expect(codigo('CLIENTE_INATIVO')).toBe('CLIENTE_BLOQUEADO');
    expect(codigo('ESTOQUE_ABAIXO_DAS_RESERVAS')).toBe('AJUSTE_ABAIXO_DO_RESERVADO');
    expect(codigo('VENDEDOR_COM_CARTEIRA_ATIVA')).toBe('VENDEDOR_COM_CARTEIRA');
    expect(codigo('TOKEN_RECUPERACAO_INVALIDO')).toBe('TOKEN_RECUPERACAO_INVALIDO');
  });

  it('bloqueios de emissão levam detalhes.bloqueios', () => {
    const corpo = traduzirErroDeProxy(erroDeRegra('FATURAMENTO_MINIMO_NAO_ATINGIDO'))?.paraCorpo();

    expect(corpo?.codigo).toBe('EMISSAO_BLOQUEADA');
    expect(corpo?.detalhes?.bloqueios).toEqual([
      { codigo: 'FATURAMENTO_MINIMO_NAO_ATINGIDO', mensagem: expect.any(String) },
    ]);
  });

  it.each([
    ['código sem mapeamento', 'REGRA_QUE_NAO_EXISTE', { regra: 'REGRA_QUE_NAO_EXISTE' }],
    ['regra ausente', undefined, undefined],
    ['regra que parece SQL', undefined, undefined],
    ['nome herdado do Object', undefined, undefined],
  ])(
    'genérico: %s vira 422 REGRA_DE_NEGOCIO neutro, sem vazar o texto do banco',
    (caso, regra, detalhes) => {
      const entrada =
        caso === 'regra que parece SQL'
          ? 'x; DROP TABLE orcamento'
          : caso === 'nome herdado do Object'
            ? 'constructor'
            : regra;
      const erro = erroDeRegra(entrada, 'ERROR: relation "orcamento" violates SELECT * FROM x');
      const traduzido = traduzirErroDeProxy(erro);
      const corpo = traduzido?.paraCorpo();

      expect(traduzido?.status).toBe(422);
      expect(corpo?.codigo).toBe('REGRA_DE_NEGOCIO');
      expect(corpo?.mensagem).toBe(CATALOGO_DE_ERROS.REGRA_DE_NEGOCIO.mensagem);
      expect(JSON.stringify(corpo)).not.toMatch(/SELECT|relation|DROP|orcamento/);
      expect(traduzido?.cause).toBe(erro);
      if (detalhes === undefined) {
        expect(corpo?.detalhes).toBeUndefined();
      }
      if (caso === 'código sem mapeamento') {
        expect(corpo?.detalhes).toEqual(detalhes);
      }
    },
  );
});
