// Variáveis de ambiente do proxy (docs/12, seção 12.3). Falha cedo se algo essencial faltar.

export interface Config {
  env: 'dev' | 'homologacao' | 'producao';
  porta: number;
  /** Conexão Postgres do Supabase (pooler). Necessária para executar SQL parametrizado. */
  databaseUrl: string | null;
  supabaseUrl: string | null;
  supabaseServiceRoleKey: string | null;
  proxyAdminKey: string;
  jwtSigningSecret: string;
  toleranciaTimestampSegundos: number;
  rateLimitJanelaSegundos: number;
  rateLimitMaximo: number;
}

const ENVS = ['dev', 'homologacao', 'producao'] as const;

function inteiro(valor: string | undefined, padrao: number, nome: string): number {
  if (valor === undefined || valor === '') return padrao;
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${nome} deve ser um inteiro positivo`);
  return n;
}

export function carregarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const ambiente = (env.ENV ?? 'dev') as Config['env'];
  if (!ENVS.includes(ambiente)) throw new Error(`ENV deve ser um de: ${ENVS.join(', ')}`);

  const jwtSigningSecret = env.JWT_SIGNING_SECRET ?? '';
  if (jwtSigningSecret.length < 32) {
    throw new Error('JWT_SIGNING_SECRET é obrigatório e deve ter pelo menos 32 caracteres');
  }
  const proxyAdminKey = env.PROXY_ADMIN_KEY ?? '';
  if (proxyAdminKey.length < 16) {
    throw new Error('PROXY_ADMIN_KEY é obrigatório e deve ter pelo menos 16 caracteres');
  }

  return {
    env: ambiente,
    porta: inteiro(env.PORT, 3001, 'PORT'),
    databaseUrl: env.DATABASE_URL || null,
    supabaseUrl: env.SUPABASE_URL || null,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || null,
    proxyAdminKey,
    jwtSigningSecret,
    toleranciaTimestampSegundos: inteiro(
      env.TOLERANCIA_TIMESTAMP_SEGUNDOS,
      60,
      'TOLERANCIA_TIMESTAMP_SEGUNDOS',
    ),
    rateLimitJanelaSegundos: inteiro(
      env.RATE_LIMIT_JANELA_SEGUNDOS,
      60,
      'RATE_LIMIT_JANELA_SEGUNDOS',
    ),
    rateLimitMaximo: inteiro(env.RATE_LIMIT_MAXIMO, 300, 'RATE_LIMIT_MAXIMO'),
  };
}
