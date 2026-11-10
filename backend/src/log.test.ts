import {
  criarLogger,
  ehChaveSensivel,
  mascararDadosSensiveis,
  NOME_DO_SERVICO,
  TEXTO_MASCARADO,
} from './log';

describe('ehChaveSensivel', () => {
  it.each([
    'senha',
    'senha_hash',
    'senhaHash',
    'password',
    'token',
    'PROXY_SERVICE_TOKEN',
    'tokenRecuperacaoSenha',
    'Authorization',
    'cookie',
    'JWT_SIGNING_SECRET',
    'RESEND_API_KEY',
    'PROXY_ADMIN_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'chave_seguranca',
  ])('%s é sensível', (chave) => {
    expect(ehChaveSensivel(chave)).toBe(true);
  });

  it.each(['usuario', 'email', 'status', 'requestId', 'rota', 'idOrcamento'])(
    '%s não é sensível',
    (chave) => {
      expect(ehChaveSensivel(chave)).toBe(false);
    },
  );
});

describe('mascararDadosSensiveis', () => {
  it('mascara chave simples e preserva as demais', () => {
    expect(mascararDadosSensiveis({ usuario: 'davi', senha: '123456' })).toEqual({
      usuario: 'davi',
      senha: TEXTO_MASCARADO,
    });
  });

  it('mascara chaves em objetos aninhados e em listas', () => {
    const entrada = {
      requisicao: { cabecalhos: { authorization: 'Bearer abc', aceita: 'json' } },
      tentativas: [{ usuario: 'davi', senha: 'a' }, { token: 'b' }],
    };

    expect(mascararDadosSensiveis(entrada)).toEqual({
      requisicao: { cabecalhos: { authorization: TEXTO_MASCARADO, aceita: 'json' } },
      tentativas: [{ usuario: 'davi', senha: TEXTO_MASCARADO }, { token: TEXTO_MASCARADO }],
    });
  });

  it('não altera o objeto original', () => {
    const entrada = { senha: '123456' };

    mascararDadosSensiveis(entrada);

    expect(entrada.senha).toBe('123456');
  });

  it('suporta referência circular', () => {
    const entrada: Record<string, unknown> = { nome: 'a' };
    entrada.eu = entrada;

    expect(mascararDadosSensiveis(entrada)).toEqual({ nome: 'a', eu: '[CIRCULAR]' });
  });

  it.each([['texto'], [42], [null], [undefined]])('devolve %p como está', (valor) => {
    expect(mascararDadosSensiveis(valor)).toBe(valor);
  });
});

describe('criarLogger', () => {
  function criarColetor(): { linhas: Record<string, unknown>[]; write(linha: string): void } {
    const linhas: Record<string, unknown>[] = [];
    return { linhas, write: (linha) => void linhas.push(JSON.parse(linha)) };
  }

  it('emite JSON com serviço e nível, mascarando dados sensíveis', () => {
    const coletor = criarColetor();
    const logger = criarLogger({ nivel: 'info', destino: coletor });

    logger.info({ usuario: 'davi', dados: { senha: '123456' } }, 'login');

    expect(coletor.linhas).toEqual([
      expect.objectContaining({
        level: 'info',
        servico: NOME_DO_SERVICO,
        msg: 'login',
        usuario: 'davi',
        dados: { senha: TEXTO_MASCARADO },
      }),
    ]);
  });

  it('mascara campos sensíveis de um erro registrado em err', () => {
    const coletor = criarColetor();
    const logger = criarLogger({ nivel: 'info', destino: coletor });
    const causa = Object.assign(new Error('causa'), { senha: '123456' });
    const erro = Object.assign(new Error('falhou', { cause: causa }), {
      token: 'abc',
      codigo: 'X',
    });

    logger.error({ err: erro }, 'erro');

    expect(coletor.linhas[0]?.err).toMatchObject({
      message: 'falhou',
      token: TEXTO_MASCARADO,
      codigo: 'X',
      cause: { message: 'causa', senha: TEXTO_MASCARADO },
    });
  });

  it('respeita o nível configurado', () => {
    const coletor = criarColetor();
    const logger = criarLogger({ nivel: 'warn', destino: coletor });

    logger.info('ignorado');
    logger.warn('registrado');

    expect(coletor.linhas.map((linha) => linha.msg)).toEqual(['registrado']);
  });
});
