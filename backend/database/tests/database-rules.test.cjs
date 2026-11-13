const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
require('dotenv/config');
const { Client } = require('pg');

const connectionString = process.env.TEST_DATABASE_URL;
const enabled = Boolean(connectionString);
let db;

function assertSafeTestDatabase(value) {
  const url = new URL(value);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) || !database.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL precisa apontar para localhost e banco terminado em _test.');
  }
}

before(async () => {
  if (!enabled) return;
  assertSafeTestDatabase(connectionString);
  db = new Client({ connectionString });
  await db.connect();
});

after(async () => {
  await db?.end();
});

async function withRollback(callback) {
  await db.query('BEGIN');
  try {
    await callback();
  } finally {
    await db.query('ROLLBACK');
  }
}

async function createFixture({ stock = 0 } = {}) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const op = await db.query(
    `INSERT INTO operador(usuario,email,senha_hash,perfil)
     VALUES ($1,$2,'test-hash','OPERADOR_CHEFE') RETURNING id_operador`,
    [`test-${suffix}`, `test-${suffix}@example.test`],
  );
  const client = await db.query(
    `INSERT INTO cliente(cnpj,razao_social,nome_contato,tipo_unidade,id_operador_vendedor,aceite_lgpd,data_aceite_lgpd)
     VALUES ($1,$2,'Contato de Teste','MATRIZ',$3,TRUE,CURRENT_TIMESTAMP) RETURNING id_cliente`,
    [`${String(Date.now()).padStart(14, '0').slice(-14)}`, `Cliente ${suffix}`, op.rows[0].id_operador],
  );
  const product = await db.query(
    `INSERT INTO produto(codigo_interno,descricao) VALUES ($1,'Produto de teste') RETURNING id_produto`,
    [`TEST-${suffix.slice(-24)}`],
  );
  const variation = await db.query(
    `INSERT INTO variacao_produto(id_produto,marca,tamanho_embalagem,quantidade_estoque)
     VALUES ($1,'Marca Teste','1 unidade',$2) RETURNING id_variacao`,
    [product.rows[0].id_produto, stock],
  );
  const tier = await db.query(
    `INSERT INTO faixa_preco(id_variacao,quantidade_minima,preco_unitario)
     VALUES ($1,1,1.00) RETURNING id_faixa_preco`,
    [variation.rows[0].id_variacao],
  );
  const quote = await db.query(
    `INSERT INTO orcamento(id_cliente,id_operador,condicao_pagamento,modalidade_frete)
     VALUES ($1,$2,'ADIANTADO_100','FOB') RETURNING id_orcamento`,
    [client.rows[0].id_cliente, op.rows[0].id_operador],
  );
  const item = await db.query(
    `INSERT INTO item_orcamento
       (id_orcamento,id_variacao,granularidade,id_faixa_preco,quantidade_avulsa,preco_unitario_aplicado,valor_imposto,valor_total_item)
     VALUES ($1,$2,'AVULSO',$3,2,1.00,0.36,2.36) RETURNING id_item`,
    [quote.rows[0].id_orcamento, variation.rows[0].id_variacao, tier.rows[0].id_faixa_preco],
  );
  return {
    operatorId: op.rows[0].id_operador,
    clientId: client.rows[0].id_cliente,
    variationId: variation.rows[0].id_variacao,
    quoteId: quote.rows[0].id_orcamento,
    itemId: item.rows[0].id_item,
  };
}

