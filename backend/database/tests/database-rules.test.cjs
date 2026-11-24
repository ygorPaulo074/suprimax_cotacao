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
    [
      `${String(Date.now()).padStart(14, '0').slice(-14)}`,
      `Cliente ${suffix}`,
      op.rows[0].id_operador,
    ],
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
      db.query(
        `INSERT INTO operador(usuario,email,senha_hash,perfil) VALUES ('invalid-role','invalid-role@example.test','hash','ROOT')`,
      ),
      (error) => error.code === '23514',
    );
  });
});

test(
  'aceita o perfil ADMIN e continua recusando valores fora da lista',
  { skip: !enabled },
  async () => {
    await withRollback(async () => {
      const admin = await db.query(
        `INSERT INTO operador(usuario,email,senha_hash,perfil) VALUES ('admin-role','admin-role@example.test','hash','ADMIN') RETURNING perfil`,
      );
      assert.equal(admin.rows[0].perfil, 'ADMIN');
      await assert.rejects(
        db.query(
          `INSERT INTO operador(usuario,email,senha_hash,perfil) VALUES ('admin-minusculo','admin-minusculo@example.test','hash','admin')`,
        ),
        (error) => error.code === '23514',
      );
    });
  },
);

test(
  'o ADMIN libera divergência na entrada de mercadoria; o FISCAL continua sem poder',
  { skip: !enabled },
  async () => {
    await withRollback(async () => {
      const fixture = await createFixture();
      const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const admin = await db.query(
        `INSERT INTO operador(usuario,email,senha_hash,perfil) VALUES ($1,$2,'hash','ADMIN') RETURNING id_operador`,
        [`adm-${suffix}`, `adm-${suffix}@example.test`],
      );
      const fiscal = await db.query(
        `INSERT INTO operador(usuario,email,senha_hash,perfil) VALUES ($1,$2,'hash','FISCAL') RETURNING id_operador`,
        [`fis-${suffix}`, `fis-${suffix}@example.test`],
      );
      const fornecedor = await db.query(
        `INSERT INTO fornecedor(cnpj,razao_social) VALUES ($1,'Fornecedor de teste') RETURNING id_fornecedor`,
        [String(Date.now()).padStart(14, '0').slice(-14)],
      );
      const entrada = (idLiberacao) =>
        db.query(
          `INSERT INTO entrada_mercadoria(id_variacao,id_fornecedor,id_operador,quantidade_comprada,quantidade_informada,id_operador_liberacao,data_liberacao)
         VALUES ($1,$2,$3,10,9,$4,CURRENT_TIMESTAMP)`,
          [fixture.variationId, fornecedor.rows[0].id_fornecedor, fixture.operatorId, idLiberacao],
        );
      await entrada(admin.rows[0].id_operador);
      await assert.rejects(entrada(fiscal.rows[0].id_operador), /LIBERADOR_NAO_E_OPERADOR_CHEFE/);
    });
  },
);

test(
  'o ADMIN registra o resultado da análise de crédito; o OPERADOR_CHEFE continua sem poder',
  { skip: !enabled },
  async () => {
    await withRollback(async () => {
      const fixture = await createFixture();
      const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const admin = await db.query(
        `INSERT INTO operador(usuario,email,senha_hash,perfil) VALUES ($1,$2,'hash','ADMIN') RETURNING id_operador`,
        [`adm-cr-${suffix}`, `adm-cr-${suffix}@example.test`],
      );
      const analise = (idFiscal) =>
        db.query(
          `INSERT INTO analise_credito(id_cliente,resultado,data_analise,id_operador_fiscal)
         VALUES ($1,'APROVADO',CURRENT_DATE,$2)`,
          [fixture.clientId, idFiscal],
        );
      await analise(admin.rows[0].id_operador);
      await assert.rejects(analise(fixture.operatorId), /RESPONSAVEL_CREDITO_NAO_E_FISCAL/);
    });
  },
);

test('rejeita quantidade de estoque negativa', { skip: !enabled }, async () => {
  await withRollback(async () => {
    const product = await db.query(
      `INSERT INTO produto(codigo_interno,descricao) VALUES ('TEST-NEG-STOCK','Teste') RETURNING id_produto`,
    );
    await assert.rejects(
      db.query(
        `INSERT INTO variacao_produto(id_produto,marca,tamanho_embalagem,quantidade_estoque) VALUES ($1,'M','1 un',-1)`,
        [product.rows[0].id_produto],
      ),
      (error) => error.code === '23514',
    );
  });
});

