// RNF09 - testes 1, 2 e 3. Uso: DIRECT_URL=postgresql://...@127.0.0.1:.../... node tests-nfr/t01-03-concorrencia.mjs
import { banco, chamar, login, montarOrcamento, resumo } from './lib.mjs';

const db = await banco();
const tokens = [await login('chefe'), await login('operador')];
const tk = (i) => tokens[i % tokens.length];
const { rows: clientes } = await db.query('SELECT id_cliente FROM cliente ORDER BY id_cliente');
const { rows: vars } = await db.query('SELECT id_variacao, quantidade_estoque FROM variacao_produto ORDER BY id_variacao');
const v0 = vars[0].id_variacao;
const contar = (res) => {
  const c = {};
  for (const x of res) { const k = `${x.status}${x.corpo?.codigo ? ' ' + x.corpo.codigo : ''}`; c[k] = (c[k] ?? 0) + 1; }
  return c;
};
const r = {};

// ---- Teste 1: 10 operadores simultaneos emitindo orcamentos ----
{
  const N = 10, RODADAS = 3;
  let emitidos = 0;
  const falhas = [];
  for (let rod = 0; rod < RODADAS; rod++) {
    const ids = [];
    for (let i = 0; i < N; i++) ids.push(await montarOrcamento(tk(i), clientes[i % clientes.length].id_cliente, [{ idVariacao: v0, quantidade: 1 }]));
    const res = await Promise.all(ids.map((id, i) => chamar('POST', `/orcamentos/${id}/emitir`, { token: tk(i) })));
    for (const x of res) x.status === 200 ? emitidos++ : falhas.push({ status: x.status, corpo: x.corpo });
  }
  const dup = await db.query('SELECT numero_orcamento, count(*) c FROM orcamento WHERE numero_orcamento IS NOT NULL GROUP BY 1 HAVING count(*)>1');
  const tot = await db.query('SELECT count(*) c, count(DISTINCT numero_orcamento) d FROM orcamento WHERE numero_orcamento IS NOT NULL');
  r.t1 = { tentativas: N * RODADAS, emitidos, falhas, numerosDuplicados: dup.rows.length, orcamentosNumerados: +tot.rows[0].c, numerosDistintos: +tot.rows[0].d };
}

// ---- Teste 2: pedido.assumir simultaneo no mesmo pedido ----
{
  const vend = await db.query("SELECT id_operador FROM operador WHERE usuario='vendedor1'");
  const p = await db.query("INSERT INTO pedido (id_cliente,id_operador_vendedor,status) VALUES ($1,$2,'SOLICITADO') RETURNING id_pedido", [clientes[0].id_cliente, vend.rows[0].id_operador]);
  await db.query("INSERT INTO item_pedido (id_pedido,id_variacao,granularidade,quantidade_solicitada) VALUES ($1,$2,'AVULSO',1)", [p.rows[0].id_pedido, v0]);
  const res = await Promise.all(Array.from({ length: 10 }, (_, i) => chamar('POST', `/pedidos/${p.rows[0].id_pedido}/assumir`, { token: tk(i) })));
  const fim = await db.query('SELECT status,id_operador_atendimento FROM pedido WHERE id_pedido=$1', [p.rows[0].id_pedido]);
  r.t2 = { requisicoes: 10, resultados: contar(res), estadoFinal: fim.rows[0] };
}

// ---- Teste 3: reservas concorrentes no mesmo produto (RN17) ----
{
  const v = await db.query('SELECT quantidade_estoque FROM variacao_produto WHERE id_variacao=$1', [v0]);
  const saldo = v.rows[0].quantidade_estoque;
  const qtd = Math.ceil(saldo / 4); // 10 orcamentos x saldo/4: so ~4 cabem
  const ids = [];
  const erros = [];
  for (let i = 0; i < 10; i++) {
    try { ids.push(await montarOrcamento(tk(i), clientes[i % clientes.length].id_cliente, [{ idVariacao: v0, quantidade: qtd }])); }
    catch (e) { erros.push(e.message); }
  }
  const res = await Promise.all(ids.map((id, i) => chamar('POST', `/orcamentos/${id}/emitir`, { token: tk(i) })));
  const s = await db.query("SELECT COALESCE(sum(r.quantidade_reservada),0) AS reservado FROM reserva_estoque r JOIN item_orcamento i ON i.id_item=r.id_item WHERE i.id_variacao=$1 AND r.status='CONFIRMADA'", [v0]);
  const s2 = await db.query('SELECT quantidade_estoque FROM variacao_produto WHERE id_variacao=$1', [v0]);
  r.t3 = { saldoInicial: saldo, quantidadePorOrcamento: qtd, erroNaCriacao: erros, resultados: contar(res), totalReservado: +s.rows[0].reservado, saldoColuna: s2.rows[0].quantidade_estoque };
}
resumo('RNF09 concorrencia', r);
await db.end();
