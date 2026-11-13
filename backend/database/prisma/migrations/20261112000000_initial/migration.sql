-- Migration inicial emitida pelo Prisma CLI a partir do schema.prisma.
-- Regras específicas do negócio, funções e RLS estão nas migrations seguintes.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "operador" (
    "id_operador" SERIAL NOT NULL,
    "usuario" VARCHAR(50) NOT NULL,
    "email" VARCHAR(120) NOT NULL,
    "senha_hash" VARCHAR(255) NOT NULL,
    "perfil" VARCHAR(20) NOT NULL,
    "status" VARCHAR(7) NOT NULL DEFAULT 'ATIVO',
    "tentativas_login_invalidas" SMALLINT NOT NULL DEFAULT 0,
    "bloqueado_ate" TIMESTAMP(6),
    "token_recuperacao_senha" VARCHAR(255),
    "validade_token" TIMESTAMP(6),
    "data_cadastro" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operador_pkey" PRIMARY KEY ("id_operador")
);

-- CreateTable
CREATE TABLE "cliente" (
    "id_cliente" SERIAL NOT NULL,
    "cnpj" CHAR(14) NOT NULL,
    "razao_social" VARCHAR(150) NOT NULL,
    "nome_fantasia" VARCHAR(150),
    "nome_contato" VARCHAR(100) NOT NULL,
    "telefone_contato" VARCHAR(20),
    "email_contato" VARCHAR(120),
    "tipo_unidade" VARCHAR(6) NOT NULL,
    "status" VARCHAR(9) NOT NULL DEFAULT 'ATIVO',
    "id_operador_vendedor" INTEGER NOT NULL,
    "aceite_lgpd" BOOLEAN NOT NULL,
    "data_aceite_lgpd" TIMESTAMP(6) NOT NULL,
    "data_cadastro" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cliente_pkey" PRIMARY KEY ("id_cliente")
);

-- CreateTable
CREATE TABLE "endereco_cliente" (
    "id_endereco" SERIAL NOT NULL,
    "id_cliente" INTEGER NOT NULL,
    "tipo" VARCHAR(10) NOT NULL,
    "logradouro" VARCHAR(150) NOT NULL,
    "numero" VARCHAR(10) NOT NULL,
    "complemento" VARCHAR(60),
    "bairro" VARCHAR(80) NOT NULL,
    "cidade" VARCHAR(80) NOT NULL,
    "uf" CHAR(2) NOT NULL,
    "cep" CHAR(8) NOT NULL,

    CONSTRAINT "endereco_cliente_pkey" PRIMARY KEY ("id_endereco")
);

-- CreateTable
CREATE TABLE "produto" (
    "id_produto" SERIAL NOT NULL,
    "codigo_interno" VARCHAR(30) NOT NULL,
    "descricao" VARCHAR(200) NOT NULL,
    "ncm" CHAR(8),
    "ean" VARCHAR(14),
    "categoria" VARCHAR(60),
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "produto_pkey" PRIMARY KEY ("id_produto")
);

-- CreateTable
CREATE TABLE "variacao_produto" (
    "id_variacao" SERIAL NOT NULL,
    "id_produto" INTEGER NOT NULL,
    "marca" VARCHAR(60) NOT NULL,
    "tamanho_embalagem" VARCHAR(40) NOT NULL,
    "quantidade_estoque" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "variacao_produto_pkey" PRIMARY KEY ("id_variacao")
);

-- CreateTable
CREATE TABLE "faixa_preco" (
    "id_faixa_preco" SERIAL NOT NULL,
    "id_variacao" INTEGER NOT NULL,
    "quantidade_minima" INTEGER NOT NULL,
    "preco_unitario" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "faixa_preco_pkey" PRIMARY KEY ("id_faixa_preco")
);

-- CreateTable
CREATE TABLE "fardo" (
    "id_fardo" SERIAL NOT NULL,
    "id_variacao" INTEGER NOT NULL,
    "quantidade_unidades" INTEGER NOT NULL,
    "preco_fixo" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "fardo_pkey" PRIMARY KEY ("id_fardo")
);

