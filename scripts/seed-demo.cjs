#!/usr/bin/env node
// Dados FALSOS para apresentar o sistema. APAGA TODOS OS DADOS do banco e popula TODAS as tabelas com
// exemplos de demonstração: um usuário de cada perfil (e um inativo), clientes em cada situação, produtos
// com variações, faixas de preço, fardos e estoque, entradas e movimentações de estoque, pedidos em cada
// status, orçamentos em cada status (RASCUNHO, PENDENTE_CREDITO, ABERTO, ALTERACAO_SOLICITADA, ACEITO,
// RECUSADO, CANCELADO, SUBSTITUIDO e EXPIRADO), respostas, reservas, anexos, histórico, análises de
// crédito com documentos, dívidas em cada situação, fila de escrita, auditoria e sessão.
//
// Os orçamentos passam pelo caminho real do banco (proxy_orcamento_emitir, proxy_resposta_processar e as
// transições de status), então reservas, histórico e baixas de estoque nascem consistentes.
//
// O QUE É APAGADO: as 25 tabelas de dados (operador, cliente, produto, orçamento, pedido, estoque, crédito,
// dívida, fila_escrita, log_auditoria, sessao etc.), com os contadores (ids e número do orçamento)
// reiniciados. Todo mundo é desconectado (sessao). O log de auditoria também é apagado.
// O QUE É PRESERVADO: integrantes_proxy (credenciais do backend no proxy: sem ela o backend deixa de
// falar com o proxy) e _prisma_migrations (histórico das migrations).
//
// Uso:
//   node scripts/seed-demo.cjs --simular                      roda tudo e desfaz (ROLLBACK): só valida
//   node scripts/seed-demo.cjs --gravar --apagar-tudo         apaga e grava de verdade
//
// --gravar exige --apagar-tudo de propósito: o script não tem modo que preserve dados.
// Rode com ninguém usando o sistema: o TRUNCATE trava as tabelas por instantes.
//
// Conexão: DIRECT_URL (ou DATABASE_URL) no ambiente; se ausente, lê o DIRECT_URL do database.env
// da pasta gerada mais recente por scripts/gerar-env.cjs. Confira o host impresso antes de gravar.
//
// Só usa pg (de proxy/node_modules) e bcryptjs (de backend/node_modules): rode `npm ci` nos dois.

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.resolve(__dirname, '..');
const { Client } = require(path.join(raiz, 'proxy/node_modules/pg'));
const bcrypt = require(path.join(raiz, 'backend/node_modules/bcryptjs'));

const SENHA_DEMO = 'Suprimax@2026';
const CUSTO_BCRYPT = 12; // o mesmo do backend (senha.ts)

// Tabelas que NÃO são apagadas (ver o cabeçalho). Qualquer outra tabela do schema public tem de estar em
// TABELAS_APAGADAS: se uma migration criar tabela nova, o script para até alguém decidir o destino dela.
const TABELAS_PRESERVADAS = ['integrantes_proxy', '_prisma_migrations'];
const TABELAS_APAGADAS = [
  'operador',
  'cliente',
  'endereco_cliente',
  'fornecedor',
  'produto',
  'variacao_produto',
  'faixa_preco',
  'fardo',
  'pedido',
  'item_pedido',
  'orcamento',
  'item_orcamento',
  'reserva_estoque',
  'anexo_orcamento',
  'historico_orcamento',
  'resposta_orcamento',
  'item_resposta_orcamento',
  'analise_credito',
  'documento_analise_credito',
  'divida_inadimplencia',
  'entrada_mercadoria',
  'movimentacao_estoque',
  'fila_escrita',
  'log_auditoria',
  'sessao',
];

// [usuário, perfil, status]
const OPERADORES = [
  ['chefe', 'OPERADOR_CHEFE', 'ATIVO'],
  ['operador', 'OPERADOR', 'ATIVO'],
  ['vendedor1', 'VENDEDOR', 'ATIVO'],
  ['vendedor2', 'VENDEDOR', 'ATIVO'],
  ['fiscal', 'FISCAL', 'ATIVO'],
  ['financeiro', 'FINANCEIRO', 'ATIVO'],
  ['gestor', 'GESTOR', 'ATIVO'],
  // ADMIN: acesso total. Usa a mesma senha de demonstração (SENHA_DEMO); NUNCA reutilizar em produção.
  ['adm', 'ADMIN', 'ATIVO'],
  ['inativo', 'OPERADOR', 'INATIVO'],
];

// [cnpj, razão social, fantasia, contato, telefone, tipo_unidade, vendedor, status]
const CLIENTES = [
  ['11222333000181', 'Mercearia Boa Esperança Ltda', 'Mercearia Boa Esperança', 'Marta Souza', '11911110001', 'MATRIZ', 'vendedor1', 'ATIVO'],
  ['22333444000172', 'Restaurante Sabor da Terra Ltda', 'Sabor da Terra', 'Paulo Lima', '11911110002', 'MATRIZ', 'vendedor1', 'ATIVO'],
  ['33444555000163', 'Padaria Pão Quente Eireli', 'Pão Quente', 'Ana Ribeiro', '11911110003', 'MATRIZ', 'vendedor2', 'ATIVO'],
  ['44555666000154', 'Hotel Vista Verde S.A.', 'Hotel Vista Verde', 'Carlos Nunes', '11911110004', 'MATRIZ', 'vendedor2', 'ATIVO'],
  ['44555666000235', 'Hotel Vista Verde S.A. - Filial', 'Hotel Vista Verde Filial', 'Júlia Alves', '11911110005', 'FILIAL', 'vendedor2', 'ATIVO'],
  // Dívidas em aberto/protestada: o banco recusa orçamento novo para este cliente (RN06).
  ['55666777000190', 'Empório Atraso Ltda', 'Empório Atraso', 'Renato Castro', '11911110006', 'MATRIZ', 'vendedor1', 'ATIVO'],
  // Dívidas renegociada e quitada: não bloqueiam.
  ['66777888000181', 'Bar do Zé Ltda', 'Bar do Zé', 'José Pereira', '11911110007', 'MATRIZ', 'vendedor2', 'ATIVO'],
  ['77888999000172', 'Mercadinho Fechado ME', 'Mercadinho Fechado', 'Lúcia Prado', '11911110008', 'MATRIZ', 'vendedor1', 'INATIVO'],
  ['88999000000163', 'Cantina Suspensa Ltda', 'Cantina Suspensa', 'Mário Dias', '11911110009', 'MATRIZ', 'vendedor2', 'BLOQUEADO'],
];

