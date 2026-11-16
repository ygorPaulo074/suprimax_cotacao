// Utilitarios dos testes nao funcionais (Node >= 20, sem dependencias: usa fetch nativo).
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
const require = createRequire(import.meta.url);

export const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:3000';
export const PROXY = process.env.PROXY_URL ?? 'http://localhost:3001';
export const SENHA = process.env.SENHA_DEMO ?? 'Suprimax@2026';
export const DIRECT_URL = process.env.DIRECT_URL; // Postgres LOCAL de teste (nunca o Supabase real)

export async function banco() {
  if (!DIRECT_URL) throw new Error('Defina DIRECT_URL (Postgres local de teste).');
  if (!/127\.0\.0\.1|localhost/.test(DIRECT_URL)) throw new Error('DIRECT_URL deve ser local.');
  const { Client } = require('../proxy/node_modules/pg');
  const c = new Client({ connectionString: DIRECT_URL });
  await c.connect();
  return c;
}

/** Faz a requisicao e mede a latencia em ms. Devolve { status, corpo, ms }. */
export async function chamar(metodo, caminho, { token, corpo, base = BACKEND, bruto = false, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (corpo !== undefined) h['Content-Type'] = 'application/json';
  const t0 = performance.now();
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: h,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  let dados;
  if (bruto) dados = Buffer.from(await r.arrayBuffer());
  else {
    const t = await r.text();
    try { dados = JSON.parse(t); } catch { dados = t; }
  }
  return { status: r.status, corpo: dados, ms: performance.now() - t0 };
}

export async function login(usuario) {
  const r = await chamar('POST', '/auth/login', { corpo: { usuario, senha: SENHA } });
  if (r.status !== 200) throw new Error(`login ${usuario}: ${r.status} ${JSON.stringify(r.corpo)}`);
  return r.corpo.token;
}

export function estatisticas(amostrasMs) {
  const v = [...amostrasMs].sort((a, b) => a - b);
  const p = (q) => v[Math.min(v.length - 1, Math.ceil(q * v.length) - 1)];
  return { n: v.length, p50: +p(0.5).toFixed(1), p95: +p(0.95).toFixed(1), p99: +p(0.99).toFixed(1), max: +v[v.length - 1].toFixed(1) };
}

/** Pool simples: executa `total` tarefas com `conc` em paralelo. */
export async function carga(total, conc, fn) {
  let i = 0;
  const saida = [];
  await Promise.all(Array.from({ length: conc }, async () => {
    while (i < total) { const k = i++; saida.push(await fn(k)); }
  }));
  return saida;
}

/** Monta um orcamento rascunho completo (cliente, itens, condicoes). Devolve o id. */
export async function montarOrcamento(token, idCliente, itens) {
  const o = await chamar('POST', '/orcamentos', { token, corpo: { idCliente } });
  if (o.status !== 201 && o.status !== 200) throw new Error(`POST /orcamentos ${o.status} ${JSON.stringify(o.corpo)}`);
  const id = o.corpo.idOrcamento ?? o.corpo.id;
  for (const it of itens) {
    const r = await chamar('POST', `/orcamentos/${id}/itens`, {
      token,
      corpo: { idVariacao: it.idVariacao, granularidade: 'AVULSO', quantidade: it.quantidade },
    });
    if (r.status >= 300) throw new Error(`item ${r.status} ${JSON.stringify(r.corpo)}`);
  }
  const c = await chamar('PUT', `/orcamentos/${id}/condicoes`, {
    token,
    corpo: { condicaoPagamento: 'ADIANTADO_100', origemTransportadora: 'SUPRIMAX' },
  });
  if (c.status >= 300) throw new Error(`condicoes ${c.status} ${JSON.stringify(c.corpo)}`);
  return id;
}

export function resumo(titulo, obj) { console.log(`\n== ${titulo} ==\n` + JSON.stringify(obj, null, 2)); }