-- CreateTable
CREATE TABLE "orcamento" (
    "id_orcamento" SERIAL NOT NULL,
    "numero_orcamento" BIGINT,
    "id_cliente" INTEGER NOT NULL,
    "id_operador" INTEGER NOT NULL,
    "id_endereco_entrega" INTEGER,
    "id_pedido" INTEGER,
    "id_orcamento_origem" INTEGER,
    "data_criacao" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data_ultima_edicao" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data_encerramento" TIMESTAMP(6),
    "data_emissao" DATE,
    "data_validade" DATE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'RASCUNHO',
    "motivo_expiracao" VARCHAR(10),
    "numero_solicitacao_compra" VARCHAR(30),
    "contato_solicitacao" VARCHAR(100),
    "prazo_entrega_dias" SMALLINT,
    "primeira_compra" BOOLEAN NOT NULL DEFAULT false,
    "condicao_pagamento" VARCHAR(16),
    "prazo_dias" SMALLINT,
    "numero_parcelas" SMALLINT,
    "modalidade_frete" VARCHAR(3),
    "origem_transportadora" VARCHAR(9),
    "transportadora" VARCHAR(100),
    "valor_frete" DECIMAL(12,2),
    "frete_provisorio" BOOLEAN NOT NULL DEFAULT false,
    "valor_total_itens" DECIMAL(12,2),
    "valor_total_imposto" DECIMAL(12,2),
    "valor_total_proposta" DECIMAL(12,2),
    "justificativa" TEXT,
    "chave_seguranca" VARCHAR(64),

    CONSTRAINT "orcamento_pkey" PRIMARY KEY ("id_orcamento")
);

-- CreateTable
CREATE TABLE "item_orcamento" (
    "id_item" SERIAL NOT NULL,
    "id_orcamento" INTEGER NOT NULL,
    "id_variacao" INTEGER NOT NULL,
    "granularidade" VARCHAR(6) NOT NULL,
    "id_fardo" INTEGER,
    "quantidade_fardos" INTEGER,
    "id_faixa_preco" INTEGER,
    "quantidade_avulsa" INTEGER,
    "preco_unitario_aplicado" DECIMAL(12,2) NOT NULL,
    "valor_imposto" DECIMAL(12,2) NOT NULL,
    "valor_total_item" DECIMAL(12,2) NOT NULL,
    "aprovacao_herdada" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "item_orcamento_pkey" PRIMARY KEY ("id_item")
);

-- CreateTable
CREATE TABLE "reserva_estoque" (
    "id_reserva" SERIAL NOT NULL,
    "id_item" INTEGER NOT NULL,
    "quantidade_reservada" INTEGER NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'CONFIRMADA',
    "data_expiracao" DATE NOT NULL,

    CONSTRAINT "reserva_estoque_pkey" PRIMARY KEY ("id_reserva")
);

-- CreateTable
CREATE TABLE "anexo_orcamento" (
    "id_anexo" SERIAL NOT NULL,
    "id_orcamento" INTEGER NOT NULL,
    "tipo_anexo" VARCHAR(20) NOT NULL,
    "nome_arquivo" VARCHAR(255) NOT NULL,
    "caminho_arquivo" VARCHAR(500) NOT NULL,
    "tamanho_bytes" BIGINT,
    "data_anexo" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anexo_orcamento_pkey" PRIMARY KEY ("id_anexo")
);

-- CreateTable
CREATE TABLE "analise_credito" (
    "id_analise" SERIAL NOT NULL,
    "id_cliente" INTEGER NOT NULL,
    "id_orcamento" INTEGER,
    "data_solicitacao" DATE NOT NULL DEFAULT CURRENT_DATE,
    "resultado" VARCHAR(9),
    "data_analise" DATE,
    "id_operador_fiscal" INTEGER,

    CONSTRAINT "analise_credito_pkey" PRIMARY KEY ("id_analise")
);

