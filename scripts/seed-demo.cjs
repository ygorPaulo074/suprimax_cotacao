#!/usr/bin/env node
// Dados FALSOS para apresentar o sistema: um usuário de cada perfil, clientes (com endereços), fornecedores e
// produtos com variações, faixas de preço, fardos e estoque, mais pedidos na fila, um orçamento em
// rascunho incompleto e um orçamento emitido (ABERTO, com PDF). É idempotente: rodar de novo não
// duplica nada (ON CONFLICT DO NOTHING) e não altera o que já existe.
//
// Uso:
//   node scripts/seed-demo.cjs --simular     roda tudo e desfaz (ROLLBACK): só valida, não grava
//   node scripts/seed-demo.cjs --gravar      grava de verdade
//
// Conexão: DIRECT_URL (ou DATABASE_URL) no ambiente; se ausente, lê o DIRECT_URL do database.env
// da pasta gerada mais recente por scripts/gerar-env.cjs. Diferente de backend/database/scripts/seed.cjs
// (que só aceita Postgres local), este script grava no banco indicado: confira o host impresso.
//
// Só usa pg (de proxy/node_modules) e bcryptjs (de backend/node_modules): rode `npm ci` nos dois.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const raiz = path.resolve(__dirname, '..');
const { Client } = require(path.join(raiz, 'proxy/node_modules/pg'));
const bcrypt = require(path.join(raiz, 'backend/node_modules/bcryptjs'));

const SENHA_DEMO = 'Suprimax@2026';
const CUSTO_BCRYPT = 12; // o mesmo do backend (senha.ts)

const OPERADORES = [
  ['chefe', 'OPERADOR_CHEFE'],
  ['operador', 'OPERADOR'],
  ['vendedor1', 'VENDEDOR'],
  ['vendedor2', 'VENDEDOR'],
  ['fiscal', 'FISCAL'],
  ['financeiro', 'FINANCEIRO'],
  ['gestor', 'GESTOR'],
  // ADMIN: acesso total. Usa a mesma senha de demonstração (SENHA_DEMO); NUNCA reutilizar em produção.
  ['adm', 'ADMIN'],
];

// [cnpj, razão social, fantasia, contato, telefone, tipo_unidade, vendedor]
const CLIENTES = [
  ['11222333000181', 'Mercearia Boa Esperança Ltda', 'Mercearia Boa Esperança', 'Marta Souza', '11911110001', 'MATRIZ', 'vendedor1'],
  ['22333444000172', 'Restaurante Sabor da Terra Ltda', 'Sabor da Terra', 'Paulo Lima', '11911110002', 'MATRIZ', 'vendedor1'],
  ['33444555000163', 'Padaria Pão Quente Eireli', 'Pão Quente', 'Ana Ribeiro', '11911110003', 'MATRIZ', 'vendedor2'],
  ['44555666000154', 'Hotel Vista Verde S.A.', 'Hotel Vista Verde', 'Carlos Nunes', '11911110004', 'MATRIZ', 'vendedor2'],
  ['44555666000235', 'Hotel Vista Verde S.A. - Filial', 'Hotel Vista Verde Filial', 'Júlia Alves', '11911110005', 'FILIAL', 'vendedor2'],
];

