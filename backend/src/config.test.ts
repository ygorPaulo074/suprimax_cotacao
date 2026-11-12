import {
  carregarConfig,
  ConfigInvalidaError,
  NIVEL_LOG_PADRAO,
  ORIGENS_CORS_PADRAO_DEV,
  PORTA_PADRAO,
} from './config';

const ORIGEM_REAL = 'https://cotacao.suprimax.com.br';

function capturarErro(env: NodeJS.ProcessEnv): ConfigInvalidaError {
  try {
    carregarConfig(env);
  } catch (erro) {
    if (erro instanceof ConfigInvalidaError) {
      return erro;
    }
    throw erro;
  }
  throw new Error('carregarConfig deveria ter lançado ConfigInvalidaError');
}

describe('carregarConfig', () => {
  it('usa os padrões de desenvolvimento quando nada é informado', () => {
    expect(carregarConfig({})).toEqual({
      ambiente: 'dev',
      porta: PORTA_PADRAO,
      nivelLog: NIVEL_LOG_PADRAO,
      corsOrigens: ORIGENS_CORS_PADRAO_DEV,
    });
  });

  it('trata variável vazia como ausente', () => {
    expect(carregarConfig({ PORT: '', LOG_LEVEL: '   ' }).porta).toBe(PORTA_PADRAO);
  });

  it('lê uma configuração completa de produção', () => {
    const config = carregarConfig({
      ENV: 'producao',
      PORT: '8080',
      LOG_LEVEL: 'warn',
      CORS_ORIGENS: `${ORIGEM_REAL}, https://suprimax.vercel.app`,
    });

    expect(config).toEqual({
      ambiente: 'producao',
      porta: 8080,
      nivelLog: 'warn',
      corsOrigens: [ORIGEM_REAL, 'https://suprimax.vercel.app'],
    });
  });

  it('devolve a configuração imutável', () => {
    expect(Object.isFrozen(carregarConfig({}))).toBe(true);
  });

  it.each([
    ['ENV', 'prod'],
    ['PORT', 'abc'],
    ['PORT', '0'],
    ['PORT', '65536'],
    ['PORT', '3000.5'],
    ['PORT', '-1'],
    ['LOG_LEVEL', 'verbose'],
    ['CORS_ORIGENS', 'nao-e-url'],
    ['CORS_ORIGENS', `${ORIGEM_REAL}/`],
    ['CORS_ORIGENS', `${ORIGEM_REAL}/app`],
    ['CORS_ORIGENS', 'ftp://suprimax.com.br'],
    ['CORS_ORIGENS', ','],
  ])('recusa %s=%s', (variavel, valor) => {
    expect(capturarErro({ [variavel]: valor }).variaveis).toEqual([variavel]);
  });

  it.each(['homologacao', 'producao'])('exige CORS_ORIGENS em %s', (ambiente) => {
    expect(capturarErro({ ENV: ambiente }).variaveis).toEqual(['CORS_ORIGENS']);
  });

  it.each(['http://localhost:5173', 'https://exemplo.com', 'https://CHANGEME.suprimax.com'])(
    'recusa valor de exemplo em produção: %s',
    (origem) => {
      expect(capturarErro({ ENV: 'producao', CORS_ORIGENS: origem }).variaveis).toEqual([
        'CORS_ORIGENS',
      ]);
    },
  );

  it('aceita valor de exemplo fora de produção', () => {
    const config = carregarConfig({ ENV: 'homologacao', CORS_ORIGENS: 'http://localhost:5173' });

    expect(config.corsOrigens).toEqual(['http://localhost:5173']);
  });

  it('lista todas as variáveis inválidas de uma vez, sem os valores recebidos', () => {
    const erro = capturarErro({
      ENV: 'producao',
      PORT: 'porta-secreta-123',
      LOG_LEVEL: 'nivel-secreto-456',
    });

    expect(erro.variaveis).toEqual(['PORT', 'LOG_LEVEL', 'CORS_ORIGENS']);
    expect(erro.message).not.toContain('porta-secreta-123');
    expect(erro.message).not.toContain('nivel-secreto-456');
  });
});