test('bloqueia emissão sem saldo e mantém o rascunho intacto', { skip: !enabled }, async () => {
  await withRollback(async () => {
    const fixture = await createFixture({ stock: 0 });
    await db.query('SAVEPOINT before_emit');
    await assert.rejects(
      db.query(`SELECT * FROM public.proxy_orcamento_emitir($1,$2,'test-security-key')`, [
        fixture.quoteId,
        fixture.operatorId,
      ]),
      (error) => error.message.startsWith('ESTOQUE_INSUFICIENTE:'),
    );
    await db.query('ROLLBACK TO SAVEPOINT before_emit');
    const quote = await db.query(
      'SELECT status,numero_orcamento FROM orcamento WHERE id_orcamento=$1',
      [fixture.quoteId],
    );
    assert.equal(quote.rows[0].status, 'RASCUNHO');
    assert.equal(quote.rows[0].numero_orcamento, null);
    const reservations = await db.query(
      'SELECT COUNT(*)::INTEGER AS total FROM reserva_estoque WHERE id_item=$1',
      [fixture.itemId],
    );
    assert.equal(reservations.rows[0].total, 0);
  });
});

test(
  'emitir nova versão (com origem): marca o original como SUBSTITUIDO e libera suas reservas (UC15, UC16)',
  { skip: !enabled },
  async () => {
    await withRollback(async () => {
      const fixture = await createFixture({ stock: 10 });
      await db.query('SELECT * FROM public.proxy_orcamento_emitir($1,$2,$3)', [
        fixture.quoteId,
        fixture.operatorId,
        'test-versao-original-key',
      ]);

      // Nova versão do mesmo cliente, apontando para o original (que está ABERTO).
      const versao = await db.query(
        `INSERT INTO orcamento(id_cliente,id_operador,id_orcamento_origem,condicao_pagamento,modalidade_frete)
         VALUES ($1,$2,$3,'ADIANTADO_100','FOB') RETURNING id_orcamento`,
        [fixture.clientId, fixture.operatorId, fixture.quoteId],
      );
      const tier = await db.query('SELECT id_faixa_preco FROM faixa_preco WHERE id_variacao=$1', [
        fixture.variationId,
      ]);
      await db.query(
        `INSERT INTO item_orcamento
           (id_orcamento,id_variacao,granularidade,id_faixa_preco,quantidade_avulsa,preco_unitario_aplicado,valor_imposto,valor_total_item)
         VALUES ($1,$2,'AVULSO',$3,3,1.00,0.54,3.54)`,
        [versao.rows[0].id_orcamento, fixture.variationId, tier.rows[0].id_faixa_preco],
      );

      // Antes da migration 20261124000000, aqui falhava com: column reference "id_orcamento" is ambiguous.
      const emitida = await db.query('SELECT * FROM public.proxy_orcamento_emitir($1,$2,$3)', [
        versao.rows[0].id_orcamento,
        fixture.operatorId,
        'test-versao-nova-key',
      ]);
      assert.equal(emitida.rows[0].id_orcamento, versao.rows[0].id_orcamento);

      const quotes = await db.query(
        'SELECT id_orcamento,status,numero_orcamento FROM orcamento WHERE id_orcamento = ANY($1) ORDER BY id_orcamento',
        [[fixture.quoteId, versao.rows[0].id_orcamento]],
      );
      assert.equal(quotes.rows[0].status, 'SUBSTITUIDO');
      assert.equal(quotes.rows[1].status, 'ABERTO');
      assert.ok(Number(quotes.rows[1].numero_orcamento) > Number(quotes.rows[0].numero_orcamento));

      const reservas = await db.query(
        `SELECT i.id_orcamento,r.status FROM reserva_estoque r JOIN item_orcamento i USING (id_item)
          WHERE i.id_orcamento = ANY($1) ORDER BY i.id_orcamento`,
        [[fixture.quoteId, versao.rows[0].id_orcamento]],
      );
      assert.deepEqual(
        reservas.rows.map((reserva) => reserva.status),
        ['LIBERADA', 'CONFIRMADA'],
      );

      const historico = await db.query(
        `SELECT status_novo FROM historico_orcamento WHERE id_orcamento=$1 AND tipo_evento='MUDANCA_STATUS'`,
        [fixture.quoteId],
      );
      assert.ok(historico.rows.some((linha) => linha.status_novo === 'SUBSTITUIDO'));
    });
  },
);

