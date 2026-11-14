import { ErroDeServicoIndisponivel, ErroDeValidacao, ErroInterno } from '../erros';
import { ErroProxy } from './proxyCliente';
import { proxyEmEspera, traduzirErroDeProxy } from './traducaoDeErros';

describe('traduzirErroDeProxy', () => {
  it.each([
    ['NOT_FOUND', 404],
    ['PEDIDO_JA_ASSUMIDO', 409],
    ['ESTOQUE_INSUFICIENTE', 409],
    ['ORCAMENTO_NAO_EDITAVEL', 409],
    ['CHAVE_DUPLICADA', 409],
    ['RESPOSTA_JA_PROCESSADA', 409],
    ['CODIGO_NOVO_DO_PROXY', 409],
  ])('%s (%i) é repassado a quem chamou', (codigo, status) => {
    expect(traduzirErroDeProxy(new ErroProxy(status, codigo, 'mensagem do proxy'))).toBeNull();
  });

  it('PAYLOAD_INVALIDO vira erro de validação, sem a mensagem nem os detalhes do proxy', () => {
    const erro = new ErroProxy(400, 'PAYLOAD_INVALIDO', 'coluna "x" não existe', { tabela: 'x' });

    const traduzido = traduzirErroDeProxy(erro);

    expect(traduzido).toBeInstanceOf(ErroDeValidacao);
    expect(traduzido?.cause).toBe(erro);
    expect(traduzido?.paraCorpo()).toEqual({
      codigo: 'VALIDATION_ERROR',
      mensagem: 'Os dados enviados são inválidos.',
    });
  });

  it.each([
    ['TOKEN_INVALIDO', 401],
    ['ESCOPO_NEGADO', 403],
    ['OPERACAO_DESCONHECIDA', 404],
    ['RISCO_ESTRUTURAL', 422],
    ['LIMITE_EXCEDIDO', 429],
    ['INTERNAL_ERROR', 500],
    ['OPERACAO_NAO_IMPLEMENTADA', 501],
    ['CODIGO_NOVO_DO_PROXY', 500],
  ])('%s (%i) vira erro interno, com o erro do proxy como causa', (codigo, status) => {
    const erro = new ErroProxy(status, codigo, 'mensagem do proxy', { interno: true });

    const traduzido = traduzirErroDeProxy(erro);

    expect(traduzido).toBeInstanceOf(ErroInterno);
    expect(traduzido?.cause).toBe(erro);
    expect(JSON.stringify(traduzido?.paraCorpo())).not.toContain('proxy');
  });

  it.each([
    ['FALHA_DE_REDE', 503, undefined],
    ['TEMPO_ESGOTADO', 504, undefined],
    ['RESPOSTA_INVALIDA', 502, { statusRecebido: 502 }],
    ['RESPOSTA_INVALIDA', 503, { statusRecebido: 503 }],
    ['RESPOSTA_INVALIDA', 504, { statusRecebido: 504 }],
  ])(
    '%s (%i) é proxy em espera: vira serviço indisponível, não erro interno',
    (codigo, status, detalhes) => {
      const erro = new ErroProxy(status, codigo, 'mensagem do cliente', detalhes);

      const traduzido = traduzirErroDeProxy(erro);

      expect(proxyEmEspera(erro)).toBe(true);
      expect(traduzido).toBeInstanceOf(ErroDeServicoIndisponivel);
      expect(traduzido?.cause).toBe(erro);
      expect(traduzido?.paraCorpo()).toMatchObject({ codigo: 'SERVICO_INDISPONIVEL' });
    },
  );

  it.each([
    ['resposta inválida com status 200', 'RESPOSTA_INVALIDA', 200, { statusRecebido: 200 }],
    ['resposta inválida com status 500', 'RESPOSTA_INVALIDA', 500, { statusRecebido: 500 }],
    ['erro do próprio proxy', 'INTERNAL_ERROR', 500, undefined],
  ])('%s não é proxy em espera: continua erro interno', (_caso, codigo, status, detalhes) => {
    const erro = new ErroProxy(status, codigo, 'mensagem', detalhes);

    expect(proxyEmEspera(erro)).toBe(false);
    expect(traduzirErroDeProxy(erro)).toBeInstanceOf(ErroInterno);
  });
});
