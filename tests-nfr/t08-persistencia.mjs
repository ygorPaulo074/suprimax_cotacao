// RNF04 - teste 8: grava rascunho, (voce reinicia backend e proxy), relê e compara.
// Uso: node tests-nfr/t08-persistencia.mjs gravar ; tests-nfr/subir-ambiente.sh parar ; tests-nfr/subir-ambiente.sh ;
//      node tests-nfr/t08-persistencia.mjs ler      (precisa de DIRECT_URL local so para escolher o cliente)
import { writeFileSync, readFileSync } from 'node:fs';
import { chamar, login, banco, montarOrcamento, resumo } from './lib.mjs';

const ARQ = new URL('./.estado-t08.json', import.meta.url);
const modo = process.argv[2];
const sem = (d) => JSON.stringify({ ...d, historico: undefined });

if (modo === 'gravar') {
  const db = await banco();
  const cli = (await db.query('SELECT id_cliente FROM cliente ORDER BY id_cliente LIMIT 1')).rows[0].id_cliente;
  const vars = (await db.query('SELECT id_variacao FROM variacao_produto ORDER BY id_variacao LIMIT 2')).rows;
  const token = await login('operador');
  const id = await montarOrcamento(token, cli, vars.map((v, i) => ({ idVariacao: v.id_variacao, quantidade: 3 + i })));
  const p = await chamar('PATCH', `/orcamentos/${id}`, { token, corpo: { numeroSolicitacaoCompra: 'TNF-8', contatoSolicitacao: 'Contato TNF' } });
  const d = await chamar('GET', `/orcamentos/${id}`, { token });
  writeFileSync(ARQ, JSON.stringify({ id, token, detalhe: d.corpo }));
  resumo('gravado', { id, patch: p.status, status: d.corpo.status, itens: d.corpo.itens?.length, total: d.corpo.condicoes?.valorTotalItens });
  await db.end();
} else if (modo === 'ler') {
  const est = JSON.parse(readFileSync(ARQ, 'utf8'));
  const velho = await chamar('GET', `/orcamentos/${est.id}`, { token: est.token });
  const token = await login('operador');
  const d = await chamar('GET', `/orcamentos/${est.id}`, { token });
  resumo('apos reinicio', {
    tokenAntigoAposReinicio: velho.status,
    rascunhoRelido: d.status,
    identico: sem(d.corpo) === sem(est.detalhe),
    status: d.corpo.status,
    itens: d.corpo.itens?.length,
    total: d.corpo.condicoes?.valorTotalItens,
    contato: d.corpo.contatoSolicitacao,
  });
}