// Endereços dos clientes de demonstração: todos têm o cadastral; alguns, também um de entrega
// (é o que a montagem do orçamento oferece em "Endereço de entrega").
// [cnpj, tipo, logradouro, número, complemento, bairro, cidade, uf, cep]
const ENDERECOS = [
  ['11222333000181', 'CADASTRAL', 'Rua das Flores', '120', null, 'Centro', 'São Paulo', 'SP', '01010000'],
  ['11222333000181', 'ENTREGA', 'Avenida Brasil', '4500', 'Galpão 2', 'Vila Industrial', 'Guarulhos', 'SP', '07090000'],
  ['22333444000172', 'CADASTRAL', 'Rua Augusta', '980', 'Loja 1', 'Consolação', 'São Paulo', 'SP', '01304000'],
  ['22333444000172', 'ENTREGA', 'Rua do Comércio', '15', 'Fundos', 'Centro', 'Osasco', 'SP', '06010000'],
  ['33444555000163', 'CADASTRAL', 'Rua Sete de Setembro', '300', null, 'Centro', 'Campinas', 'SP', '13010000'],
  ['44555666000154', 'CADASTRAL', 'Avenida das Palmeiras', '1000', null, 'Jardim Botânico', 'Curitiba', 'PR', '80210000'],
  ['44555666000154', 'ENTREGA', 'Rua do Almoxarifado', '88', 'Doca 3', 'Cidade Industrial', 'Curitiba', 'PR', '81170000'],
  ['44555666000235', 'CADASTRAL', 'Rua XV de Novembro', '55', null, 'Centro', 'Joinville', 'SC', '89201000'],
];

// [cnpj, razão social, contato, telefone, e-mail]
const FORNECEDORES = [
  ['55666777000145', 'Grãos do Sul Indústria Ltda', 'Roberto Dias', '5133330001', 'vendas@graosdosul.demo'],
  ['66777888000136', 'Laticínios Vale Verde Ltda', 'Fernanda Melo', '3533330002', 'comercial@valeverde.demo'],
  ['77888999000127', 'Distribuidora Atlântico Ltda', 'Sérgio Matos', '2133330003', 'pedidos@atlantico.demo'],
];

// [código, descrição, categoria, marca, embalagem, preço unitário, estoque]
const PRODUTOS = [
  ['DEMO-ARROZ-5', 'Arroz Tipo 1', 'Grãos', 'Tio Joaquim', '5 kg', 25.0, 240],
  ['DEMO-ARROZ-1', 'Arroz Tipo 1', 'Grãos', 'Tio Joaquim', '1 kg', 6.2, 600],
  ['DEMO-FEIJAO-1', 'Feijão Carioca', 'Grãos', 'Camil', '1 kg', 8.9, 400],
  ['DEMO-ACUCAR-5', 'Açúcar Refinado', 'Mercearia', 'União', '5 kg', 21.5, 180],
  ['DEMO-OLEO-900', 'Óleo de Soja', 'Mercearia', 'Liza', '900 ml', 7.4, 500],
  ['DEMO-LEITE-1', 'Leite Integral UHT', 'Laticínios', 'Piracanjuba', '1 L', 4.8, 720],
  ['DEMO-FARINHA-1', 'Farinha de Trigo', 'Mercearia', 'Dona Benta', '1 kg', 5.3, 350],
  ['DEMO-CAFE-500', 'Café Torrado e Moído', 'Mercearia', 'Pilão', '500 g', 17.9, 0], // sem estoque, de propósito
];

function conexao() {
  const doAmbiente = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (doAmbiente) return doAmbiente;
  const pastas = fs
    .readdirSync(__dirname, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^.+_\d{14}_.+$/.test(d.name))
    .map((d) => d.name)
    .sort();
  if (!pastas.length) throw new Error('Defina DIRECT_URL ou gere os .env com scripts/gerar-env.cjs.');
  const arquivo = path.join(__dirname, pastas[pastas.length - 1], 'database.env');
  const m = /^DIRECT_URL=(\S+)$/m.exec(fs.readFileSync(arquivo, 'utf8'));
  if (!m || m[1] === 'PREENCHER') throw new Error(`DIRECT_URL não preenchida em ${arquivo}`);
  return m[1];
}

