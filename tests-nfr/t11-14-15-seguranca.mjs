// RNF01 (11) e RNF05 (14, 15). Uso: node tests-nfr/t11-14-15-seguranca.mjs <roles|replay|ratelimit>
// roles:     precisa de backend + proxy no ar e do seed de demonstracao.
// replay:    exige PROXY_SERVICE_ID e PROXY_SERVICE_TOKEN no ambiente (de backend/.env local de teste).
// ratelimit: suba o proxy SEM RATE_LIMIT_MAXIMO (padrao 300/min) antes de rodar; DIRECT_URL local para achar um orcamento.
import { chamar, login, banco, PROXY, resumo } from './lib.mjs';

const modo = process.argv[2];
const out = {};

if (modo === 'roles') {
  const usuarios = { chefe: 'OPERADOR_CHEFE', operador: 'OPERADOR', vendedor1: 'VENDEDOR', fiscal: 'FISCAL', financeiro: 'FINANCEIRO', gestor: 'GESTOR' };
  // [rota, metodo, perfis permitidos (o resto deve receber 403)]
  const rotas = [
    ['/dividas', 'GET', ['FINANCEIRO']],
    ['/analises-credito', 'GET', ['FISCAL']],
    ['/estoque/variacoes', 'GET', ['OPERADOR_CHEFE']],
    ['/indicadores', 'GET', ['GESTOR']],
    ['/usuarios', 'GET', ['OPERADOR_CHEFE']],
    ['/jobs/executar', 'POST', ['GESTOR']],
    ['/orcamentos', 'GET', ['OPERADOR', 'OPERADOR_CHEFE']],
    ['/pedidos', 'GET', ['OPERADOR', 'OPERADOR_CHEFE']],
  ];
  const tokens = {};
  for (const u of Object.keys(usuarios)) tokens[u] = await login(u);
  const linhas = [];
  let violacoes = 0;
  for (const [rota, metodo, ok] of rotas) {
    for (const [u, perfil] of Object.entries(usuarios)) {
      const r = await chamar(metodo, rota, { token: tokens[u], corpo: metodo === 'POST' ? {} : undefined });
      const permitido = ok.includes(perfil);
      const bom = permitido ? r.status !== 403 && r.status !== 401 : r.status === 403;
      if (!bom) violacoes++;
      linhas.push({ rota: `${metodo} ${rota}`, usuario: u, perfil, esperado: permitido ? 'nao 403' : '403', status: r.status, codigo: r.corpo?.codigo, ok: bom });
    }
    const s = await chamar(metodo, rota, { corpo: metodo === 'POST' ? {} : undefined });
    if (s.status !== 401) violacoes++;
    linhas.push({ rota: `${metodo} ${rota}`, usuario: '(sem token)', esperado: '401', status: s.status, ok: s.status === 401 });
  }
  out.roles = { totalChecagens: linhas.length, violacoes, falhas: linhas.filter((l) => !l.ok), amostra403: linhas.filter((l) => l.status === 403).length };
}

if (modo === 'replay') {
  const id = process.env.PROXY_SERVICE_ID, token = process.env.PROXY_SERVICE_TOKEN;
  if (!id || !token) throw new Error('Defina PROXY_SERVICE_ID e PROXY_SERVICE_TOKEN.');
  const corpo = JSON.stringify({ operacao: 'dados.consultar', payload: { tabela: 'cliente', limite: 1 } });
  const enviar = async (ts, opId) => {
    const r = await fetch(PROXY + '/executar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Service-Id': id, 'X-Timestamp': ts, 'X-Operation-Id': opId },
      body: corpo,
    });
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, codigo: j?.erro?.codigo ?? (j?.ok ? 'OK' : undefined) };
  };
  const agora = new Date();
  const ts = agora.toISOString();
  out.primeira = await enviar(ts, crypto.randomUUID());
  out.replayMesmoCorpoMesmoTimestamp = await enviar(ts, crypto.randomUUID());
  out.timestampMais120sNoPassado = await enviar(new Date(agora.getTime() - 120000).toISOString(), crypto.randomUUID());
  out.timestampMais120sNoFuturo = await enviar(new Date(agora.getTime() + 120000).toISOString(), crypto.randomUUID());
  out.timestampIlegivel = await enviar('abc', crypto.randomUUID());
  out.novoTimestampValido = await enviar(new Date(agora.getTime() + 1).toISOString(), crypto.randomUUID());
}

if (modo === 'ratelimit') {
  const db = await banco();
  const token = await login('operador');
  const cli = (await db.query('SELECT id_cliente FROM cliente LIMIT 1')).rows[0].id_cliente;
  const criado = await chamar('POST', '/orcamentos', { token, corpo: { idCliente: cli } });
  const id = criado.corpo.idOrcamento ?? criado.corpo.id;
  const seq = [];
  let primeiro503 = null;
  for (let i = 1; i <= 40; i++) {
    const r = await chamar('GET', `/orcamentos/${id}`, { token });
    seq.push(r.status);
    if (r.status !== 200 && primeiro503 === null) primeiro503 = { requisicao: i, status: r.status, corpo: r.corpo, ms: Math.round(r.ms) };
  }
  const contagem = {};
  for (const s of seq) contagem[s] = (contagem[s] ?? 0) + 1;
  out.ratelimit = { totalGETs: 40, contagemPorStatus: contagem, primeiraFalha: primeiro503, sequencia: seq.join(',') };
  await db.end();
}
resumo(`seguranca/${modo}`, out);
