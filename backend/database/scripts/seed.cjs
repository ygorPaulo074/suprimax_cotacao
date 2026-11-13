const { Client } = require('pg');

function assertLocalTarget(connectionString) {
  const url = new URL(connectionString);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (!localHosts.has(url.hostname) || !database.endsWith('_dev')) {
    throw new Error('O seed aceita apenas PostgreSQL local com nome terminado em _dev.');
  }
}

async function main() {
  const connectionString = process.env.DIRECT_URL;
  const username = process.env.SEED_OPERATOR_USERNAME;
  const email = process.env.SEED_OPERATOR_EMAIL;
  const passwordHash = process.env.SEED_OPERATOR_PASSWORD_HASH;
  if (!connectionString || !username || !email || !passwordHash) {
    throw new Error('Configure DIRECT_URL e os três valores SEED_OPERATOR_* no .env local.');
  }
  assertLocalTarget(connectionString);

  const db = new Client({ connectionString });
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      `INSERT INTO operador (usuario,email,senha_hash,perfil,status)
       VALUES ($1,$2,$3,'OPERADOR_CHEFE','ATIVO')
       ON CONFLICT (usuario) DO NOTHING`,
      [username, email, passwordHash],
    );
    const user = await db.query('SELECT id_operador,perfil,status FROM operador WHERE usuario=$1', [username]);
    if (!user.rowCount || user.rows[0].perfil !== 'OPERADOR_CHEFE' || user.rows[0].status !== 'ATIVO') {
      throw new Error('O usuário inicial já existe com perfil/status incompatível.');
    }
    const operatorId = user.rows[0].id_operador;

    const sampleClients = [
      ['00000000000001', 'Cliente Exemplo Um Ltda', 'Mercado Exemplo Um'],
      ['00000000000002', 'Cliente Exemplo Dois Ltda', 'Mercado Exemplo Dois'],
    ];
    for (const [cnpj, legalName, tradeName] of sampleClients) {
      await db.query(
        `INSERT INTO cliente
           (cnpj,razao_social,nome_fantasia,nome_contato,tipo_unidade,id_operador_vendedor,aceite_lgpd,data_aceite_lgpd)
         VALUES ($1,$2,$3,'Contato de Exemplo','MATRIZ',$4,TRUE,CURRENT_TIMESTAMP)
         ON CONFLICT (cnpj) DO NOTHING`,
        [cnpj, legalName, tradeName, operatorId],
      );
    }

    const products = [
      { code: 'DEMO-ARROZ', name: 'Arroz Exemplo', brand: 'Marca Exemplo', size: '5 kg', price: '25.00' },
      { code: 'DEMO-FEIJAO', name: 'Feijão Exemplo', brand: 'Marca Exemplo', size: '1 kg', price: '12.50' },
    ];
    for (const product of products) {
      const insertedProduct = await db.query(
        `INSERT INTO produto (codigo_interno,descricao,categoria,ativo)
         VALUES ($1,$2,'Alimentos',TRUE)
         ON CONFLICT (codigo_interno) DO UPDATE SET descricao=EXCLUDED.descricao
         RETURNING id_produto`,
        [product.code, product.name],
      );
      const variation = await db.query(
        `SELECT id_variacao FROM variacao_produto
         WHERE id_produto=$1 AND marca=$2 AND tamanho_embalagem=$3
         ORDER BY id_variacao LIMIT 1`,
        [insertedProduct.rows[0].id_produto, product.brand, product.size],
      );
      let variationId = variation.rows[0]?.id_variacao;
      if (!variationId) {
        const created = await db.query(
          `INSERT INTO variacao_produto (id_produto,marca,tamanho_embalagem)
           VALUES ($1,$2,$3) RETURNING id_variacao`,
          [insertedProduct.rows[0].id_produto, product.brand, product.size],
        );
        variationId = created.rows[0].id_variacao;
      }
      const tiers = [[1, product.price], [4, (Number(product.price) * 0.9).toFixed(2)]];
      for (const [minimum, price] of tiers) {
        await db.query(
          `INSERT INTO faixa_preco (id_variacao,quantidade_minima,preco_unitario)
           SELECT $1,$2,$3 WHERE NOT EXISTS
             (SELECT 1 FROM faixa_preco WHERE id_variacao=$1 AND quantidade_minima=$2)`,
          [variationId, minimum, price],
        );
      }
      await db.query(
        `INSERT INTO fardo (id_variacao,quantidade_unidades,preco_fixo)
         SELECT $1,6,$2 WHERE NOT EXISTS
           (SELECT 1 FROM fardo WHERE id_variacao=$1 AND quantidade_unidades=6)`,
        [variationId, (Number(product.price) * 6 * 0.92).toFixed(2)],
      );
    }
    await db.query('COMMIT');
    process.stdout.write('Seed de desenvolvimento concluído.\n');
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