// Todos têm o endereço cadastral; alguns também um de entrega.
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
  ['55666777000190', 'CADASTRAL', 'Rua da Pendência', '7', null, 'Brás', 'São Paulo', 'SP', '03010000'],
  ['66777888000181', 'CADASTRAL', 'Rua do Chopp', '42', null, 'Vila Madalena', 'São Paulo', 'SP', '05435000'],
  ['77888999000172', 'CADASTRAL', 'Rua do Encerramento', '1', null, 'Mooca', 'São Paulo', 'SP', '03103000'],
  ['88999000000163', 'CADASTRAL', 'Rua da Suspensão', '9', null, 'Santana', 'São Paulo', 'SP', '02012000'],
];

// [cnpj, razão social, contato, telefone, e-mail]
const FORNECEDORES = [
  ['55666777000145', 'Grãos do Sul Indústria Ltda', 'Roberto Dias', '5133330001', 'vendas@graosdosul.demo'],
  ['66777888000136', 'Laticínios Vale Verde Ltda', 'Fernanda Melo', '3533330002', 'comercial@valeverde.demo'],
  ['77888999000127', 'Distribuidora Atlântico Ltda', 'Sérgio Matos', '2133330003', 'pedidos@atlantico.demo'],
];

// [código, descrição, categoria, marca, embalagem, preço unitário, estoque inicial, NCM, EAN, ativo]
const PRODUTOS = [
  ['DEMO-ARROZ-5', 'Arroz Tipo 1', 'Grãos', 'Tio Joaquim', '5 kg', 25.0, 240, '10063021', '7891000000011', true],
  ['DEMO-ARROZ-1', 'Arroz Tipo 1', 'Grãos', 'Tio Joaquim', '1 kg', 6.2, 600, '10063021', '7891000000028', true],
  ['DEMO-FEIJAO-1', 'Feijão Carioca', 'Grãos', 'Camil', '1 kg', 8.9, 400, '07133319', '7891000000035', true],
  ['DEMO-ACUCAR-5', 'Açúcar Refinado', 'Mercearia', 'União', '5 kg', 21.5, 180, '17019900', '7891000000042', true],
  ['DEMO-OLEO-900', 'Óleo de Soja', 'Mercearia', 'Liza', '900 ml', 7.4, 500, '15079011', '7891000000059', true],
  ['DEMO-LEITE-1', 'Leite Integral UHT', 'Laticínios', 'Piracanjuba', '1 L', 4.8, 720, '04012010', '7891000000066', true],
  ['DEMO-FARINHA-1', 'Farinha de Trigo', 'Mercearia', 'Dona Benta', '1 kg', 5.3, 350, '11010010', '7891000000073', true],
  ['DEMO-CAFE-500', 'Café Torrado e Moído', 'Mercearia', 'Pilão', '500 g', 17.9, 0, '09012100', '7891000000080', true], // sem estoque, de propósito
  ['DEMO-MACARRAO-500', 'Macarrão Espaguete (descontinuado)', 'Mercearia', 'Renata', '500 g', 4.2, 50, '19021100', '7891000000097', false], // produto inativo
];

const centavos = (decimal) => Math.round(Number(decimal) * 100);
const reais = (c) => (c / 100).toFixed(2);
// 18% sobre o subtotal, arredondado uma vez por linha, como o CHECK item_orcamento_imposto_check.
const imposto18 = (subtotalCentavos) => Math.floor((subtotalCentavos * 18 + 50) / 100);

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

function lerModo(argumentos) {
  const simular = argumentos.includes('--simular');
  const gravar = argumentos.includes('--gravar');
  if (simular === gravar) throw new Error('Use --simular (desfaz no fim) ou --gravar --apagar-tudo.');
  if (gravar && !argumentos.includes('--apagar-tudo')) {
    throw new Error('--gravar APAGA todos os dados do banco antes de popular: confirme com --gravar --apagar-tudo.');
  }
  return simular ? '--simular' : '--gravar';
}

