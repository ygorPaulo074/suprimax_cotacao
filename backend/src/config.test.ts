import {
  carregarConfig,
  ConfigInvalidaError,
  NIVEL_LOG_PADRAO,
  ORIGENS_CORS_PADRAO_DEV,
  PORTA_PADRAO,
} from './config';

const ORIGEM_REAL = 'https://cotacao.suprimax.com.br';
const PROXY = {
  PROXY_URL: 'https://proxy.suprimax.com.br/',
  PROXY_SERVICE_ID: 'sistema2-backend',
  PROXY_SERVICE_TOKEN: 'eyJhbGciOi.abc.def',
};
const PRODUCAO = { ENV: 'producao', CORS_ORIGENS: ORIGEM_REAL, ...PROXY };
const VARIAVEIS_OBRIGATORIAS_FORA_DE_DEV = [
  'CORS_ORIGENS',
  'PROXY_URL',
  'PROXY_SERVICE_ID',
  'PROXY_SERVICE_TOKEN',
];

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
      sessaoInatividadeMs: 30 * 60 * 1000,
      trustProxy: 0,
    });
  });

  it('trata variável vazia como ausente', () => {
    expect(carregarConfig({ PORT: '', LOG_LEVEL: '   ' }).porta).toBe(PORTA_PADRAO);
  });

  it('lê uma configuração completa de produção', () => {
    const config = carregarConfig({
      ...PRODUCAO,
      PORT: '8080',
      LOG_LEVEL: 'warn',
      CORS_ORIGENS: `${ORIGEM_REAL}, https://suprimax.vercel.app`,
      SESSAO_INATIVIDADE_MINUTOS: '15',
      TRUST_PROXY: '1',
    });

    expect(config).toEqual({
      ambiente: 'producao',
      porta: 8080,
      nivelLog: 'warn',
      corsOrigens: [ORIGEM_REAL, 'https://suprimax.vercel.app'],
      sessaoInatividadeMs: 15 * 60 * 1000,
      trustProxy: 1,
      proxyUrl: 'https://proxy.suprimax.com.br',
      proxyServiceId: 'sistema2-backend',
      proxyServiceToken: 'eyJhbGciOi.abc.def',
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
    ['PROXY_URL', 'proxy.suprimax.com.br'],
    ['PROXY_URL', 'ftp://proxy.suprimax.com.br'],
    ['PROXY_SERVICE_ID', 'sistema 2'],
    ['PROXY_SERVICE_TOKEN', 'token com espaco'],
    ['SESSAO_INATIVIDADE_MINUTOS', '0'],
    ['SESSAO_INATIVIDADE_MINUTOS', '1441'],
    ['SESSAO_INATIVIDADE_MINUTOS', 'meia hora'],
    ['TRUST_PROXY', '11'],
    ['TRUST_PROXY', 'true'],
  ])('recusa %s=%s', (variavel, valor) => {
    expect(capturarErro({ [variavel]: valor }).variaveis).toEqual([variavel]);
  });

  it.each(['homologacao', 'producao'])('exige CORS e acesso ao proxy em %s', (ambiente) => {
    expect(capturarErro({ ENV: ambiente }).variaveis).toEqual(VARIAVEIS_OBRIGATORIAS_FORA_DE_DEV);
  });

  it.each(['http://localhost:5173', 'https://exemplo.com', 'https://CHANGEME.suprimax.com'])(
    'recusa valor de exemplo em produção: %s',
    (origem) => {
      expect(capturarErro({ ...PRODUCAO, CORS_ORIGENS: origem }).variaveis).toEqual([
        'CORS_ORIGENS',
      ]);
    },
  );

  it('aceita valor de exemplo fora de produção', () => {
    const config = carregarConfig({
      ...PRODUCAO,
      ENV: 'homologacao',
      CORS_ORIGENS: 'http://localhost:5173',
    });

    expect(config.corsOrigens).toEqual(['http://localhost:5173']);
  });

  describe('acesso ao proxy', () => {
    it('é opcional em dev: sem as variáveis, a configuração não traz os campos', () => {
      const config = carregarConfig({});

      expect(config).not.toHaveProperty('proxyUrl');
      expect(config).not.toHaveProperty('proxyServiceId');
      expect(config).not.toHaveProperty('proxyServiceToken');
    });

    it('lê as três variáveis e tira a barra final da URL', () => {
      expect(carregarConfig(PROXY)).toMatchObject({
        proxyUrl: 'https://proxy.suprimax.com.br',
        proxyServiceId: 'sistema2-backend',
        proxyServiceToken: 'eyJhbGciOi.abc.def',
      });
    });

    it.each([
      ['PROXY_URL', 'http://localhost:3001'],
      ['PROXY_SERVICE_ID', 'exemplo-de-id'],
      ['PROXY_SERVICE_TOKEN', 'changeme'],
    ])('recusa valor de exemplo em produção: %s', (variavel, valor) => {
      const erro = capturarErro({ ...PRODUCAO, [variavel]: valor });

      expect(erro.variaveis).toEqual([variavel]);
      expect(erro.message).not.toContain(valor);
    });
  });

  it('lista todas as variáveis inválidas de uma vez, sem os valores recebidos', () => {
    const erro = capturarErro({
      ENV: 'producao',
      PORT: 'porta-secreta-123',
      LOG_LEVEL: 'nivel-secreto-456',
    });

    expect(erro.variaveis).toEqual(['PORT', 'LOG_LEVEL', ...VARIAVEIS_OBRIGATORIAS_FORA_DE_DEV]);
    expect(erro.message).not.toContain('porta-secreta-123');
    expect(erro.message).not.toContain('nivel-secreto-456');
  });
});