async function main() {
  const modo = process.argv[2];
  if (!['--simular', '--gravar'].includes(modo)) {
    throw new Error('Use --simular (desfaz no fim) ou --gravar.');
  }
  const url = conexao();
  const alvo = new URL(url);
  console.log(`Banco: ${alvo.hostname}:${alvo.port || 5432}${alvo.pathname}  (${modo})`);

  const hash = await bcrypt.hash(SENHA_DEMO, CUSTO_BCRYPT);
  const db = new Client({ connectionString: url });
  await db.connect();
  const contagem = { operador: 0, cliente: 0, endereco: 0, fornecedor: 0, produto: 0, variacao: 0, pedido: 0, orcamento: 0 };
  try {
    await db.query('BEGIN');

    const ids = {};
    for (const [usuario, perfil] of OPERADORES) {
      const r = await db.query(
        `INSERT INTO operador (usuario, email, senha_hash, perfil, status)
         VALUES ($1, $2, $3, $4, 'ATIVO') ON CONFLICT (usuario) DO NOTHING RETURNING id_operador`,
        [usuario, `${usuario}@demo.suprimax.local`, hash, perfil],
      );
      contagem.operador += r.rowCount;
      if (usuario === 'adm') {
        console.warn('AVISO: usuário adm com senha de demonstração: NÃO use em produção; troque a senha.');
      }
      ids[usuario] = (await db.query('SELECT id_operador FROM operador WHERE usuario = $1', [usuario])).rows[0].id_operador;
    }

    for (const [cnpj, razao, fantasia, contato, tel, tipo, vendedor] of CLIENTES) {
      const r = await db.query(
        `INSERT INTO cliente (cnpj, razao_social, nome_fantasia, nome_contato, telefone_contato,
                              email_contato, tipo_unidade, id_operador_vendedor, aceite_lgpd, data_aceite_lgpd)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, CURRENT_TIMESTAMP)
         ON CONFLICT (cnpj) DO NOTHING`,
        [cnpj, razao, fantasia, contato, tel, `contato@${cnpj}.demo`, tipo, ids[vendedor]],
      );
      contagem.cliente += r.rowCount;
    }

    // Sem restrição de unicidade na tabela: só insere o endereço se o cliente ainda não tem um igual
    // (mesmo tipo, logradouro e número), o que também completa clientes já existentes sem endereço.
    for (const [cnpj, tipo, logradouro, numero, complemento, bairro, cidade, uf, cep] of ENDERECOS) {
      const r = await db.query(
        `INSERT INTO endereco_cliente (id_cliente, tipo, logradouro, numero, complemento, bairro, cidade, uf, cep)
         SELECT c.id_cliente, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::varchar, $7::varchar, $8::char(2), $9::char(8) FROM cliente c
          WHERE c.cnpj = $1
            AND NOT EXISTS (SELECT 1 FROM endereco_cliente e
                             WHERE e.id_cliente = c.id_cliente AND e.tipo = $2::varchar AND e.logradouro = $3::varchar AND e.numero = $4::varchar)`,
        [cnpj, tipo, logradouro, numero, complemento, bairro, cidade, uf, cep],
      );
      contagem.endereco += r.rowCount;
    }

    for (const [cnpj, razao, contato, tel, email] of FORNECEDORES) {
      const r = await db.query(
        `INSERT INTO fornecedor (cnpj, razao_social, nome_contato, telefone_contato, email_contato)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (cnpj) DO NOTHING`,
        [cnpj, razao, contato, tel, email],
      );
      contagem.fornecedor += r.rowCount;
    }

    for (const [codigo, descricao, categoria, marca, embalagem, preco, estoque] of PRODUTOS) {
      const novo = await db.query(
        `INSERT INTO produto (codigo_interno, descricao, categoria, ativo)
         VALUES ($1, $2, $3, TRUE) ON CONFLICT (codigo_interno) DO NOTHING RETURNING id_produto`,
        [codigo, descricao, categoria],
      );
      if (!novo.rowCount) continue; // produto já existia: não mexe nas variações nem nos preços
      contagem.produto++;
      const variacao = await db.query(
        `INSERT INTO variacao_produto (id_produto, marca, tamanho_embalagem, quantidade_estoque)
         VALUES ($1, $2, $3, $4) RETURNING id_variacao`,
        [novo.rows[0].id_produto, marca, embalagem, estoque],
      );
      contagem.variacao++;
      const idVariacao = variacao.rows[0].id_variacao;
      const faixas = [
        [1, preco],
        [12, preco * 0.95],
        [48, preco * 0.9],
      ];
      for (const [minimo, valor] of faixas) {
        await db.query(
          'INSERT INTO faixa_preco (id_variacao, quantidade_minima, preco_unitario) VALUES ($1, $2, $3)',
          [idVariacao, minimo, valor.toFixed(2)],
        );
      }
      await db.query(
        'INSERT INTO fardo (id_variacao, quantidade_unidades, preco_fixo) VALUES ($1, 6, $2)',
        [idVariacao, (preco * 6 * 0.92).toFixed(2)],
      );
    }

    // ---- Pedidos e orçamentos de demonstração -------------------------------------------------
    // Cada grupo só entra se o seu marcador (numero_solicitacao_compra) ainda não existe, então rodar de
    // novo não duplica nada. Dinheiro em centavos inteiros; imposto de 18% arredondado uma vez por linha.
    const centavos = (decimal) => Math.round(Number(decimal) * 100);
    const reais = (c) => (c / 100).toFixed(2);
    const idVariacaoDe = async (codigo) =>
      (await db.query(
        `SELECT v.id_variacao FROM variacao_produto v JOIN produto p ON p.id_produto = v.id_produto
          WHERE p.codigo_interno = $1 ORDER BY v.id_variacao LIMIT 1`,
        [codigo],
      )).rows[0].id_variacao;
    const idClienteDe = async (cnpj) =>
      (await db.query('SELECT id_cliente FROM cliente WHERE cnpj = $1', [cnpj])).rows[0].id_cliente;
    const precoAplicado = async (idVariacao, quantidade) => {
      const faixa = (await db.query(
        `SELECT id_faixa_preco, preco_unitario FROM faixa_preco
          WHERE id_variacao = $1 AND quantidade_minima <= $2 ORDER BY quantidade_minima DESC LIMIT 1`,
        [idVariacao, quantidade],
      )).rows[0];
      const unitario = centavos(faixa.preco_unitario);
      const subtotal = unitario * quantidade;
      const imposto = Math.round((subtotal * 18) / 100);
      return { idFaixa: faixa.id_faixa_preco, unitario, imposto, total: subtotal + imposto };
    };
    const novoPedido = async (marcador, cnpj, vendedor, status, itens, atendimento) => {
      if ((await db.query('SELECT 1 FROM pedido WHERE numero_solicitacao_compra = $1', [marcador])).rowCount) return null;
      const idCliente = await idClienteDe(cnpj);
      const p = await db.query(
        `INSERT INTO pedido (id_cliente, id_operador_vendedor, numero_solicitacao_compra, contato_solicitacao,
                             condicao_pagamento_desejada, status, id_operador_atendimento)
         VALUES ($1, $2, $3, 'Contato de demonstração', 'ADIANTADO_100', $4, $5) RETURNING id_pedido`,
        [idCliente, ids[vendedor], marcador, status, atendimento ? ids[atendimento] : null],
      );
      for (const [codigo, quantidade] of itens) {
        await db.query(
          `INSERT INTO item_pedido (id_pedido, id_variacao, granularidade, quantidade_solicitada)
           VALUES ($1, $2, 'AVULSO', $3)`,
          [p.rows[0].id_pedido, await idVariacaoDe(codigo), quantidade],
        );
      }
      contagem.pedido++;
      return { idPedido: p.rows[0].id_pedido, idCliente };
    };
    const novoRascunho = async (marcador, pedido, operador, itens, condicoes) => {
      if ((await db.query('SELECT 1 FROM orcamento WHERE numero_solicitacao_compra = $1', [marcador])).rowCount) return null;
      const o = await db.query(
        `INSERT INTO orcamento (id_cliente, id_operador, id_pedido, numero_solicitacao_compra, primeira_compra,
                                condicao_pagamento, modalidade_frete)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id_orcamento`,
        [pedido.idCliente, ids[operador], pedido.idPedido, marcador, Boolean(condicoes), condicoes?.pagamento ?? null, condicoes?.frete ?? null],
      );
      for (const [codigo, quantidade] of itens) {
        const idVariacao = await idVariacaoDe(codigo);
        const preco = await precoAplicado(idVariacao, quantidade);
        await db.query(
          `INSERT INTO item_orcamento (id_orcamento, id_variacao, granularidade, id_faixa_preco, quantidade_avulsa,
                                       preco_unitario_aplicado, valor_imposto, valor_total_item)
           VALUES ($1, $2, 'AVULSO', $3, $4, $5, $6, $7)`,
          [o.rows[0].id_orcamento, idVariacao, preco.idFaixa, quantidade, reais(preco.unitario), reais(preco.imposto), reais(preco.total)],
        );
      }
      contagem.orcamento++;
      return o.rows[0].id_orcamento;
    };

    // Fila de pedidos (SOLICITADO), como se tivessem chegado do Sistema 1.
    await novoPedido('DEMO-PED-001', '11222333000181', 'vendedor1', 'SOLICITADO', [['DEMO-ARROZ-5', 50], ['DEMO-FEIJAO-1', 100]]);
    await novoPedido('DEMO-PED-002', '22333444000172', 'vendedor1', 'SOLICITADO', [['DEMO-OLEO-900', 120], ['DEMO-LEITE-1', 200]]);
    await novoPedido('DEMO-PED-003', '33444555000163', 'vendedor2', 'SOLICITADO', [['DEMO-FARINHA-1', 80], ['DEMO-ACUCAR-5', 40]]);
    // Pedido em análise com orçamento em rascunho INCOMPLETO (sem pagamento nem frete): mostra os bloqueios de emissão.
    const pedido4 = await novoPedido('DEMO-PED-004', '44555666000154', 'vendedor2', 'EM_ANALISE', [['DEMO-ARROZ-1', 24], ['DEMO-FEIJAO-1', 24]], 'operador');
    if (pedido4) await novoRascunho('DEMO-ORC-RASCUNHO', pedido4, 'operador', [['DEMO-ARROZ-1', 24], ['DEMO-FEIJAO-1', 24]], null);
    // Pedido em análise com orçamento COMPLETO, emitido pela função do banco (número, validade, reservas e PDF).
    const pedido5 = await novoPedido('DEMO-PED-005', '44555666000235', 'vendedor2', 'EM_ANALISE', [['DEMO-ARROZ-5', 10], ['DEMO-LEITE-1', 60]], 'operador');
    if (pedido5) {
      const idOrcamento = await novoRascunho('DEMO-ORC-EMITIDO', pedido5, 'operador', [['DEMO-ARROZ-5', 10], ['DEMO-LEITE-1', 60]], { pagamento: 'ADIANTADO_100', frete: 'CIF' });
      await db.query('SELECT * FROM proxy_orcamento_emitir($1, $2, $3)', [idOrcamento, ids.operador, require('node:crypto').randomBytes(32).toString('hex')]);
    }

    if (modo === '--gravar') {
      await db.query('COMMIT');
      console.log('Gravado:', contagem);
      console.log(`Login: qualquer usuário de ${OPERADORES.map(([u]) => u).join(', ')} / senha ${SENHA_DEMO}`);
    } else {
      await db.query('ROLLBACK');
      console.log('Simulação OK (nada foi gravado). Teria inserido:', contagem);
    }
  } catch (e) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(`Erro: ${e.message}`);
  process.exit(1);
});