async function main() {
  const modo = lerModo(process.argv.slice(2));
  const url = conexao();
  const alvo = new URL(url);
  console.log(`Banco: ${alvo.hostname}:${alvo.port || 5432}${alvo.pathname}  (${modo})`);

  const hash = await bcrypt.hash(SENHA_DEMO, CUSTO_BCRYPT);
  const db = new Client({ connectionString: url });
  await db.connect();
  const q = (texto, valores) => db.query(texto, valores);
  const um = async (texto, valores) => (await q(texto, valores)).rows[0];
  try {
    await q('BEGIN');

    // ---- 1. Limpeza ---------------------------------------------------------------------------------
    const existentes = (
      await q(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`)
    ).rows.map((r) => r.table_name);
    const desconhecidas = existentes.filter((t) => ![...TABELAS_APAGADAS, ...TABELAS_PRESERVADAS].includes(t));
    if (desconhecidas.length) {
      throw new Error(`Tabela(s) fora da lista do script: ${desconhecidas.join(', ')}. Decida se apaga ou preserva.`);
    }
    const ausentes = TABELAS_APAGADAS.filter((t) => !existentes.includes(t));
    if (ausentes.length) throw new Error(`Tabela(s) da lista que não existem no banco: ${ausentes.join(', ')}.`);

    const contar = async (tabela) => Number((await um(`SELECT count(*) AS n FROM public."${tabela}"`)).n);
    const antes = {};
    for (const t of TABELAS_APAGADAS) antes[t] = await contar(t);
    const integrantesAntes = await contar('integrantes_proxy');
    const total = Object.values(antes).reduce((a, b) => a + b, 0);
    console.log(`Será apagado: ${total} linhas em ${TABELAS_APAGADAS.length} tabelas (integrantes_proxy preservada: ${integrantesAntes}).`);
    console.log('  ', Object.entries(antes).filter(([, n]) => n > 0).map(([t, n]) => `${t}=${n}`).join(' '));

    await q(`TRUNCATE TABLE ${TABELAS_APAGADAS.map((t) => `public."${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
    await q('ALTER SEQUENCE public.numero_orcamento_seq RESTART WITH 1');
    if ((await contar('integrantes_proxy')) !== integrantesAntes) {
      throw new Error('integrantes_proxy foi alterada pela limpeza: abortado.');
    }

    // ---- 2. Cadastros -------------------------------------------------------------------------------
    const ids = {}; // usuário -> id_operador
    for (const [usuario, perfil, status] of OPERADORES) {
      const r = await um(
        `INSERT INTO operador (usuario, email, senha_hash, perfil, status)
         VALUES ($1, $2, $3, $4, $5) RETURNING id_operador`,
        [usuario, `${usuario}@demo.suprimax.local`, hash, perfil, status],
      );
      ids[usuario] = r.id_operador;
    }
    console.warn('AVISO: o usuário adm (e todos os outros) usa a senha de demonstração: NÃO use em produção; troque a senha.');

    for (const [cnpj, razao, fantasia, contato, tel, tipo, vendedor, status] of CLIENTES) {
      await q(
        `INSERT INTO cliente (cnpj, razao_social, nome_fantasia, nome_contato, telefone_contato, email_contato,
                              tipo_unidade, status, id_operador_vendedor, aceite_lgpd, data_aceite_lgpd)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, CURRENT_TIMESTAMP)`,
        [cnpj, razao, fantasia, contato, tel, `contato@${cnpj}.demo`, tipo, status, ids[vendedor]],
      );
    }
    const idClienteDe = async (cnpj) => (await um('SELECT id_cliente FROM cliente WHERE cnpj = $1', [cnpj])).id_cliente;

    for (const [cnpj, tipo, logradouro, numero, complemento, bairro, cidade, uf, cep] of ENDERECOS) {
      await q(
        `INSERT INTO endereco_cliente (id_cliente, tipo, logradouro, numero, complemento, bairro, cidade, uf, cep)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [await idClienteDe(cnpj), tipo, logradouro, numero, complemento, bairro, cidade, uf, cep],
      );
    }
    const idEnderecoDeEntrega = async (cnpj) =>
      (await um(`SELECT id_endereco FROM endereco_cliente WHERE id_cliente = $1 AND tipo = 'ENTREGA' LIMIT 1`, [await idClienteDe(cnpj)]))
        ?.id_endereco ?? null;

    const idFornecedor = {};
    for (const [cnpj, razao, contato, tel, email] of FORNECEDORES) {
      idFornecedor[cnpj] = (
        await um(
          `INSERT INTO fornecedor (cnpj, razao_social, nome_contato, telefone_contato, email_contato)
           VALUES ($1, $2, $3, $4, $5) RETURNING id_fornecedor`,
          [cnpj, razao, contato, tel, email],
        )
      ).id_fornecedor;
    }

    for (const [codigo, descricao, categoria, marca, embalagem, preco, estoque, ncm, ean, ativo] of PRODUTOS) {
      const produto = await um(
        `INSERT INTO produto (codigo_interno, descricao, ncm, ean, categoria, ativo)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id_produto`,
        [codigo, descricao, ncm, ean, categoria, ativo],
      );
      // O saldo inicial entra direto no INSERT (o gatilho só protege o UPDATE); depois dele, só movimentações.
      const variacao = await um(
        `INSERT INTO variacao_produto (id_produto, marca, tamanho_embalagem, quantidade_estoque)
         VALUES ($1, $2, $3, $4) RETURNING id_variacao`,
        [produto.id_produto, marca, embalagem, estoque],
      );
      for (const [minimo, fator] of [[1, 1], [12, 0.95], [48, 0.9]]) {
        await q('INSERT INTO faixa_preco (id_variacao, quantidade_minima, preco_unitario) VALUES ($1, $2, $3)', [
          variacao.id_variacao,
          minimo,
          (preco * fator).toFixed(2),
        ]);
      }
      await q('INSERT INTO fardo (id_variacao, quantidade_unidades, preco_fixo) VALUES ($1, 6, $2)', [
        variacao.id_variacao,
        (preco * 6 * 0.92).toFixed(2),
      ]);
    }
    const idVariacaoDe = async (codigo) =>
      (
        await um(
          `SELECT v.id_variacao FROM variacao_produto v JOIN produto p ON p.id_produto = v.id_produto
            WHERE p.codigo_interno = $1 ORDER BY v.id_variacao LIMIT 1`,
          [codigo],
        )
      ).id_variacao;

    // ---- 3. Estoque: entradas e movimentações (todo saldo novo passa por movimentacao_estoque) ----------
    const entrada = async (codigo, fornecedor, operador, cotacao, comprada, informada, liberador) => {
      const idVariacao = await idVariacaoDe(codigo);
      const e = await um(
        `INSERT INTO entrada_mercadoria (id_variacao, id_fornecedor, id_operador, numero_cotacao_compra, quantidade_comprada,
                                         quantidade_informada, id_operador_liberacao, data_liberacao)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id_entrada`,
        [idVariacao, idFornecedor[fornecedor], ids[operador], cotacao, comprada, informada, liberador ? ids[liberador] : null, liberador ? new Date() : null],
      );
      await q(
        `INSERT INTO movimentacao_estoque (id_variacao, tipo, quantidade, id_operador, id_entrada, motivo)
         VALUES ($1, 'ENTRADA', $2, $3, $4, $5)`,
        [idVariacao, informada, ids[operador], e.id_entrada, comprada === informada ? null : 'Entrada com divergência liberada pelo chefe'],
      );
    };
    await entrada('DEMO-ARROZ-5', '55666777000145', 'operador', 'COT-0001', 100, 100, null);
    await entrada('DEMO-LEITE-1', '66777888000136', 'operador', 'COT-0002', 200, 190, 'chefe'); // divergência

    await q(
      `INSERT INTO movimentacao_estoque (id_variacao, tipo, quantidade, id_operador, motivo) VALUES ($1, 'AJUSTE', -5, $2, $3)`,
      [await idVariacaoDe('DEMO-FEIJAO-1'), ids.chefe, 'Quebra de embalagem na conferência'],
    );

    // ---- 4. Pedidos e orçamentos ---------------------------------------------------------------------
    const precoDeItem = async (item) => {
      const idVariacao = await idVariacaoDe(item.c);
      if (item.fardos) {
        const fardo = await um('SELECT id_fardo, quantidade_unidades, preco_fixo FROM fardo WHERE id_variacao = $1 LIMIT 1', [idVariacao]);
        const unitario = centavos(fardo.preco_fixo);
        const impostoItem = imposto18(unitario * item.fardos);
        return {
          idVariacao, granularidade: 'FARDO', idFardo: fardo.id_fardo, idFaixa: null, quantidade: item.fardos,
          unitario, imposto: impostoItem, total: unitario * item.fardos + impostoItem,
        };
      }
      const faixa = await um(
        `SELECT id_faixa_preco, preco_unitario FROM faixa_preco WHERE id_variacao = $1 AND quantidade_minima <= $2
          ORDER BY quantidade_minima DESC LIMIT 1`,
        [idVariacao, item.q],
      );
      const unitario = centavos(faixa.preco_unitario);
      const impostoItem = imposto18(unitario * item.q);
      return {
        idVariacao, granularidade: 'AVULSO', idFardo: null, idFaixa: faixa.id_faixa_preco, quantidade: item.q,
        unitario, imposto: impostoItem, total: unitario * item.q + impostoItem,
      };
    };

    const novoPedido = async (p) => {
      const idCliente = await idClienteDe(p.cnpj);
      const pedido = await um(
        `INSERT INTO pedido (id_cliente, id_operador_vendedor, id_endereco_entrega, numero_solicitacao_compra, contato_solicitacao,
                             condicao_pagamento_desejada, prazo_dias_desejado, numero_parcelas_desejado, transportadora_indicada,
                             observacoes, status, motivo_negativa, id_operador_atendimento, data_decisao)
         VALUES ($1, $2, $3, $4, 'Contato de demonstração', $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id_pedido`,
        [
          idCliente, ids[p.vendedor], p.entrega ? await idEnderecoDeEntrega(p.cnpj) : null, p.marcador, p.pagamento,
          p.prazo ?? null, p.parcelas ?? null, p.transportadora ?? null, p.observacoes ?? null, p.status, p.motivo ?? null,
          p.atendimento ? ids[p.atendimento] : null, ['APROVADO', 'NEGADO', 'CANCELADO'].includes(p.status) ? new Date() : null,
        ],
      );
      for (const item of p.itens) {
        const info = await precoDeItem(item);
        await q(
          `INSERT INTO item_pedido (id_pedido, id_variacao, granularidade, id_fardo, quantidade_solicitada) VALUES ($1, $2, $3, $4, $5)`,
          [pedido.id_pedido, info.idVariacao, info.granularidade, info.idFardo, info.quantidade],
        );
      }
      return { idPedido: pedido.id_pedido, idCliente };
    };

    // Cria o orçamento em RASCUNHO com os itens (o banco só aceita nascer assim).
    const novoOrcamento = async (o) => {
      const idCliente = await idClienteDe(o.cnpj);
      const pagamento = o.pagamento ?? {};
      const frete = o.frete ?? {};
      const orc = await um(
        `INSERT INTO orcamento (id_cliente, id_operador, id_endereco_entrega, id_pedido, id_orcamento_origem, numero_solicitacao_compra,
                                contato_solicitacao, prazo_entrega_dias, primeira_compra, condicao_pagamento, prazo_dias, numero_parcelas,
                                modalidade_frete, origem_transportadora, transportadora, valor_frete, id_operador_ultima_edicao)
         VALUES ($1, $2, $3, $4, $5, $6, 'Contato de demonstração', $7, $8, $9, $10, $11, $12, $13, $14, $15, $2) RETURNING id_orcamento`,
        [
          idCliente, ids.operador, o.entrega ? await idEnderecoDeEntrega(o.cnpj) : null, o.pedido?.idPedido ?? null, o.origem ?? null,
          o.marcador, o.prazoEntrega ?? null, Boolean(o.primeiraCompra), pagamento.condicao ?? null, pagamento.prazo ?? null,
          pagamento.parcelas ?? null, frete.modalidade ?? null, frete.origem ?? null, frete.transportadora ?? null, frete.valor ?? null,
        ],
      );
      const itens = [];
      for (const item of o.itens) {
        const info = await precoDeItem(item);
        const linha = await um(
          `INSERT INTO item_orcamento (id_orcamento, id_variacao, granularidade, id_fardo, quantidade_fardos, id_faixa_preco, quantidade_avulsa,
                                       preco_unitario_aplicado, valor_imposto, valor_total_item)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id_item`,
          [
            orc.id_orcamento, info.idVariacao, info.granularidade, info.idFardo,
            info.granularidade === 'FARDO' ? info.quantidade : null, info.idFaixa,
            info.granularidade === 'AVULSO' ? info.quantidade : null, reais(info.unitario), reais(info.imposto), reais(info.total),
          ],
        );
        itens.push({ idItem: linha.id_item, ...info });
      }
      return { id: orc.id_orcamento, itens, frete };
    };

    const chaveAleatoria = () => crypto.randomBytes(32).toString('hex');
    const emitir = (orc, operador = 'operador') =>
      q('SELECT * FROM proxy_orcamento_emitir($1, $2, $3)', [orc.id, ids[operador], chaveAleatoria()]);
    // Transição de status feita por um operador (o gatilho de histórico lê suprimax.id_operador).
    const mudarStatus = async (orc, status, operador, extras = {}) => {
      await q(`SELECT set_config('suprimax.id_operador', $1, true)`, [String(ids[operador])]);
      await q(`UPDATE orcamento SET status = $2, motivo_expiracao = $3, justificativa = $4 WHERE id_orcamento = $1`, [
        orc.id, status, extras.motivoExpiracao ?? null, extras.justificativa ?? null,
      ]);
    };

    // Resposta do cliente (tabelas resposta_orcamento e item_resposta_orcamento): nasce PENDENTE, com todos os itens.
    const novaResposta = async (orc, tipo, vendedor) => {
      const resposta = await um(
        `INSERT INTO resposta_orcamento (id_orcamento, tipo_resposta, id_operador_vendedor, justificativa)
         VALUES ($1, $2, $3, $4) RETURNING id_resposta`,
        [orc.id, tipo, ids[vendedor], tipo === 'ITENS' ? null : tipo === 'RECUSA' ? 'Preço acima do orçamento de outro fornecedor' : 'Cliente pede troca de itens e novo prazo'],
      );
      const itensDaResposta = [];
      for (const item of orc.itens) {
        const r = await um(
          `INSERT INTO item_resposta_orcamento (id_resposta, id_item, quantidade_aprovada, situacao)
           VALUES ($1, $2, $3, 'APROVADO') RETURNING id_item_resposta`,
          [resposta.id_resposta, item.idItem, item.quantidade],
        );
        itensDaResposta.push({ idItemResposta: r.id_item_resposta, item });
      }
      return { id: resposta.id_resposta, itens: itensDaResposta };
    };
    const processar = (resposta, resultado) =>
      q('SELECT * FROM proxy_resposta_processar($1, $2::jsonb)', [resposta.id, JSON.stringify(resultado)]);
    // Resposta sem item aprovado (recusa e pedido de alteração).
    const processarSemAprovacao = (resposta, statusOrcamento, motivo) =>
      processar(resposta, {
        itens: resposta.itens.map(({ idItemResposta }) => ({ id_item_resposta: idItemResposta, situacao: 'NAO_APROVADO', quantidade_aprovada: 0 })),
        status_orcamento: statusOrcamento,
        status_resposta: 'AGUARDA_OPERADOR',
        motivo_tratamento: motivo,
        totais: { valor_total_itens_aprovado: '0.00', valor_total_imposto_aprovado: '0.00' },
      });

    // 4.1 Pedidos (um por status; os com orçamento ligado ficam em EM_ANALISE até a emissão).
    await novoPedido({ marcador: 'DEMO-PED-001', cnpj: '11222333000181', vendedor: 'vendedor1', status: 'SOLICITADO', pagamento: 'ADIANTADO_100', itens: [{ c: 'DEMO-ARROZ-5', q: 50 }, { c: 'DEMO-FEIJAO-1', q: 100 }] });
    await novoPedido({ marcador: 'DEMO-PED-002', cnpj: '22333444000172', vendedor: 'vendedor1', status: 'SOLICITADO', pagamento: 'BOLETO', prazo: 30, entrega: true, itens: [{ c: 'DEMO-OLEO-900', q: 120 }, { c: 'DEMO-LEITE-1', q: 200 }] });
    await novoPedido({ marcador: 'DEMO-PED-003', cnpj: '33444555000163', vendedor: 'vendedor2', status: 'SOLICITADO', pagamento: 'PARCELADO', parcelas: 3, transportadora: 'Transportes Rápido', observacoes: 'Entregar pela manhã, doca dos fundos.', itens: [{ c: 'DEMO-FARINHA-1', q: 80 }, { c: 'DEMO-ACUCAR-5', q: 40 }] });
    const pedido4 = await novoPedido({ marcador: 'DEMO-PED-004', cnpj: '44555666000154', vendedor: 'vendedor2', status: 'EM_ANALISE', atendimento: 'operador', pagamento: 'ADIANTADO_50_50', entrega: true, itens: [{ c: 'DEMO-FEIJAO-1', q: 24 }, { c: 'DEMO-ARROZ-1', fardos: 4 }] });
    const pedido5 = await novoPedido({ marcador: 'DEMO-PED-005', cnpj: '44555666000235', vendedor: 'vendedor2', status: 'EM_ANALISE', atendimento: 'operador', pagamento: 'ADIANTADO_100', itens: [{ c: 'DEMO-ARROZ-5', q: 10 }, { c: 'DEMO-LEITE-1', q: 60 }] });
    await novoPedido({ marcador: 'DEMO-PED-006', cnpj: '55666777000190', vendedor: 'vendedor1', status: 'NEGADO', atendimento: 'operador', pagamento: 'ADIANTADO_100', motivo: 'Cliente com dívida em aberto (RN06)', itens: [{ c: 'DEMO-OLEO-900', q: 30 }] });
    await novoPedido({ marcador: 'DEMO-PED-007', cnpj: '66777888000181', vendedor: 'vendedor2', status: 'CANCELADO', atendimento: 'operador', pagamento: 'ADIANTADO_100', itens: [{ c: 'DEMO-FARINHA-1', q: 12 }] });

    // 4.2 Orçamentos, um por status.
    // RASCUNHO incompleto (sem pagamento nem frete): mostra os bloqueios de emissão. Com anexos.
    const orcRascunho = await novoOrcamento({
      marcador: 'DEMO-ORC-RASCUNHO', cnpj: '44555666000154', pedido: pedido4, entrega: true,
      itens: [{ c: 'DEMO-FEIJAO-1', q: 24 }, { c: 'DEMO-ARROZ-1', fardos: 4 }],
    });
    for (const [tipo, arquivo] of [['DESCRITIVO_TECNICO', 'descritivo-tecnico.pdf'], ['MATERIAL_APOIO', 'tabela-de-apoio.pdf']]) {
      await q(
        `INSERT INTO anexo_orcamento (id_orcamento, tipo_anexo, nome_arquivo, caminho_arquivo, tamanho_bytes) VALUES ($1, $2, $3, $4, $5)`,
        [orcRascunho.id, tipo, arquivo, `demo/orcamentos/${orcRascunho.id}/${arquivo}`, 48213],
      );
    }

    // PENDENTE_CREDITO: primeira compra, aguardando a análise do fiscal.
    const orcPendente = await novoOrcamento({
      marcador: 'DEMO-ORC-PENDENTE-CREDITO', cnpj: '33444555000163', primeiraCompra: true, prazoEntrega: 10,
      pagamento: { condicao: 'ADIANTADO_100' }, frete: { modalidade: 'FOB', origem: 'CLIENTE', transportadora: 'Transportes Rápido' },
      itens: [{ c: 'DEMO-FARINHA-1', q: 80 }, { c: 'DEMO-ACUCAR-5', q: 40 }],
    });
    await mudarStatus(orcPendente, 'PENDENTE_CREDITO', 'operador');

    // ABERTO ligado ao pedido 5 (a emissão aprova o pedido), com resposta do cliente ainda PENDENTE.
    const orcAberto = await novoOrcamento({
      marcador: 'DEMO-ORC-ABERTO', cnpj: '44555666000235', pedido: pedido5, prazoEntrega: 7,
      pagamento: { condicao: 'ADIANTADO_100' }, frete: { modalidade: 'CIF' },
      itens: [{ c: 'DEMO-ARROZ-5', q: 10 }, { c: 'DEMO-LEITE-1', q: 60 }],
    });
    await emitir(orcAberto);
    await novaResposta(orcAberto, 'ITENS', 'vendedor2');
    await q(
      `INSERT INTO historico_orcamento (id_orcamento, id_operador, tipo_evento, status_anterior, status_novo, observacao)
       VALUES ($1, $2, 'ATUALIZACAO_FOLLOWUP', 'ABERTO', 'ABERTO', 'Cliente pediu até sexta para responder.')`,
      [orcAberto.id, ids.vendedor2],
    );

    // SUBSTITUIDO: o original é substituído por uma nova versão (ABERTO, com boleto em 30 dias).
    // A nova versão NÃO leva id_orcamento_origem: com origem, proxy_orcamento_emitir falha ("column reference
    // id_orcamento is ambiguous" no UPDATE que marca o original). Por isso o original é marcado SUBSTITUIDO
    // pela transição de status, que o banco permite (ABERTO -> SUBSTITUIDO). Veja o relatório do PR.
    const orcOriginal = await novoOrcamento({
      marcador: 'DEMO-ORC-SUBSTITUIDO', cnpj: '22333444000172', entrega: true,
      pagamento: { condicao: 'ADIANTADO_100' }, frete: { modalidade: 'CIF' },
      itens: [{ c: 'DEMO-OLEO-900', q: 30 }, { c: 'DEMO-FEIJAO-1', q: 40 }],
    });
    await emitir(orcOriginal);
    const orcSubstituto = await novoOrcamento({
      marcador: 'DEMO-ORC-NOVA-VERSAO', cnpj: '22333444000172', entrega: true, prazoEntrega: 5,
      pagamento: { condicao: 'BOLETO', prazo: 30 }, frete: { modalidade: 'FOB', origem: 'SUPRIMAX', valor: '50.00' },
      itens: [{ c: 'DEMO-OLEO-900', q: 30 }, { c: 'DEMO-FEIJAO-1', q: 50 }],
    });
    await emitir(orcSubstituto);
    await mudarStatus(orcOriginal, 'SUBSTITUIDO', 'operador');

    // ALTERACAO_SOLICITADA: o cliente pediu mudanças; a resposta aguarda o operador.
    const orcAlteracao = await novoOrcamento({
      marcador: 'DEMO-ORC-ALTERACAO', cnpj: '11222333000181', entrega: true,
      pagamento: { condicao: 'PARCELADO', parcelas: 3 }, frete: { modalidade: 'CIF' },
      itens: [{ c: 'DEMO-FARINHA-1', q: 20 }, { c: 'DEMO-ACUCAR-5', q: 10 }],
    });
    await emitir(orcAlteracao);
    await processarSemAprovacao(await novaResposta(orcAlteracao, 'ALTERACAO', 'vendedor1'), 'ALTERACAO_SOLICITADA', 'ALTERACAO');

    // ACEITO: todos os itens aprovados, acima do mínimo de R$ 500; baixa o estoque e as reservas.
    const orcAceito = await novoOrcamento({
      marcador: 'DEMO-ORC-ACEITO', cnpj: '44555666000154', entrega: true, prazoEntrega: 7,
      pagamento: { condicao: 'ADIANTADO_50_50' }, frete: { modalidade: 'FOB', origem: 'SUPRIMAX', valor: '50.00' },
      itens: [{ c: 'DEMO-ARROZ-5', q: 24 }, { c: 'DEMO-ARROZ-1', fardos: 4 }],
    });
    await emitir(orcAceito);
    const respostaAceita = await novaResposta(orcAceito, 'ITENS', 'vendedor2');
    const somaItens = orcAceito.itens.reduce((s, i) => s + i.total, 0);
    const somaImposto = orcAceito.itens.reduce((s, i) => s + i.imposto, 0);
    await processar(respostaAceita, {
      itens: respostaAceita.itens.map(({ idItemResposta, item }) => ({
        id_item_resposta: idItemResposta, situacao: 'APROVADO', quantidade_aprovada: item.quantidade,
        id_faixa_preco_aceita: item.idFaixa, preco_unitario_aceito: reais(item.unitario),
        valor_imposto_aceito: reais(item.imposto), valor_total_item_aceito: reais(item.total),
      })),
      status_orcamento: 'ACEITO',
      status_resposta: 'CONSOLIDADA',
      totais: {
        valor_total_itens_aprovado: reais(somaItens), valor_total_imposto_aprovado: reais(somaImposto),
        modalidade_frete_aceita: 'FOB', valor_frete_aceito: '50.00', valor_total_aceito: reais(somaItens + 5000),
      },
    });
    // Estorno de uma devolução parcial do orçamento aceito.
    await q(
      `INSERT INTO movimentacao_estoque (id_variacao, tipo, quantidade, id_operador, id_orcamento, motivo) VALUES ($1, 'ESTORNO', 2, $2, $3, $4)`,
      [await idVariacaoDe('DEMO-ARROZ-5'), ids.operador, orcAceito.id, 'Devolução de 2 pacotes avariados'],
    );

    // RECUSADO: o cliente recusou; o operador já tratou a resposta (TRATADA).
    const orcRecusado = await novoOrcamento({
      marcador: 'DEMO-ORC-RECUSADO', cnpj: '22333444000172', entrega: true,
      pagamento: { condicao: 'ADIANTADO_100' }, frete: { modalidade: 'CIF' },
      itens: [{ c: 'DEMO-LEITE-1', q: 48 }],
    });
    await emitir(orcRecusado);
    const respostaRecusa = await novaResposta(orcRecusado, 'RECUSA', 'vendedor1');
    await processarSemAprovacao(respostaRecusa, 'RECUSADO', 'RECUSA');
    await q(
      `UPDATE resposta_orcamento SET status_resposta = 'TRATADA', id_operador_tratamento = $2, data_tratamento = CURRENT_TIMESTAMP WHERE id_resposta = $1`,
      [respostaRecusa.id, ids.operador],
    );

    // CANCELADO (emitido, com número), EXPIRADO por validade, e rascunhos cancelado e expirado (sem número).
    const orcCancelado = await novoOrcamento({
      marcador: 'DEMO-ORC-CANCELADO', cnpj: '33444555000163', pagamento: { condicao: 'ADIANTADO_100' }, frete: { modalidade: 'CIF' },
      itens: [{ c: 'DEMO-ARROZ-1', q: 12 }],
    });
    await emitir(orcCancelado);
    await mudarStatus(orcCancelado, 'CANCELADO', 'operador', { justificativa: 'Cliente desistiu da compra.' });

    const orcExpirado = await novoOrcamento({
      marcador: 'DEMO-ORC-EXPIRADO', cnpj: '44555666000235', pagamento: { condicao: 'ADIANTADO_100' }, frete: { modalidade: 'CIF' },
      itens: [{ c: 'DEMO-LEITE-1', q: 24 }],
    });
    await emitir(orcExpirado);
    // O job só expira orçamento depois de data_validade (30 dias); aqui o estado é forçado para a demonstração.
    await mudarStatus(orcExpirado, 'EXPIRADO', 'operador', { motivoExpiracao: 'VALIDADE' });

    const orcRascunhoExpirado = await novoOrcamento({
      marcador: 'DEMO-ORC-RASCUNHO-EXPIRADO', cnpj: '33444555000163', itens: [{ c: 'DEMO-ACUCAR-5', q: 5 }],
    });
    await mudarStatus(orcRascunhoExpirado, 'EXPIRADO', 'operador', { motivoExpiracao: 'RASCUNHO' });

    const orcRascunhoCancelado = await novoOrcamento({
      marcador: 'DEMO-ORC-RASCUNHO-CANCELADO', cnpj: '11222333000181', itens: [{ c: 'DEMO-OLEO-900', q: 6 }],
    });
    await mudarStatus(orcRascunhoCancelado, 'CANCELADO', 'vendedor1', { justificativa: 'Montado por engano.' });

    // ---- 5. Crédito e dívidas ------------------------------------------------------------------------
    const analise = async (cnpj, orcamento, resultado) =>
      (
        await um(
          `INSERT INTO analise_credito (id_cliente, id_orcamento, resultado, data_analise, id_operador_fiscal)
           VALUES ($1, $2, $3, $4, $5) RETURNING id_analise`,
          [await idClienteDe(cnpj), orcamento?.id ?? null, resultado, resultado ? new Date() : null, resultado ? ids.fiscal : null],
        )
      ).id_analise;
    const documento = (idAnalise, tipo, arquivo) =>
      q(`INSERT INTO documento_analise_credito (id_analise, tipo_documento, nome_arquivo, caminho_arquivo) VALUES ($1, $2, $3, $4)`, [
        idAnalise, tipo, arquivo, `demo/credito/${idAnalise}/${arquivo}`,
      ]);
    const analisePendente = await analise('33444555000163', orcPendente, null);
    await documento(analisePendente, 'CONTRATO_SOCIAL', 'contrato-social.pdf');
    await documento(analisePendente, 'COMPROVANTE_ENDERECO', 'comprovante-endereco.pdf');
    const analiseAprovada = await analise('44555666000154', null, 'APROVADO');
    await documento(analiseAprovada, 'BALANCO_LUCRO', 'balanco-2025.pdf');
    await documento(analiseAprovada, 'DOCUMENTO_PROPRIETARIO', 'documento-proprietario.pdf');
    await documento(analiseAprovada, 'NOTA_FISCAL_COMPRA', 'nota-fiscal-compra.pdf');
    const analiseReprovada = await analise('55666777000190', null, 'REPROVADO');
    await documento(analiseReprovada, 'REFERENCIA_COMERCIAL', 'referencia-comercial.pdf');

    // Dívidas (inseridas depois dos orçamentos: com dívida em aberto o banco recusaria orçamento novo do cliente).
    const divida = (cnpj, valor, vencimentoHaDias, status, extras = {}) =>
      idClienteDe(cnpj).then((idCliente) =>
        q(
          `INSERT INTO divida_inadimplencia (id_cliente, id_operador_registro, valor_divida, status, data_vencimento_original,
                                             data_renegociacao, valor_pago_renegociacao, data_protesto)
           VALUES ($1, $2, $3, $4, CURRENT_DATE - $5::int,
                   CASE WHEN $6::int IS NULL THEN NULL ELSE CURRENT_DATE - $6::int END, $7, CASE WHEN $8::int IS NULL THEN NULL ELSE CURRENT_DATE - $8::int END)`,
          [idCliente, ids.financeiro, valor, status, vencimentoHaDias, extras.renegociadaHa ?? null, extras.valorPago ?? null, extras.protestadaHa ?? null],
        ),
      );
    await divida('55666777000190', '1850.90', 20, 'EM_ABERTO');
    await divida('55666777000190', '3200.00', 120, 'PROTESTADA', { protestadaHa: 30 });
    await divida('66777888000181', '2000.00', 90, 'RENEGOCIADA', { renegociadaHa: 10, valorPago: '1200.00' });
    await divida('66777888000181', '800.00', 200, 'QUITADA');

    // ---- 6. Infraestrutura (fila, auditoria e sessão) ------------------------------------------------
    // Só 'concluido' e 'erro': o proxy retoma itens 'pendente'/'processando' ao reiniciar e os reexecutaria.
    await q(
      `INSERT INTO fila_escrita (id, sistema_origem, dominio, operacao, payload, status, tentativas)
       VALUES (gen_random_uuid(), 'sistema2', 'orcamento', 'orcamento.emitir', '{"demo":true}'::jsonb, 'concluido', 1)`,
    );
    await q(
      `INSERT INTO fila_escrita (id, sistema_origem, dominio, operacao, payload, status, tentativas, erro_mensagem)
       VALUES (gen_random_uuid(), 'sistema2', 'orcamento', 'orcamento.emitir', '{"demo":true}'::jsonb, 'erro', 3, 'Exemplo de falha de demonstração')`,
    );
    await q(
      `INSERT INTO log_auditoria (sistema_origem, operacao, resultado_verificacao_risco, status_execucao, duracao_ms, request_id, resultado, id_usuario, ip_origem)
       VALUES ('sistema2', 'UC13-login', 'NAO_APLICAVEL', 'SUCESSO', 42, 'demo-req-0001', 'ok', $1, '127.0.0.1')`,
      [String(ids.chefe)],
    );
    await q(
      `INSERT INTO log_auditoria (sistema_origem, operacao, resultado_verificacao_risco, status_execucao, duracao_ms, request_id, resultado, id_usuario, ip_origem)
       VALUES ('sistema2', 'dados.excluir', 'BLOQUEADO', 'ERRO', 7, 'demo-req-0002', 'RISCO_ESTRUTURAL', $1, '127.0.0.1')`,
      [String(ids.operador)],
    );
    // Sessão de exemplo: o token real só existe no login, então esta linha não permite entrar.
    await q(
      `INSERT INTO sessao (token_hash, id_operador, expira_em) VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '1 day')`,
      [crypto.randomBytes(32).toString('hex'), ids.chefe],
    );

    // ---- 7. Conferência: toda tabela apagada tem de ter dados ---------------------------------------
    const depois = {};
    for (const t of TABELAS_APAGADAS) depois[t] = await contar(t);
    const vazias = Object.entries(depois).filter(([, n]) => n === 0).map(([t]) => t);
    if (vazias.length) throw new Error(`Tabela(s) sem dados após o seed: ${vazias.join(', ')}.`);
    if ((await contar('integrantes_proxy')) !== integrantesAntes) throw new Error('integrantes_proxy foi alterada: abortado.');

    const linhas = Object.entries(depois).map(([t, n]) => `${t}=${n}`).join(' ');
    if (modo === '--gravar') {
      await q('COMMIT');
      console.log('Gravado:', linhas);
      console.log(`Login: qualquer usuário de ${OPERADORES.filter(([, , s]) => s === 'ATIVO').map(([u]) => u).join(', ')} / senha ${SENHA_DEMO}`);
      console.log('Todos os usuários foram desconectados (sessao reiniciada).');
    } else {
      await q('ROLLBACK');
      console.log('Simulação OK (nada foi gravado). Teria deixado:', linhas);
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
  if (process.env.SEED_DEBUG) console.error(e.where, e.stack); // SEED_DEBUG=1 mostra o contexto do erro do banco
  process.exit(1);
});