-- CreateTable
CREATE TABLE "documento_analise_credito" (
    "id_documento" SERIAL NOT NULL,
    "id_analise" INTEGER NOT NULL,
    "tipo_documento" VARCHAR(25) NOT NULL,
    "nome_arquivo" VARCHAR(255) NOT NULL,
    "caminho_arquivo" VARCHAR(500) NOT NULL,
    "data_recebimento" DATE NOT NULL DEFAULT CURRENT_DATE,

    CONSTRAINT "documento_analise_credito_pkey" PRIMARY KEY ("id_documento")
);

-- CreateTable
CREATE TABLE "divida_inadimplencia" (
    "id_divida" SERIAL NOT NULL,
    "id_cliente" INTEGER NOT NULL,
    "id_operador_registro" INTEGER NOT NULL,
    "valor_divida" DECIMAL(12,2) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'EM_ABERTO',
    "data_vencimento_original" DATE NOT NULL,
    "data_renegociacao" DATE,
    "valor_pago_renegociacao" DECIMAL(12,2),
    "data_protesto" DATE,

    CONSTRAINT "divida_inadimplencia_pkey" PRIMARY KEY ("id_divida")
);

-- CreateTable
CREATE TABLE "historico_orcamento" (
    "id_historico" SERIAL NOT NULL,
    "id_orcamento" INTEGER NOT NULL,
    "id_operador" INTEGER,
    "tipo_evento" VARCHAR(20) NOT NULL,
    "status_anterior" VARCHAR(20),
    "status_novo" VARCHAR(20) NOT NULL,
    "observacao" TEXT,
    "data_registro" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historico_orcamento_pkey" PRIMARY KEY ("id_historico")
);

-- CreateTable
CREATE TABLE "entrada_mercadoria" (
    "id_entrada" SERIAL NOT NULL,
    "id_variacao" INTEGER NOT NULL,
    "id_fornecedor" INTEGER NOT NULL,
    "id_operador" INTEGER NOT NULL,
    "numero_cotacao_compra" VARCHAR(30),
    "quantidade_comprada" INTEGER NOT NULL,
    "quantidade_informada" INTEGER NOT NULL,
    "data_entrada" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id_operador_liberacao" INTEGER,
    "data_liberacao" TIMESTAMP(6),

    CONSTRAINT "entrada_mercadoria_pkey" PRIMARY KEY ("id_entrada")
);

-- CreateTable
CREATE TABLE "fornecedor" (
    "id_fornecedor" SERIAL NOT NULL,
    "cnpj" CHAR(14) NOT NULL,
    "razao_social" VARCHAR(150) NOT NULL,
    "nome_contato" VARCHAR(100),
    "telefone_contato" VARCHAR(20),
    "email_contato" VARCHAR(120),
    "data_cadastro" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fornecedor_pkey" PRIMARY KEY ("id_fornecedor")
);

-- CreateTable
CREATE TABLE "pedido" (
    "id_pedido" SERIAL NOT NULL,
    "id_cliente" INTEGER NOT NULL,
    "id_operador_vendedor" INTEGER NOT NULL,
    "id_endereco_entrega" INTEGER,
    "numero_solicitacao_compra" VARCHAR(30),
    "contato_solicitacao" VARCHAR(100),
    "condicao_pagamento_desejada" VARCHAR(16),
    "prazo_dias_desejado" SMALLINT,
    "numero_parcelas_desejado" SMALLINT,
    "transportadora_indicada" VARCHAR(100),
    "observacoes" TEXT,
    "status" VARCHAR(12) NOT NULL DEFAULT 'SOLICITADO',
    "motivo_negativa" TEXT,
    "id_operador_atendimento" INTEGER,
    "data_solicitacao" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data_decisao" TIMESTAMP(6),

    CONSTRAINT "pedido_pkey" PRIMARY KEY ("id_pedido")
);

-- CreateTable
CREATE TABLE "item_pedido" (
    "id_item_pedido" SERIAL NOT NULL,
    "id_pedido" INTEGER NOT NULL,
    "id_variacao" INTEGER NOT NULL,
    "granularidade" VARCHAR(6) NOT NULL,
    "id_fardo" INTEGER,
    "quantidade_solicitada" INTEGER NOT NULL,

    CONSTRAINT "item_pedido_pkey" PRIMARY KEY ("id_item_pedido")
);

