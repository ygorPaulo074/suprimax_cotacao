import {
  AppError,
  CATALOGO_DE_ERROS,
  ErroDeValidacao,
  ErroInterno,
  ErroNaoEncontrado,
  normalizarErro,
} from './erros';

const MENSAGEM_INTERNA = CATALOGO_DE_ERROS.INTERNAL_ERROR.mensagem;

describe('AppError', () => {
  it.each([
    ['VALIDATION_ERROR', 400],
    ['NOT_FOUND', 404],
    ['PAYLOAD_TOO_LARGE', 413],
    ['INTERNAL_ERROR', 500],
  ] as const)('%s responde %i com a mensagem do catálogo', (codigo, status) => {
    const erro = new AppError(codigo);

    expect(erro.status).toBe(status);
    expect(erro.paraCorpo()).toEqual({ codigo, mensagem: CATALOGO_DE_ERROS[codigo].mensagem });
  });

  it('aceita mensagem específica e detalhes em código do catálogo', () => {
    const erro = new AppError('NOT_FOUND', {
      mensagem: 'Cliente não encontrado.',
      detalhes: { cnpj: '00.000.000/0001-00' },
    });

    expect(erro.paraCorpo()).toEqual({
      codigo: 'NOT_FOUND',
      mensagem: 'Cliente não encontrado.',
      detalhes: { cnpj: '00.000.000/0001-00' },
    });
  });

  it('transforma código fora do catálogo em INTERNAL_ERROR, sem a mensagem nem os detalhes', () => {
    const erro = new AppError('CODIGO_SEM_ENTRADA', {
      mensagem: 'mensagem não revisada',
      detalhes: { tabela: 'operador' },
    });

    expect(erro.status).toBe(500);
    expect(erro.codigoOriginal).toBe('CODIGO_SEM_ENTRADA');
    expect(erro.paraCorpo()).toEqual({ codigo: 'INTERNAL_ERROR', mensagem: MENSAGEM_INTERNA });
  });
});

describe('subclasses', () => {
  it.each([
    [new ErroDeValidacao(), 'VALIDATION_ERROR', 400, 'ErroDeValidacao'],
    [new ErroNaoEncontrado(), 'NOT_FOUND', 404, 'ErroNaoEncontrado'],
    [new ErroInterno(), 'INTERNAL_ERROR', 500, 'ErroInterno'],
  ])('%s', (erro, codigo, status, nome) => {
    expect(erro).toBeInstanceOf(AppError);
    expect([erro.codigo, erro.status, erro.name]).toEqual([codigo, status, nome]);
  });

  it('ErroInterno guarda a causa, mas não a expõe no corpo', () => {
    const causa = new Error('relation "operador" does not exist');
    const erro = new ErroInterno(causa);

    expect(erro.cause).toBe(causa);
    expect(JSON.stringify(erro.paraCorpo())).not.toContain('operador');
  });
});

describe('normalizarErro', () => {
  it('devolve o próprio AppError', () => {
    const erro = new ErroNaoEncontrado();

    expect(normalizarErro(erro)).toBe(erro);
  });

  it.each([[new Error('falha do driver')], ['texto solto'], [undefined]])(
    'embrulha %p em ErroInterno',
    (valor) => {
      const erro = normalizarErro(valor);

      expect(erro).toBeInstanceOf(ErroInterno);
      expect(erro.cause).toBe(valor);
      expect(erro.paraCorpo()).toEqual({ codigo: 'INTERNAL_ERROR', mensagem: MENSAGEM_INTERNA });
    },
  );
});
