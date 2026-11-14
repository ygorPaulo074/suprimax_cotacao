#!/usr/bin/env node
// Gera as variáveis de ambiente de todos os serviços (e dos Sistemas 1 e 3) de uma só vez.
//
// Uso (a partir de qualquer pasta):
//   node scripts/gerar-env.cjs [opções]
//
// Saída: <pasta deste script>/<codename>_<timestamp>_<versao>/
//   proxy.env, database.env, backend.env, frontend.env, sistema1.env, sistema3.env,
//   integrantes.sql (registra os 3 integrantes no banco) e LEIA-ME.md (para onde cada arquivo vai).
//
// Opções (ou variáveis de ambiente com o mesmo nome em MAIÚSCULAS e "_"):
//   --codename <nome>          padrão: suprimax
//   --versao <rótulo>          padrão: v1
//   --dias <n>                 validade dos tokens dos integrantes (padrão: 180)
//   --env <dev|homologacao|producao>   padrão: dev
//   --proxy-url <url>          URL do proxy vista pelo backend (padrão: http://localhost:3001)
//   --proxy-url-publica <url>  URL do proxy vista pelos Sistemas 1 e 3 (padrão: igual a --proxy-url)
//   --supabase-url <url>       https://<ref>.supabase.co
//   --supabase-service-role-key <chave>
//   --database-url <url>       pooler, porta 6543 (runtime do proxy)
//   --direct-url <url>         conexão direta ou Session pooler, porta 5432 (migrations)
//   --resend-api-key <chave>
//
// O que o Supabase fornece e o script não consegue inventar fica como PREENCHER.
// Só usa módulos nativos do Node: não precisa de npm install.

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// ---------- opções ----------
const OPCOES = {
  codename: 'suprimax',
  versao: 'v1',
  dias: '180',
  env: 'dev',
  'proxy-url': 'http://localhost:3001',
  'proxy-url-publica': '',
  'supabase-url': '',
  'supabase-service-role-key': '',
  'database-url': '',
  'direct-url': '',
  'resend-api-key': '',
};

function lerOpcoes(argv) {
  const o = { ...OPCOES };
  for (const nome of Object.keys(o)) {
    const doAmbiente = process.env[nome.toUpperCase().replace(/-/g, '_')];
    if (doAmbiente) o[nome] = doAmbiente;
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`argumento inesperado: ${a}`);
    const nome = a.slice(2);
    if (!(nome in o)) throw new Error(`opção desconhecida: ${a}`);
    const valor = argv[++i];
    if (valor === undefined || valor.startsWith('--')) throw new Error(`falta o valor de ${a}`);
    o[nome] = valor;
  }
  if (!['dev', 'homologacao', 'producao'].includes(o.env)) {
    throw new Error('--env deve ser dev, homologacao ou producao');
  }
  const dias = Number(o.dias);
  if (!Number.isInteger(dias) || dias <= 0) throw new Error('--dias deve ser inteiro positivo');
  if (!/^[A-Za-z0-9-]+$/.test(o.codename) || !/^[A-Za-z0-9.-]+$/.test(o.versao)) {
    throw new Error('--codename e --versao aceitam só letras, números, "-" (e "." na versão)');
  }
  o.dias = dias;
  o['proxy-url'] = o['proxy-url'].replace(/\/+$/, '');
  o['proxy-url-publica'] = (o['proxy-url-publica'] || o['proxy-url']).replace(/\/+$/, '');
  return o;
}

// ---------- tokens (mesmo formato de proxy/src/auth/token.ts: JWT HS256) ----------
const b64url = (buf) => Buffer.from(buf).toString('base64url');

function emitirToken(segredo, { serviceId, escopos, exp }) {
  const cabecalho = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const corpo = b64url(
    JSON.stringify({
      service_id: serviceId,
      escopos,
      origens: [],
      exp,
      iat: Math.floor(Date.now() / 1000),
    }),
  );
  const assinatura = crypto
    .createHmac('sha256', segredo)
    .update(`${cabecalho}.${corpo}`)
    .digest('base64url');
  return `${cabecalho}.${corpo}.${assinatura}`;
}

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

// ---------- escopos iniciais (docs/12-proxy.md, seção 12.8.5) ----------
function tabelasDoDicionario() {
  const caminho = path.resolve(__dirname, '../docs/banco-de-dados/dicionario-de-dados.json');
  const json = JSON.parse(fs.readFileSync(caminho, 'utf8'));
  return [...new Set(json.colunas.map((c) => c.tabela))];
}