-- CreateTable
CREATE TABLE "resposta_orcamento" (
    "id_resposta" SERIAL NOT NULL,
    "id_orcamento" INTEGER NOT NULL,
    "tipo_resposta" VARCHAR(10) NOT NULL,
    "status_resposta" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    "motivo_tratamento" VARCHAR(22),
    "justificativa" TEXT,
    "id_operador_vendedor" INTEGER NOT NULL,
    "data_resposta" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data_processamento" TIMESTAMP(6),
    "id_operador_tratamento" INTEGER,
    "data_tratamento" TIMESTAMP(6),
    "valor_total_itens_aprovado" DECIMAL(12,2),
    "valor_total_imposto_aprovado" DECIMAL(12,2),
    "modalidade_frete_aceita" VARCHAR(3),
    "valor_frete_aceito" DECIMAL(12,2),
    "valor_total_aceito" DECIMAL(12,2),

    CONSTRAINT "resposta_orcamento_pkey" PRIMARY KEY ("id_resposta")
);

-- CreateTable
CREATE TABLE "item_resposta_orcamento" (
    "id_item_resposta" SERIAL NOT NULL,
    "id_resposta" INTEGER NOT NULL,
    "id_item" INTEGER NOT NULL,
    "quantidade_aprovada" INTEGER NOT NULL,
    "situacao" VARCHAR(12) NOT NULL,
    "id_faixa_preco_aceita" INTEGER,
    "preco_unitario_aceito" DECIMAL(12,2),
    "valor_imposto_aceito" DECIMAL(12,2),
    "valor_total_item_aceito" DECIMAL(12,2),

    CONSTRAINT "item_resposta_orcamento_pkey" PRIMARY KEY ("id_item_resposta")
);

-- CreateTable
CREATE TABLE "movimentacao_estoque" (
    "id_movimentacao" SERIAL NOT NULL,
    "id_variacao" INTEGER NOT NULL,
    "tipo" VARCHAR(7) NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "id_operador" INTEGER,
    "id_orcamento" INTEGER,
    "id_entrada" INTEGER,
    "motivo" TEXT,
    "data_movimentacao" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentacao_estoque_pkey" PRIMARY KEY ("id_movimentacao")
);

