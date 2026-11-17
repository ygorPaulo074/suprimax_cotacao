// RNF03 - testes 4, 5 e 6 (busca por CNPJ, calculo de 5 itens, emissao + PDF).
// Uso: DIRECT_URL=postgresql://...@127.0.0.1:.../... node tests-nfr/t04-06-desempenho.mjs
// Servico aquecido (descarta WARMUP primeiras amostras). Requisicoes sequenciais (latencia por usuario).
import { banco, chamar, login, montarOrcamento, estatisticas, resumo } from './lib.mjs';

const N = Number(process.env.N ?? 100);
const N_EMISSAO = Number(process.env.N_EMISSAO ?? 40);
const WARMUP = 10;
const db = await banco();
const token = await login('operador');
const clientes = (await db.query('SELECT id_cliente, cnpj FROM cliente ORDER BY id_cliente')).rows;
const vars = (await db.query('SELECT id_variacao FROM variacao_produto ORDER BY id_variacao')).rows.map((r) => r.id_variacao);
const cinco = vars.slice(1, 6).map((idVariacao) => ({ idVariacao, quantidade: 1 }));
const out = {};

// 4: busca por CNPJ
{
  const a = [];
  let falhas = 0;
  for (let i = 0; i < N + WARMUP; i++) {
    const r = await chamar('GET', `/clientes/busca?cnpj=${clientes[i % clientes.length].cnpj}`, { token });
    if (r.status !== 200) falhas++;
    if (i >= WARMUP) a.push(r.ms);
  }
  out.t4_busca_cnpj = { ...estatisticas(a), falhas, criterioP95ms: 1000 };
}

// 5: calculo do orcamento com 5 itens (GET detalhe recalcula; PUT condicoes grava e recalcula; POST do 5o item)
{
  const idc = clientes[0].id_cliente;
  const id = await montarOrcamento(token, idc, cinco);
  const det = [], cond = [], add = [];
  let falhas = 0;
  for (let i = 0; i < N + WARMUP; i++) {
    const r = await chamar('GET', `/orcamentos/${id}`, { token });
    if (r.status !== 200) falhas++;
    const c = await chamar('PUT', `/orcamentos/${id}/condicoes`, { token, corpo: { condicaoPagamento: 'ADIANTADO_100', origemTransportadora: 'SUPRIMAX' } });
    if (c.status !== 200) falhas++;
    if (i >= WARMUP) { det.push(r.ms); cond.push(c.ms); }
  }
  for (let i = 0; i < 20; i++) {
    const oid = await montarOrcamento(token, idc, cinco.slice(0, 4));
    const r = await chamar('POST', `/orcamentos/${oid}/itens`, { token, corpo: { ...cinco[4], granularidade: 'AVULSO' } });
    if (r.status >= 300) falhas++;
    add.push(r.ms);
  }
  out.t5_calculo_5_itens = {
    get_detalhe_recalcula: estatisticas(det),
    put_condicoes_recalcula: estatisticas(cond),
    post_5o_item: estatisticas(add),
    falhas,
    criterioP95ms: 2000,
  };
}

// 6: emissao + GET /pdf
{
  const em = [], pdf = [], tot = [];
  let falhas = 0, bytes = 0;
  for (let i = 0; i < N_EMISSAO + 5; i++) {
    const id = await montarOrcamento(token, clientes[i % clientes.length].id_cliente, cinco);
    const e = await chamar('POST', `/orcamentos/${id}/emitir`, { token });
    const p = await chamar('GET', `/orcamentos/${id}/pdf`, { token, bruto: true });
    if (e.status !== 200 || p.status !== 200 || !p.corpo.subarray(0, 4).equals(Buffer.from('%PDF'))) { falhas++; if (falhas < 3) console.log('falha', e.status, e.corpo, p.status, String(p.corpo).slice(0, 200)); }
    bytes = p.corpo.length;
    if (i >= 5) { em.push(e.ms); pdf.push(p.ms); tot.push(e.ms + p.ms); }
  }
  out.t6_emissao_pdf = { emissao: estatisticas(em), pdf: estatisticas(pdf), emissao_mais_pdf: estatisticas(tot), tamanhoPdfBytes: bytes, falhas, criterioP95ms: 5000 };
}
resumo('RNF03 desempenho (maquina local)', out);
await db.end();
