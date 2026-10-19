import { carregarConfig } from './config';

const base = {
  JWT_SIGNING_SECRET: 'x'.repeat(32),
  PROXY_ADMIN_KEY: 'chave-admin-1234567',
};

describe('carregarConfig', () => {
  it('aplica padrões', () => {
    const c = carregarConfig(base);
    expect(c).toMatchObject({
      env: 'dev',
      porta: 3001,
      databaseUrl: null,
      toleranciaTimestampSegundos: 60,
    });
  });

  it('lê as variáveis informadas', () => {
    const c = carregarConfig({
      ...base,
      PORT: '8080',
      ENV: 'producao',
      DATABASE_URL: 'postgres://x',
    });
    expect(c).toMatchObject({ porta: 8080, env: 'producao', databaseUrl: 'postgres://x' });
  });

  it('falha sem segredo forte', () => {
    expect(() => carregarConfig({ ...base, JWT_SIGNING_SECRET: 'curto' })).toThrow(
      'JWT_SIGNING_SECRET',
    );
    expect(() => carregarConfig({ ...base, PROXY_ADMIN_KEY: '' })).toThrow('PROXY_ADMIN_KEY');
  });

  it('rejeita ENV e números inválidos', () => {
    expect(() => carregarConfig({ ...base, ENV: 'teste' })).toThrow('ENV');
    expect(() => carregarConfig({ ...base, PORT: 'abc' })).toThrow('PORT');
  });
});