function escoposPorSistema(tabelas) {
  const consultar = (ts) => ts.map((t) => `${t}:consultar`);
  return {
    'sistema2-backend': [
      '*:consultar',
      'operador.credenciais:consultar',
      '*:inserir',
      '*:atualizar',
      'item_orcamento:excluir',
      'anexo_orcamento:excluir',
      'endereco_cliente:excluir',
      'orcamento:excluir',
      'operacao:pedido.assumir',
      'operacao:orcamento.emitir',
      'operacao:resposta.processar',
      'rpc:*',
    ],
    'sistema1-backend': [
      ...consultar([
        'cliente',
        'endereco_cliente',
        'produto',
        'variacao_produto',
        'faixa_preco',
        'fardo',
        'orcamento',
        'item_orcamento',
        'historico_orcamento',
        'resposta_orcamento',
        'item_resposta_orcamento',
        'pedido',
        'item_pedido',
        'operador',
        'analise_credito',
      ]),
      'pedido:inserir',
      'pedido:atualizar',
      'item_pedido:inserir',
      'resposta_orcamento:inserir',
      'item_resposta_orcamento:inserir',
      'historico_orcamento:inserir',
    ],
    // O escopo só soma permissões (não há "exceto"): por isso a lista explícita, sem documento_analise_credito.
    'sistema3-painel': consultar(tabelas.filter((t) => t !== 'documento_analise_credito')),
  };
}

// ---------- montagem ----------
const PREENCHER = 'PREENCHER';

function bloco(titulo, linhas) {
  const corpo = linhas
    .map((l) => (Array.isArray(l) ? `${l[0]}=${l[1]}` : l))
    .join('\n');
  return `# ${titulo}\n${corpo}\n`;
}