-- CreateTable
CREATE TABLE "integrantes_proxy" (
    "id" UUID NOT NULL,
    "nome_sistema" VARCHAR(60) NOT NULL,
    "chave_hash" CHAR(64) NOT NULL,
    "escopos" TEXT[],
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_em" TIMESTAMPTZ(6),

    CONSTRAINT "integrantes_proxy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fila_escrita" (
    "id" UUID NOT NULL,
    "sistema_origem" VARCHAR(100) NOT NULL,
    "dominio" VARCHAR(100) NOT NULL,
    "operacao" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'pendente',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "erro_mensagem" TEXT,

    CONSTRAINT "fila_escrita_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_auditoria" (
    "id" BIGSERIAL NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sistema_origem" VARCHAR(100) NOT NULL,
    "operacao" VARCHAR(120) NOT NULL,
    "resultado_verificacao_risco" VARCHAR(20) NOT NULL,
    "status_execucao" VARCHAR(10) NOT NULL,
    "duracao_ms" INTEGER NOT NULL,
    "request_id" VARCHAR(100) NOT NULL,
    "resultado" VARCHAR(100) NOT NULL,
    "id_usuario" TEXT,
    "ip_origem" INET,

    CONSTRAINT "log_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "operador_usuario_key" ON "operador"("usuario");

-- CreateIndex
CREATE UNIQUE INDEX "operador_email_key" ON "operador"("email");

-- CreateIndex
CREATE UNIQUE INDEX "operador_token_recuperacao_senha_key" ON "operador"("token_recuperacao_senha");

-- CreateIndex
CREATE UNIQUE INDEX "cliente_cnpj_key" ON "cliente"("cnpj");

-- CreateIndex
CREATE INDEX "cliente_id_operador_vendedor_idx" ON "cliente"("id_operador_vendedor");

-- CreateIndex
CREATE INDEX "endereco_cliente_id_cliente_idx" ON "endereco_cliente"("id_cliente");

-- CreateIndex
CREATE UNIQUE INDEX "produto_codigo_interno_key" ON "produto"("codigo_interno");

-- CreateIndex
CREATE UNIQUE INDEX "produto_ean_key" ON "produto"("ean");

-- CreateIndex
CREATE INDEX "variacao_produto_id_produto_idx" ON "variacao_produto"("id_produto");

-- CreateIndex
CREATE INDEX "variacao_produto_marca_tamanho_embalagem_idx" ON "variacao_produto"("marca", "tamanho_embalagem");

-- CreateIndex
CREATE INDEX "faixa_preco_id_variacao_idx" ON "faixa_preco"("id_variacao");

-- CreateIndex
CREATE INDEX "fardo_id_variacao_idx" ON "fardo"("id_variacao");

-- CreateIndex
CREATE UNIQUE INDEX "orcamento_numero_orcamento_key" ON "orcamento"("numero_orcamento");

-- CreateIndex
CREATE UNIQUE INDEX "orcamento_chave_seguranca_key" ON "orcamento"("chave_seguranca");

-- CreateIndex
CREATE INDEX "orcamento_id_cliente_idx" ON "orcamento"("id_cliente");

-- CreateIndex
CREATE INDEX "orcamento_status_idx" ON "orcamento"("status");

-- CreateIndex
CREATE INDEX "orcamento_id_operador_idx" ON "orcamento"("id_operador");

-- CreateIndex
CREATE INDEX "orcamento_id_endereco_entrega_idx" ON "orcamento"("id_endereco_entrega");

-- CreateIndex
CREATE INDEX "orcamento_id_pedido_idx" ON "orcamento"("id_pedido");

-- CreateIndex
CREATE INDEX "orcamento_id_orcamento_origem_idx" ON "orcamento"("id_orcamento_origem");

-- CreateIndex
CREATE INDEX "item_orcamento_id_orcamento_idx" ON "item_orcamento"("id_orcamento");

-- CreateIndex
CREATE INDEX "item_orcamento_id_variacao_idx" ON "item_orcamento"("id_variacao");

-- CreateIndex
CREATE INDEX "item_orcamento_id_fardo_idx" ON "item_orcamento"("id_fardo");

-- CreateIndex
CREATE INDEX "item_orcamento_id_faixa_preco_idx" ON "item_orcamento"("id_faixa_preco");

-- CreateIndex
CREATE UNIQUE INDEX "reserva_estoque_id_item_key" ON "reserva_estoque"("id_item");

-- CreateIndex
CREATE INDEX "anexo_orcamento_id_orcamento_idx" ON "anexo_orcamento"("id_orcamento");

-- CreateIndex
CREATE INDEX "analise_credito_id_cliente_idx" ON "analise_credito"("id_cliente");

-- CreateIndex
CREATE INDEX "analise_credito_id_orcamento_idx" ON "analise_credito"("id_orcamento");

-- CreateIndex
CREATE INDEX "analise_credito_id_operador_fiscal_idx" ON "analise_credito"("id_operador_fiscal");

-- CreateIndex
CREATE INDEX "documento_analise_credito_id_analise_idx" ON "documento_analise_credito"("id_analise");

-- CreateIndex
CREATE INDEX "divida_inadimplencia_id_cliente_status_idx" ON "divida_inadimplencia"("id_cliente", "status");

-- CreateIndex
CREATE INDEX "divida_inadimplencia_id_operador_registro_idx" ON "divida_inadimplencia"("id_operador_registro");

-- CreateIndex
CREATE INDEX "historico_orcamento_id_orcamento_data_registro_idx" ON "historico_orcamento"("id_orcamento", "data_registro");

-- CreateIndex
CREATE INDEX "historico_orcamento_id_operador_idx" ON "historico_orcamento"("id_operador");

-- CreateIndex
CREATE INDEX "entrada_mercadoria_id_variacao_idx" ON "entrada_mercadoria"("id_variacao");

-- CreateIndex
CREATE INDEX "entrada_mercadoria_id_operador_idx" ON "entrada_mercadoria"("id_operador");

-- CreateIndex
CREATE INDEX "entrada_mercadoria_id_operador_liberacao_idx" ON "entrada_mercadoria"("id_operador_liberacao");

-- CreateIndex
CREATE INDEX "entrada_mercadoria_id_fornecedor_idx" ON "entrada_mercadoria"("id_fornecedor");

-- CreateIndex
CREATE UNIQUE INDEX "fornecedor_cnpj_key" ON "fornecedor"("cnpj");

-- CreateIndex
CREATE INDEX "pedido_status_idx" ON "pedido"("status");

-- CreateIndex
CREATE INDEX "pedido_id_cliente_idx" ON "pedido"("id_cliente");

-- CreateIndex
CREATE INDEX "pedido_id_operador_vendedor_idx" ON "pedido"("id_operador_vendedor");

-- CreateIndex
CREATE INDEX "pedido_id_endereco_entrega_idx" ON "pedido"("id_endereco_entrega");

-- CreateIndex
CREATE INDEX "pedido_id_operador_atendimento_idx" ON "pedido"("id_operador_atendimento");

-- CreateIndex
CREATE INDEX "item_pedido_id_pedido_idx" ON "item_pedido"("id_pedido");

-- CreateIndex
CREATE INDEX "item_pedido_id_variacao_idx" ON "item_pedido"("id_variacao");

-- CreateIndex
CREATE INDEX "item_pedido_id_fardo_idx" ON "item_pedido"("id_fardo");

-- CreateIndex
CREATE INDEX "resposta_orcamento_id_orcamento_status_resposta_idx" ON "resposta_orcamento"("id_orcamento", "status_resposta");

-- CreateIndex
CREATE INDEX "resposta_orcamento_id_operador_vendedor_idx" ON "resposta_orcamento"("id_operador_vendedor");

-- CreateIndex
CREATE INDEX "resposta_orcamento_id_operador_tratamento_idx" ON "resposta_orcamento"("id_operador_tratamento");

-- CreateIndex
CREATE INDEX "item_resposta_orcamento_id_resposta_idx" ON "item_resposta_orcamento"("id_resposta");

-- CreateIndex
CREATE INDEX "item_resposta_orcamento_id_item_idx" ON "item_resposta_orcamento"("id_item");

-- CreateIndex
CREATE INDEX "item_resposta_orcamento_id_faixa_preco_aceita_idx" ON "item_resposta_orcamento"("id_faixa_preco_aceita");

-- CreateIndex
CREATE UNIQUE INDEX "item_resposta_por_resposta_unique" ON "item_resposta_orcamento"("id_resposta", "id_item");

-- CreateIndex
CREATE INDEX "movimentacao_estoque_id_variacao_data_movimentacao_idx" ON "movimentacao_estoque"("id_variacao", "data_movimentacao");

-- CreateIndex
CREATE INDEX "movimentacao_estoque_id_operador_idx" ON "movimentacao_estoque"("id_operador");

-- CreateIndex
CREATE INDEX "movimentacao_estoque_id_orcamento_idx" ON "movimentacao_estoque"("id_orcamento");

-- CreateIndex
CREATE INDEX "movimentacao_estoque_id_entrada_idx" ON "movimentacao_estoque"("id_entrada");

-- CreateIndex
CREATE INDEX "integrantes_proxy_ativo_idx" ON "integrantes_proxy"("ativo");

-- CreateIndex
CREATE INDEX "fila_escrita_status_criado_em_idx" ON "fila_escrita"("status", "criado_em");

-- CreateIndex
CREATE INDEX "log_auditoria_timestamp_idx" ON "log_auditoria"("timestamp");

-- CreateIndex
CREATE INDEX "log_auditoria_sistema_origem_idx" ON "log_auditoria"("sistema_origem");

-- AddForeignKey
ALTER TABLE "cliente" ADD CONSTRAINT "cliente_id_operador_vendedor_fkey" FOREIGN KEY ("id_operador_vendedor") REFERENCES "operador"("id_operador") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endereco_cliente" ADD CONSTRAINT "endereco_cliente_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "cliente"("id_cliente") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variacao_produto" ADD CONSTRAINT "variacao_produto_id_produto_fkey" FOREIGN KEY ("id_produto") REFERENCES "produto"("id_produto") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faixa_preco" ADD CONSTRAINT "faixa_preco_id_variacao_fkey" FOREIGN KEY ("id_variacao") REFERENCES "variacao_produto"("id_variacao") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fardo" ADD CONSTRAINT "fardo_id_variacao_fkey" FOREIGN KEY ("id_variacao") REFERENCES "variacao_produto"("id_variacao") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento" ADD CONSTRAINT "orcamento_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "cliente"("id_cliente") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento" ADD CONSTRAINT "orcamento_id_operador_fkey" FOREIGN KEY ("id_operador") REFERENCES "operador"("id_operador") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento" ADD CONSTRAINT "orcamento_id_endereco_entrega_fkey" FOREIGN KEY ("id_endereco_entrega") REFERENCES "endereco_cliente"("id_endereco") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento" ADD CONSTRAINT "orcamento_id_pedido_fkey" FOREIGN KEY ("id_pedido") REFERENCES "pedido"("id_pedido") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento" ADD CONSTRAINT "orcamento_id_orcamento_origem_fkey" FOREIGN KEY ("id_orcamento_origem") REFERENCES "orcamento"("id_orcamento") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_orcamento" ADD CONSTRAINT "item_orcamento_id_orcamento_fkey" FOREIGN KEY ("id_orcamento") REFERENCES "orcamento"("id_orcamento") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_orcamento" ADD CONSTRAINT "item_orcamento_id_variacao_fkey" FOREIGN KEY ("id_variacao") REFERENCES "variacao_produto"("id_variacao") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_orcamento" ADD CONSTRAINT "item_orcamento_id_fardo_fkey" FOREIGN KEY ("id_fardo") REFERENCES "fardo"("id_fardo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_orcamento" ADD CONSTRAINT "item_orcamento_id_faixa_preco_fkey" FOREIGN KEY ("id_faixa_preco") REFERENCES "faixa_preco"("id_faixa_preco") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva_estoque" ADD CONSTRAINT "reserva_estoque_id_item_fkey" FOREIGN KEY ("id_item") REFERENCES "item_orcamento"("id_item") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexo_orcamento" ADD CONSTRAINT "anexo_orcamento_id_orcamento_fkey" FOREIGN KEY ("id_orcamento") REFERENCES "orcamento"("id_orcamento") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analise_credito" ADD CONSTRAINT "analise_credito_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "cliente"("id_cliente") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analise_credito" ADD CONSTRAINT "analise_credito_id_orcamento_fkey" FOREIGN KEY ("id_orcamento") REFERENCES "orcamento"("id_orcamento") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analise_credito" ADD CONSTRAINT "analise_credito_id_operador_fiscal_fkey" FOREIGN KEY ("id_operador_fiscal") REFERENCES "operador"("id_operador") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento_analise_credito" ADD CONSTRAINT "documento_analise_credito_id_analise_fkey" FOREIGN KEY ("id_analise") REFERENCES "analise_credito"("id_analise") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "divida_inadimplencia" ADD CONSTRAINT "divida_inadimplencia_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "cliente"("id_cliente") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "divida_inadimplencia" ADD CONSTRAINT "divida_inadimplencia_id_operador_registro_fkey" FOREIGN KEY ("id_operador_registro") REFERENCES "operador"("id_operador") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historico_orcamento" ADD CONSTRAINT "historico_orcamento_id_orcamento_fkey" FOREIGN KEY ("id_orcamento") REFERENCES "orcamento"("id_orcamento") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historico_orcamento" ADD CONSTRAINT "historico_orcamento_id_operador_fkey" FOREIGN KEY ("id_operador") REFERENCES "operador"("id_operador") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrada_mercadoria" ADD CONSTRAINT "entrada_mercadoria_id_variacao_fkey" FOREIGN KEY ("id_variacao") REFERENCES "variacao_produto"("id_variacao") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrada_mercadoria" ADD CONSTRAINT "entrada_mercadoria_id_operador_fkey" FOREIGN KEY ("id_operador") REFERENCES "operador"("id_operador") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrada_mercadoria" ADD CONSTRAINT "entrada_mercadoria_id_operador_liberacao_fkey" FOREIGN KEY ("id_operador_liberacao") REFERENCES "operador"("id_operador") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrada_mercadoria" ADD CONSTRAINT "entrada_mercadoria_id_fornecedor_fkey" FOREIGN KEY ("id_fornecedor") REFERENCES "fornecedor"("id_fornecedor") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "cliente"("id_cliente") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_id_operador_vendedor_fkey" FOREIGN KEY ("id_operador_vendedor") REFERENCES "operador"("id_operador") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_id_endereco_entrega_fkey" FOREIGN KEY ("id_endereco_entrega") REFERENCES "endereco_cliente"("id_endereco") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_id_operador_atendimento_fkey" FOREIGN KEY ("id_operador_atendimento") REFERENCES "operador"("id_operador") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_pedido" ADD CONSTRAINT "item_pedido_id_pedido_fkey" FOREIGN KEY ("id_pedido") REFERENCES "pedido"("id_pedido") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_pedido" ADD CONSTRAINT "item_pedido_id_variacao_fkey" FOREIGN KEY ("id_variacao") REFERENCES "variacao_produto"("id_variacao") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_pedido" ADD CONSTRAINT "item_pedido_id_fardo_fkey" FOREIGN KEY ("id_fardo") REFERENCES "fardo"("id_fardo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resposta_orcamento" ADD CONSTRAINT "resposta_orcamento_id_orcamento_fkey" FOREIGN KEY ("id_orcamento") REFERENCES "orcamento"("id_orcamento") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resposta_orcamento" ADD CONSTRAINT "resposta_orcamento_id_operador_vendedor_fkey" FOREIGN KEY ("id_operador_vendedor") REFERENCES "operador"("id_operador") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resposta_orcamento" ADD CONSTRAINT "resposta_orcamento_id_operador_tratamento_fkey" FOREIGN KEY ("id_operador_tratamento") REFERENCES "operador"("id_operador") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_resposta_orcamento" ADD CONSTRAINT "item_resposta_orcamento_id_resposta_fkey" FOREIGN KEY ("id_resposta") REFERENCES "resposta_orcamento"("id_resposta") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_resposta_orcamento" ADD CONSTRAINT "item_resposta_orcamento_id_item_fkey" FOREIGN KEY ("id_item") REFERENCES "item_orcamento"("id_item") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_resposta_orcamento" ADD CONSTRAINT "item_resposta_orcamento_id_faixa_preco_aceita_fkey" FOREIGN KEY ("id_faixa_preco_aceita") REFERENCES "faixa_preco"("id_faixa_preco") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacao_estoque" ADD CONSTRAINT "movimentacao_estoque_id_variacao_fkey" FOREIGN KEY ("id_variacao") REFERENCES "variacao_produto"("id_variacao") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacao_estoque" ADD CONSTRAINT "movimentacao_estoque_id_operador_fkey" FOREIGN KEY ("id_operador") REFERENCES "operador"("id_operador") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacao_estoque" ADD CONSTRAINT "movimentacao_estoque_id_orcamento_fkey" FOREIGN KEY ("id_orcamento") REFERENCES "orcamento"("id_orcamento") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacao_estoque" ADD CONSTRAINT "movimentacao_estoque_id_entrada_fkey" FOREIGN KEY ("id_entrada") REFERENCES "entrada_mercadoria"("id_entrada") ON DELETE SET NULL ON UPDATE CASCADE;