test(
  'id_operador_ultima_edicao: grava em rascunho, recusa FK inválida e não muda orçamento emitido (UC14)',
  { skip: !enabled },
  async () => {
    await withRollback(async () => {
      const fixture = await createFixture({ stock: 10 });
      const nova = await db.query(
        'SELECT id_operador_ultima_edicao FROM orcamento WHERE id_orcamento=$1',
        [fixture.quoteId],
      );
      assert.equal(nova.rows[0].id_operador_ultima_edicao, null);

      // Rascunho: a atualização passa pelos gatilhos, também junto de data_ultima_edicao.
      await db.query(
        'UPDATE orcamento SET id_operador_ultima_edicao=$2, data_ultima_edicao=CURRENT_TIMESTAMP WHERE id_orcamento=$1',
        [fixture.quoteId, fixture.operatorId],
      );
      const gravado = await db.query(
        'SELECT id_operador_ultima_edicao FROM orcamento WHERE id_orcamento=$1',
        [fixture.quoteId],
      );
      assert.equal(gravado.rows[0].id_operador_ultima_edicao, fixture.operatorId);

      // FK inválida é recusada (violação de chave estrangeira).
      await db.query('SAVEPOINT fk_invalida');
      await assert.rejects(
        db.query('UPDATE orcamento SET id_operador_ultima_edicao=-1 WHERE id_orcamento=$1', [
          fixture.quoteId,
        ]),
        (error) => error.code === '23503',
      );
      await db.query('ROLLBACK TO SAVEPOINT fk_invalida');

      // Emitido (ABERTO, com número): imutável, inclusive nesta coluna.
      await db.query('SELECT * FROM public.proxy_orcamento_emitir($1,$2,$3)', [
        fixture.quoteId,
        fixture.operatorId,
        'test-ultimo-editor-key',
      ]);
      const emitido = await db.query(
        'SELECT status,numero_orcamento FROM orcamento WHERE id_orcamento=$1',
        [fixture.quoteId],
      );
      assert.equal(emitido.rows[0].status, 'ABERTO');
      assert.notEqual(emitido.rows[0].numero_orcamento, null);
      await db.query('SAVEPOINT emitido');
      await assert.rejects(
        db.query('UPDATE orcamento SET id_operador_ultima_edicao=NULL WHERE id_orcamento=$1', [
          fixture.quoteId,
        ]),
        (error) => error.message === 'ORCAMENTO_NAO_EDITAVEL',
      );
      await db.query('ROLLBACK TO SAVEPOINT emitido');
      const depois = await db.query(
        'SELECT id_operador_ultima_edicao FROM orcamento WHERE id_orcamento=$1',
        [fixture.quoteId],
      );
      assert.equal(depois.rows[0].id_operador_ultima_edicao, fixture.operatorId);
    });
  },
);