function main() {
  const o = lerOpcoes(process.argv.slice(2));
  const agora = new Date();
  const exp = Math.floor(agora.getTime() / 1000) + o.dias * 86400;
  const expiraEm = new Date(exp * 1000);

  const pad = (n) => String(n).padStart(2, '0');
  const carimbo =
    `${agora.getFullYear()}${pad(agora.getMonth() + 1)}${pad(agora.getDate())}` +
    `${pad(agora.getHours())}${pad(agora.getMinutes())}${pad(agora.getSeconds())}`;
  const pasta = path.join(__dirname, `${o.codename}_${carimbo}_${o.versao}`);
  if (fs.existsSync(pasta)) throw new Error(`a pasta já existe: ${pasta}`);

  const segredoJwt = crypto.randomBytes(32).toString('hex'); // 64 caracteres (mínimo exigido: 32)
  const chaveMestra = crypto.randomBytes(24).toString('hex'); // 48 caracteres (mínimo: 16)

  const escopos = escoposPorSistema(tabelasDoDicionario());
  const integrantes = Object.entries(escopos).map(([nome, esc]) => {
    const serviceId = crypto.randomUUID();
    const token = emitirToken(segredoJwt, { serviceId, escopos: esc, exp });
    return { nome, serviceId, token, escopos: esc, hash: hashToken(token) };
  });
  const por = Object.fromEntries(integrantes.map((i) => [i.nome, i]));

  const arquivos = {};

  arquivos['proxy.env'] = [
    bloco('proxy/.env — docs/12-proxy.md, seção 12.3', [
      ['ENV', o.env],
      ['PORT', '3001'],
      ['SUPABASE_URL', o['supabase-url'] || PREENCHER],
      ['SUPABASE_SERVICE_ROLE_KEY', o['supabase-service-role-key'] || PREENCHER],
      '# Pooler (Transaction), porta 6543.',
      ['DATABASE_URL', o['database-url'] || PREENCHER],
      '# Gerados por este script. Quem rotacionar o JWT_SIGNING_SECRET invalida todos os tokens.',
      ['PROXY_ADMIN_KEY', chaveMestra],
      ['JWT_SIGNING_SECRET', segredoJwt],
      '# Opcionais:',
      '# TOLERANCIA_TIMESTAMP_SEGUNDOS=60',
      '# RATE_LIMIT_JANELA_SEGUNDOS=60',
      '# RATE_LIMIT_MAXIMO=300',
    ]),
  ].join('\n');

  arquivos['database.env'] = bloco(
    'backend/database/.env — só para aplicar migrations (npm run migrate:deploy)',
    [
      '# Conexão direta ou Session pooler, porta 5432. Nunca a 6543 (Transaction pooler).',
      ['DIRECT_URL', o['direct-url'] || PREENCHER],
    ],
  );

  arquivos['backend.env'] = bloco('backend/.env — Sistema 2', [
    ['ENV', o.env],
    ['PORT', '3000'],
    ['LOG_LEVEL', 'info'],
    ['CORS_ORIGENS', 'http://localhost:5173'],
    ['SESSAO_INATIVIDADE_MINUTOS', '30'],
    ['TRUST_PROXY', '0'],
    ['PROXY_URL', o['proxy-url']],
    ['PROXY_SERVICE_ID', por['sistema2-backend'].serviceId],
    ['PROXY_SERVICE_TOKEN', por['sistema2-backend'].token],
    ['RESEND_API_KEY', o['resend-api-key'] || PREENCHER],
  ]);

  arquivos['frontend.env'] = bloco('frontend/.env — Sistema 2', [
    ['VITE_API_URL', 'http://localhost:3000'],
  ]);

  const paraSistema = (titulo, i) =>
    bloco(titulo, [
      '# O proxy é o único ponto de acesso ao banco. Envie cada requisição com os headers',
      '# Authorization: Bearer <token>, X-Service-Id, X-Timestamp e X-Operation-Id (docs/12, 12.3).',
      ['PROXY_URL', o['proxy-url-publica']],
      ['PROXY_SERVICE_ID', i.serviceId],
      ['PROXY_SERVICE_TOKEN', i.token],
      `# Token válido até ${expiraEm.toISOString()}`,
    ]);
  arquivos['sistema1.env'] = paraSistema(
    'Sistema 1 (Força de Vendas) — backend próprio do Sistema 1',
    por['sistema1-backend'],
  );
  arquivos['sistema3.env'] = paraSistema(
    'Sistema 3 (Painel Gerencial) — somente leitura',
    por['sistema3-painel'],
  );

  const aspas = (s) => s.replace(/'/g, "''");
  arquivos['integrantes.sql'] =
    `-- Registra os integrantes no banco (tabela integrantes_proxy). Rode uma vez, depois do migrate:deploy.\n` +
    `-- Guarda só o hash do token. Equivale a chamar integrante.criar no proxy.\n` +
    `BEGIN;\n` +
    integrantes
      .map(
        (i) =>
          `INSERT INTO integrantes_proxy (id, nome_sistema, chave_hash, escopos, ativo, criado_em, expira_em)\n` +
          `VALUES ('${i.serviceId}', '${aspas(i.nome)}', '${i.hash}',\n` +
          `  ARRAY[${i.escopos.map((e) => `'${aspas(e)}'`).join(', ')}],\n` +
          `  true, now(), '${expiraEm.toISOString()}');`,
      )
      .join('\n') +
    `\nCOMMIT;\n`;

  arquivos['LEIA-ME.md'] = `# ${o.codename} · ${carimbo} · ${o.versao}

Gerado em ${agora.toISOString()}. Tokens válidos até ${expiraEm.toISOString()}. Contém segredos.

| Arquivo | Copie para | Quem usa |
|---|---|---|
| \`proxy.env\` | \`proxy/.env\` | proxy |
| \`database.env\` | \`backend/database/.env\` | migrations (Prisma) |
| \`backend.env\` | \`backend/.env\` | backend do Sistema 2 |
| \`frontend.env\` | \`frontend/.env\` | frontend do Sistema 2 |
| \`sistema1.env\` | enviar ao responsável pelo Sistema 1 | backend do Sistema 1 |
| \`sistema3.env\` | enviar ao responsável pelo Sistema 3 | painel (leitura) |
| \`integrantes.sql\` | rodar no SQL Editor do Supabase | registra os 3 tokens |

Campos \`${PREENCHER}\` vêm do Supabase (Connect e Project Settings → API).

## Ordem
1. Preencha os \`${PREENCHER}\` e copie os arquivos.
2. \`cd backend/database && npm run migrate:deploy\`
3. Rode \`integrantes.sql\` no banco. Sem isso o proxy recusa os tokens.
4. Suba o proxy (porta 3001), depois o backend (3000) e o frontend (5173).

Os Sistemas 1 e 3 precisam de uma \`PROXY_URL\` pública (proxy no Render). Gere de novo com
\`--proxy-url-publica https://...\` quando ela existir. Gerar de novo cria segredos novos: todos os
arquivos da pasta anterior ficam inválidos juntos.
`;

  fs.mkdirSync(pasta);
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    fs.writeFileSync(path.join(pasta, nome), conteudo, 'utf8');
  }

  const faltando = Object.entries(arquivos).filter(([, c]) => c.includes(`=${PREENCHER}`));
  console.log(`Gerado em ${pasta}`);
  for (const nome of Object.keys(arquivos)) console.log(`  ${nome}`);
  if (faltando.length) {
    console.log(`\nCampos "${PREENCHER}" a completar em: ${faltando.map(([n]) => n).join(', ')}`);
  }
}

try {
  main();
} catch (e) {
  console.error(`Erro: ${e.message}`);
  process.exit(1);
}
