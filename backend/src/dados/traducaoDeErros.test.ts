import { ErroDeValidacao, ErroInterno } from '../erros';
import { ErroProxy } from './proxyCliente';
import { traduzirErroDeProxy } from './traducaoDeErros';

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
    ['FALHA_DE_REDE', 503],
    ['TEMPO_ESGOTADO', 504],
    ['CODIGO_NOVO_DO_PROXY', 500],
  ])('%s (%i) vira erro interno, com o erro do proxy como causa', (codigo, status) => {
    const erro = new ErroProxy(status, codigo, 'mensagem do proxy', { interno: true });

    const traduzido = traduzirErroDeProxy(erro);

    expect(traduzido).toBeInstanceOf(ErroInterno);
    expect(traduzido?.cause).toBe(erro);
    expect(JSON.stringify(traduzido?.paraCorpo())).not.toContain('proxy');
  });
});