test('migração instala as 25 tabelas e ativa RLS sem políticas', { skip: !enabled }, async () => {
  const result = await db.query(`
    SELECT COUNT(*)::INTEGER AS total
    FROM pg_tables
    WHERE schemaname='public'
      AND tablename IN (
        'operador','cliente','endereco_cliente','produto','variacao_produto','faixa_preco','fardo',
        'orcamento','item_orcamento','reserva_estoque','anexo_orcamento','analise_credito',
        'documento_analise_credito','divida_inadimplencia','historico_orcamento','entrada_mercadoria',
        'fornecedor','pedido','item_pedido','resposta_orcamento','item_resposta_orcamento',
        'movimentacao_estoque','integrantes_proxy','fila_escrita','log_auditoria'
      )
  `);
  assert.equal(result.rows[0].total, 25);
  const rls = await db.query(`
    SELECT COUNT(*)::INTEGER AS total FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public'
      AND c.relname IN (
        'operador','cliente','endereco_cliente','produto','variacao_produto','faixa_preco','fardo',
        'orcamento','item_orcamento','reserva_estoque','anexo_orcamento','analise_credito',
        'documento_analise_credito','divida_inadimplencia','historico_orcamento','entrada_mercadoria',
        'fornecedor','pedido','item_pedido','resposta_orcamento','item_resposta_orcamento',
        'movimentacao_estoque','integrantes_proxy','fila_escrita','log_auditoria'
      ) AND c.relrowsecurity
  `);
  assert.equal(rls.rows[0].total, 25);
  const policies = await db.query(`
    SELECT COUNT(*)::INTEGER AS total FROM pg_policies
    WHERE schemaname='public'
      AND tablename IN (
        'operador','cliente','endereco_cliente','produto','variacao_produto','faixa_preco','fardo',
        'orcamento','item_orcamento','reserva_estoque','anexo_orcamento','analise_credito',
        'documento_analise_credito','divida_inadimplencia','historico_orcamento','entrada_mercadoria',
        'fornecedor','pedido','item_pedido','resposta_orcamento','item_resposta_orcamento',
        'movimentacao_estoque','integrantes_proxy','fila_escrita','log_auditoria'
      )
  `);
  assert.equal(policies.rows[0].total, 0);
});

test('rejeita perfil de operador fora da lista aprovada', { skip: !enabled }, async () => {
  await withRollback(async () => {
    await assert.rejects(
      db.query(`INSERT INTO operador(usuario,email,senha_hash,perfil) VALUES ('invalid-role','invalid-role@example.test','hash','ROOT')`),
      (error) => error.code === '23514',
    );
  });
});

test('rejeita quantidade de estoque negativa', { skip: !enabled }, async () => {
  await withRollback(async () => {
    const product = await db.query(`INSERT INTO produto(codigo_interno,descricao) VALUES ('TEST-NEG-STOCK','Teste') RETURNING id_produto`);
    await assert.rejects(
      db.query(`INSERT INTO variacao_produto(id_produto,marca,tamanho_embalagem,quantidade_estoque) VALUES ($1,'M','1 un',-1)`, [product.rows[0].id_produto]),
      (error) => error.code === '23514',
    );
  });
});

test('bloqueia emissão sem saldo e mantém o rascunho intacto', { skip: !enabled }, async () => {
  await withRollback(async () => {
    const fixture = await createFixture({ stock: 0 });
    await db.query('SAVEPOINT before_emit');
    await assert.rejects(
      db.query(`SELECT * FROM public.proxy_orcamento_emitir($1,$2,'test-security-key')`, [fixture.quoteId, fixture.operatorId]),
      (error) => error.message.startsWith('ESTOQUE_INSUFICIENTE:'),
    );
    await db.query('ROLLBACK TO SAVEPOINT before_emit');
    const quote = await db.query('SELECT status,numero_orcamento FROM orcamento WHERE id_orcamento=$1', [fixture.quoteId]);
    assert.equal(quote.rows[0].status, 'RASCUNHO');
    assert.equal(quote.rows[0].numero_orcamento, null);
    const reservations = await db.query('SELECT COUNT(*)::INTEGER AS total FROM reserva_estoque WHERE id_item=$1', [fixture.itemId]);
    assert.equal(reservations.rows[0].total, 0);
  });
});

test('impede abrir orçamento para cliente com dívida em aberto', { skip: !enabled }, async () => {
  await withRollback(async () => {
    const fixture = await createFixture();
    await db.query(
      `INSERT INTO divida_inadimplencia(id_cliente,id_operador_registro,valor_divida,data_vencimento_original)
       VALUES ($1,$2,100.00,CURRENT_DATE)`,
      [fixture.clientId, fixture.operatorId],
    );
    await assert.rejects(
      db.query(`INSERT INTO orcamento(id_cliente,id_operador) VALUES ($1,$2)`, [fixture.clientId, fixture.operatorId]),
      (error) => error.message === 'CLIENTE_INADIMPLENTE',
    );
  });
});