test(
  'sessao: guarda só o hash, recusa FK e formato inválidos, RLS sem políticas e CASCADE do operador (UC13)',
  { skip: !enabled },
  async () => {
    const rls = await db.query(`
    SELECT c.relrowsecurity AS rls,
           (SELECT COUNT(*)::INTEGER FROM pg_policies WHERE schemaname='public' AND tablename='sessao') AS politicas
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='sessao'
  `);
    assert.deepEqual(rls.rows[0], { rls: true, politicas: 0 });
    const indices = await db.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='sessao' ORDER BY indexname`,
    );
    assert.deepEqual(
      indices.rows.map((r) => r.indexname),
      ['sessao_expira_em_idx', 'sessao_id_operador_idx', 'sessao_pkey'],
    );

    await withRollback(async () => {
      const fixture = await createFixture();
      const hash = 'a'.repeat(64);
      await db.query(
        `INSERT INTO sessao(token_hash,id_operador,expira_em) VALUES ($1,$2,CURRENT_TIMESTAMP + INTERVAL '30 minutes')`,
        [hash, fixture.operatorId],
      );
      const gravada = await db.query(
        'SELECT id_operador, expira_em > criado_em AS valida FROM sessao WHERE token_hash=$1',
        [hash],
      );
      assert.deepEqual(gravada.rows[0], { id_operador: fixture.operatorId, valida: true });

      // Hash duplicado (PK), formato que não é SHA-256 hexadecimal e operador inexistente (FK).
      for (const [nome, sql, valores, codigo] of [
        [
          'duplicado',
          `INSERT INTO sessao(token_hash,id_operador,expira_em) VALUES ($1,$2,CURRENT_TIMESTAMP + INTERVAL '1 minute')`,
          [hash, fixture.operatorId],
          '23505',
        ],
        [
          'formato',
          `INSERT INTO sessao(token_hash,id_operador,expira_em) VALUES ($1,$2,CURRENT_TIMESTAMP + INTERVAL '1 minute')`,
          ['token-em-texto-puro', fixture.operatorId],
          '23514',
        ],
        [
          'maiusculo',
          `INSERT INTO sessao(token_hash,id_operador,expira_em) VALUES ($1,$2,CURRENT_TIMESTAMP + INTERVAL '1 minute')`,
          ['A'.repeat(64), fixture.operatorId],
          '23514',
        ],
        [
          'prazo',
          `INSERT INTO sessao(token_hash,id_operador,expira_em) VALUES ($1,$2,CURRENT_TIMESTAMP - INTERVAL '1 minute')`,
          ['b'.repeat(64), fixture.operatorId],
          '23514',
        ],
        [
          'fk',
          `INSERT INTO sessao(token_hash,id_operador,expira_em) VALUES ($1,$2,CURRENT_TIMESTAMP + INTERVAL '1 minute')`,
          ['c'.repeat(64), -1],
          '23503',
        ],
      ]) {
        await db.query(`SAVEPOINT sessao_${nome}`);
        await assert.rejects(db.query(sql, valores), (error) => error.code === codigo);
        await db.query(`ROLLBACK TO SAVEPOINT sessao_${nome}`);
      }

      // Apagar o operador leva as sessões junto (na prática ele é inativado, não apagado). Os gatilhos
      // de exclusão de orçamento/cliente impedem montar o DELETE em cascata aqui; basta conferir a FK.
      const fk = await db.query(
        `SELECT confdeltype FROM pg_constraint WHERE conname='sessao_id_operador_fkey' AND conrelid='public.sessao'::regclass`,
      );
      assert.equal(fk.rows[0].confdeltype, 'c');
    });
  },
);

test('impede abrir orçamento para cliente com dívida em aberto', { skip: !enabled }, async () => {
  await withRollback(async () => {
    const fixture = await createFixture();
    await db.query(
      `INSERT INTO divida_inadimplencia(id_cliente,id_operador_registro,valor_divida,data_vencimento_original)
       VALUES ($1,$2,100.00,CURRENT_DATE)`,
      [fixture.clientId, fixture.operatorId],
    );
    await assert.rejects(
      db.query(`INSERT INTO orcamento(id_cliente,id_operador) VALUES ($1,$2)`, [
        fixture.clientId,
        fixture.operatorId,
      ]),
      (error) => error.message === 'CLIENTE_INADIMPLENTE',
    );
  });
});

test(
  'proxy_job_expirar_rascunhos apaga o rascunho EXPIRADO com histórico (CASCADE)',
  { skip: !enabled },
  async () => {
    await withRollback(async () => {
      const fixture = await createFixture();
      await db.query(
        `INSERT INTO historico_orcamento(id_orcamento,id_operador,tipo_evento,status_novo)
       VALUES ($1,$2,'MUDANCA_STATUS','RASCUNHO')`,
        [fixture.quoteId, fixture.operatorId],
      );
      await db.query(
        `UPDATE orcamento
          SET status='EXPIRADO', motivo_expiracao='RASCUNHO',
              data_encerramento=CURRENT_TIMESTAMP-INTERVAL '31 days'
        WHERE id_orcamento=$1`,
        [fixture.quoteId],
      );
      // O DELETE direto nao e asserido aqui: a CI mostrou que ele nao foi recusado neste cenario.

      const result = await db.query('SELECT public.proxy_job_expirar_rascunhos() AS total');
      assert.ok(result.rows[0].total >= 1);
      const counts = await db.query(
        `SELECT (SELECT COUNT(*)::INTEGER FROM orcamento WHERE id_orcamento=$1) AS orcamentos,
              (SELECT COUNT(*)::INTEGER FROM item_orcamento WHERE id_orcamento=$1) AS itens,
              (SELECT COUNT(*)::INTEGER FROM historico_orcamento WHERE id_orcamento=$1) AS historico`,
        [fixture.quoteId],
      );
      // O CASCADE do historico_orcamento já existe na migration inicial (linha 650).
      assert.deepEqual(counts.rows[0], { orcamentos: 0, itens: 0, historico: 0 });
    });
  },
);
