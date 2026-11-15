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
const EMPRESA = {
  EMPRESA_RAZAO_SOCIAL: 'SupriMax Distribuidora Ltda.',
  EMPRESA_ENDERECO: 'Av. Exemplo, 1000 — Centro — Cidade/UF — 11111-111',
  EMPRESA_TELEFONE: '(11) 1111-1111',
  EMPRESA_CNPJ: '11.111.111/0001-11',
  EMPRESA_INSCRICAO_ESTADUAL: '111.111.111.111',
  EMPRESA_PIX: 'financeiro@suprimax.com.br',
  EMPRESA_DADOS_BANCARIOS: 'Banco Exemplo — Agência 0001 — Conta 123456-7',
};
const PRODUCAO = { ENV: 'producao', CORS_ORIGENS: ORIGEM_REAL, ...PROXY, ...EMPRESA };
const VARIAVEIS_OBRIGATORIAS_FORA_DE_DEV = [
  'CORS_ORIGENS',
  'PROXY_URL',
  'PROXY_SERVICE_ID',
  'PROXY_SERVICE_TOKEN',
  'EMPRESA_RAZAO_SOCIAL',
  'EMPRESA_ENDERECO',
  'EMPRESA_TELEFONE',
  'EMPRESA_CNPJ',
  'EMPRESA_INSCRICAO_ESTADUAL',
  'EMPRESA_PIX',
  'EMPRESA_DADOS_BANCARIOS',
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
      jobsAgendadosHabilitados: false,
      jobsAgendadosIntervaloMs: 60 * 60 * 1000,
      empresaEmissora: {
        razaoSocial: '(completar EMPRESA_RAZAO_SOCIAL)',
        endereco: '(completar EMPRESA_ENDERECO)',
        telefone: '(completar EMPRESA_TELEFONE)',
        cnpj: '(completar EMPRESA_CNPJ)',
        inscricaoEstadual: '(completar EMPRESA_INSCRICAO_ESTADUAL)',
        pix: '(completar EMPRESA_PIX)',
        dadosBancarios: '(completar EMPRESA_DADOS_BANCARIOS)',
      },
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
      JOBS_AGENDADOS_HABILITADOS: 'true',
      JOBS_AGENDADOS_INTERVALO_MINUTOS: '30',
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
      jobsAgendadosHabilitados: true,
      jobsAgendadosIntervaloMs: 30 * 60 * 1000,
      empresaEmissora: {
        razaoSocial: EMPRESA.EMPRESA_RAZAO_SOCIAL,
        endereco: EMPRESA.EMPRESA_ENDERECO,
        telefone: EMPRESA.EMPRESA_TELEFONE,
        cnpj: EMPRESA.EMPRESA_CNPJ,
        inscricaoEstadual: EMPRESA.EMPRESA_INSCRICAO_ESTADUAL,
        pix: EMPRESA.EMPRESA_PIX,
        dadosBancarios: EMPRESA.EMPRESA_DADOS_BANCARIOS,
      },
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
    ['JOBS_AGENDADOS_HABILITADOS', 'sim'],
    ['JOBS_AGENDADOS_HABILITADOS', '1'],
    ['JOBS_AGENDADOS_INTERVALO_MINUTOS', '0'],
    ['JOBS_AGENDADOS_INTERVALO_MINUTOS', '1441'],
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

  describe('empresa emissora (PDF de orçamento, item 10)', () => {
    it('em dev, sem as variáveis, usa placeholders óbvios', () => {
      const config = carregarConfig({});

      expect(config.empresaEmissora).toEqual({
        razaoSocial: '(completar EMPRESA_RAZAO_SOCIAL)',
        endereco: '(completar EMPRESA_ENDERECO)',
        telefone: '(completar EMPRESA_TELEFONE)',
        cnpj: '(completar EMPRESA_CNPJ)',
        inscricaoEstadual: '(completar EMPRESA_INSCRICAO_ESTADUAL)',
        pix: '(completar EMPRESA_PIX)',
        dadosBancarios: '(completar EMPRESA_DADOS_BANCARIOS)',
      });
    });

    it('lê as sete variáveis quando informadas', () => {
      const config = carregarConfig(EMPRESA);

      expect(config.empresaEmissora).toEqual({
        razaoSocial: EMPRESA.EMPRESA_RAZAO_SOCIAL,
        endereco: EMPRESA.EMPRESA_ENDERECO,
        telefone: EMPRESA.EMPRESA_TELEFONE,
        cnpj: EMPRESA.EMPRESA_CNPJ,
        inscricaoEstadual: EMPRESA.EMPRESA_INSCRICAO_ESTADUAL,
        pix: EMPRESA.EMPRESA_PIX,
        dadosBancarios: EMPRESA.EMPRESA_DADOS_BANCARIOS,
      });
    });
  });

  describe('jobs agendados (item 9)', () => {
    it('vem desligado por padrão, com intervalo de 60 minutos', () => {
      const config = carregarConfig({});

      expect(config.jobsAgendadosHabilitados).toBe(false);
      expect(config.jobsAgendadosIntervaloMs).toBe(60 * 60 * 1000);
    });

    it('liga com JOBS_AGENDADOS_HABILITADOS=true e aceita um intervalo próprio', () => {
      const config = carregarConfig({
        JOBS_AGENDADOS_HABILITADOS: 'true',
        JOBS_AGENDADOS_INTERVALO_MINUTOS: '15',
      });

      expect(config.jobsAgendadosHabilitados).toBe(true);
      expect(config.jobsAgendadosIntervaloMs).toBe(15 * 60 * 1000);
    });

    it('aceita JOBS_AGENDADOS_HABILITADOS=false explicitamente', () => {
      expect(carregarConfig({ JOBS_AGENDADOS_HABILITADOS: 'false' }).jobsAgendadosHabilitados).toBe(
        false,
      );
    });
  });
});
