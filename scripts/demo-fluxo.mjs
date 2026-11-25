#!/usr/bin/env node
// Roteiro de demonstração ponta a ponta pela API do backend (docs/frontend-api.md):
// login, ficha do cliente, busca de produtos, orçamento (UC14), itens, bloqueio de estoque (UC19-E5),
// condições, emissão (UC19), PDF (UC08) e logout. Opcionalmente envia o PDF por e-mail (--enviar).
//
// Uso (o padrão é SIMULAR: não faz nenhuma chamada de rede, só mostra o plano):
//   node scripts/demo-fluxo.mjs                       # simula
//   node scripts/demo-fluxo.mjs --executar            # chama a API de verdade
//   node scripts/demo-fluxo.mjs --executar --enviar   # inclui POST /orcamentos/:id/enviar (manda e-mail)
//
// Variáveis de ambiente (nada é impresso além do host da URL):
//   DEMO_API_URL   URL do backend, sem barra final (padrão: http://localhost:3000)
//   DEMO_USUARIO   usuário que faz o fluxo (padrão: operador)
//   DEMO_SENHA     senha do usuário (obrigatória com --executar; nunca por argumento)
//   DEMO_CNPJ      CNPJ do cliente do seed (padrão: 11222333000181)
//
// ATENÇÃO: com --executar o orçamento é EMITIDO de verdade (e fica imutável). Use contra dados de
// demonstração. No Render (plano gratuito) acorde o proxy e depois o backend antes (APRESENTACAO.md).
// Três senhas erradas bloqueiam a conta (UC13): o roteiro para no primeiro erro de login.
// Node >= 20 (fetch nativo). Sem dependências.

import { randomUUID } from "node:crypto";

const args = new Set(process.argv.slice(2));
const conhecidos = new Set(["--executar", "--enviar", "--simular", "--ajuda"]);
const desconhecido = [...args].find((a) => !conhecidos.has(a));
if (args.has("--ajuda") || desconhecido) {
  console.log(
    "Uso: node scripts/demo-fluxo.mjs [--simular | --executar] [--enviar]",
  );
  process.exit(desconhecido ? 2 : 0);
}
if (args.has("--executar") && args.has("--simular")) {
  console.error("Use --simular ou --executar, não os dois.");
  process.exit(2);
}
const EXECUTAR = args.has("--executar");
const ENVIAR = args.has("--enviar");

const BASE = (process.env.DEMO_API_URL ?? "http://localhost:3000").replace(
  /\/+$/,
  "",
);
const USUARIO = process.env.DEMO_USUARIO ?? "operador";
const CNPJ = (process.env.DEMO_CNPJ ?? "11222333000181").replace(/\D/g, "");
const SENHA = process.env.DEMO_SENHA;

// Itens do roteiro (códigos do seed-demo.cjs). Arroz 5 kg x 30 passa do mínimo de R$ 500 (inclusivo).
const ITEM_OK = { codigo: "DEMO-ARROZ-5", quantidade: 30 };
const ITEM_SEM_ESTOQUE = { codigo: "DEMO-CAFE-500", quantidade: 1 }; // sem estoque de propósito
// Frete FOB pela SupriMax precisa do valor cotado (em centavos): sem ele o frete fica provisório e o
// banco recusa a emissão (FRETE_PROVISORIO_NAO_EMITIVEL).
const CONDICOES = {
  condicaoPagamento: "ADIANTADO_100",
  origemTransportadora: "SUPRIMAX",
  valorFrete: 5000,
};

const estado = { token: null, cliente: null, idOrcamento: null, produtos: {} };
let falhou = false;

function host(url) {
  try {
    return new URL(url).host;
  } catch {
    return "(URL inválida)";
  }
}

async function chamar(
  metodo,
  caminho,
  { corpo, idempotente = false, bruto = false } = {},
) {
  const cab = {};
  if (estado.token) cab.Authorization = `Bearer ${estado.token}`;
  if (corpo !== undefined) cab["Content-Type"] = "application/json";
  if (idempotente) cab["Idempotency-Key"] = randomUUID();
  const r = await fetch(BASE + caminho, {
    method: metodo,
    headers: cab,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(90_000), // Render hibernado leva de 30 a 60 s
  });
  if (bruto)
    return { status: r.status, corpo: Buffer.from(await r.arrayBuffer()) };
  const texto = await r.text();
  let dados = texto;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    /* corpo não JSON: fica como texto */
  }
  return { status: r.status, corpo: dados };
}

/** Mensagem de erro segura: só código e mensagem da API, nunca o corpo inteiro. */
function erroDe(r) {
  const c = r.corpo;
  return c && typeof c === "object" && c.codigo
    ? `${c.codigo}: ${c.mensagem}`
    : `HTTP ${r.status}`;
}

function formatar(centavos) {
  const reais = (centavos / 100).toFixed(2).replace(".", ",");
  return `R$ ${reais.replace(/\B(?=(\d{3})+,)/g, ".")}`;
}

async function passo(n, titulo, plano, fn) {
  console.log(`\n[${n}] ${titulo}`);
  console.log(`    ${plano}`);
  if (!EXECUTAR) return;
  try {
    await fn();
  } catch (e) {
    falhou = true;
    console.error(`    FALHOU: ${e.message}`);
    throw e;
  }
}

function exigir(r, esperados, oQue) {
  if (!esperados.includes(r.status))
    throw new Error(`${oQue} → ${r.status} ${erroDe(r)}`);
}

async function main() {
  console.log(
    `Roteiro de demonstração — modo ${EXECUTAR ? "EXECUÇÃO" : "SIMULAÇÃO (nada é chamado)"}`,
  );
  console.log(
    `API: ${host(BASE)} · usuário: ${USUARIO} · CNPJ: ${CNPJ}${ENVIAR ? " · com envio de e-mail" : ""}`,
  );
  if (EXECUTAR && !SENHA) {
    console.error(
      "Defina DEMO_SENHA no ambiente (a senha nunca vai por argumento).",
    );
    process.exit(2);
  }
  if (!EXECUTAR)
    console.log(
      "Para chamar de verdade: DEMO_SENHA=... node scripts/demo-fluxo.mjs --executar",
    );

  await passo(
    1,
    "Login (UC13)",
    "POST /auth/login {usuario, senha} → token",
    async () => {
      const r = await chamar("POST", "/auth/login", {
        corpo: { usuario: USUARIO, senha: SENHA },
      });
      exigir(r, [200], "login");
      estado.token = r.corpo.token;
      console.log(`    ok: perfil ${r.corpo.usuario?.perfil ?? "?"}`);
    },
  );

  await passo(2, "Sessão", "GET /auth/me", async () => {
    const r = await chamar("GET", "/auth/me");
    exigir(r, [200], "sessão");
    console.log("    ok: sessão válida");
  });

  await passo(
    3,
    "Ficha do cliente (UC03)",
    `GET /clientes/busca?cnpj=${CNPJ}`,
    async () => {
      const r = await chamar("GET", `/clientes/busca?cnpj=${CNPJ}`);
      exigir(r, [200], "cliente");
      estado.cliente = r.corpo;
      console.log(
        `    ok: ${r.corpo.razaoSocial} (${r.corpo.status}), dívida em aberto ${formatar(r.corpo.dividaEmAberto)}`,
      );
      if (r.corpo.status !== "ATIVO" || r.corpo.dividaEmAberto > 0) {
        throw new Error(
          "cliente bloqueado para orçamento (UC14-E1/E2); escolha outro em DEMO_CNPJ",
        );
      }
    },
  );

  await passo(
    4,
    "Busca de produtos (UC04)",
    `GET /produtos/busca?q=DEMO&idCliente=<id> → ${ITEM_OK.codigo} e ${ITEM_SEM_ESTOQUE.codigo}`,
    async () => {
      const r = await chamar(
        "GET",
        `/produtos/busca?q=DEMO&idCliente=${estado.cliente.idCliente}`,
      );
      exigir(r, [200], "busca de produtos");
      for (const item of [ITEM_OK, ITEM_SEM_ESTOQUE]) {
        const p = r.corpo.find((x) => x.codigoInterno === item.codigo);
        if (!p?.variacoes?.length)
          throw new Error(
            `produto ${item.codigo} não encontrado: o seed rodou?`,
          );
        const v = p.variacoes[0];
        estado.produtos[item.codigo] = v.idVariacao;
        console.log(
          `    ok: ${item.codigo} → variação ${v.idVariacao}, saldo ${v.saldoDisponivel}`,
        );
      }
    },
  );

  await passo(
    5,
    "Criar rascunho (UC14)",
    "POST /orcamentos {idCliente} → 201 RASCUNHO",
    async () => {
      const corpo = { idCliente: estado.cliente.idCliente };
      const r = await chamar("POST", "/orcamentos", {
        corpo,
        idempotente: true,
      });
      exigir(r, [201], "criar orçamento");
      estado.idOrcamento = r.corpo.idOrcamento;
      console.log(
        `    ok: orçamento ${estado.idOrcamento} (${r.corpo.status})`,
      );
    },
  );

  const base = () => `/orcamentos/${estado.idOrcamento}`;
  const itemDe = (item) => ({
    idVariacao: estado.produtos[item.codigo],
    granularidade: "AVULSO",
    quantidade: item.quantidade,
  });

  await passo(
    6,
    "Bloqueio por estoque (UC19-E5)",
    `POST /orcamentos/:id/itens ${ITEM_SEM_ESTOQUE.codigo} → recusado (ESTOQUE_INDISPONIVEL)`,
    async () => {
      const r = await chamar("POST", `${base()}/itens`, {
        corpo: itemDe(ITEM_SEM_ESTOQUE),
        idempotente: true,
      });
      if (r.status < 400)
        throw new Error("esperava recusa por estoque, mas o item foi aceito");
      console.log(`    ok: recusado como esperado (${erroDe(r)})`);
    },
  );

  await passo(
    7,
    "Adicionar item",
    `POST /orcamentos/:id/itens ${ITEM_OK.codigo} x ${ITEM_OK.quantidade}`,
    async () => {
      const r = await chamar("POST", `${base()}/itens`, {
        corpo: itemDe(ITEM_OK),
        idempotente: true,
      });
      exigir(r, [200, 201], "adicionar item");
      console.log(
        `    ok: total dos itens ${formatar(r.corpo.condicoes?.valorTotalItens ?? r.corpo.valorTotalItens ?? 0)} (imposto de 18% calculado pelo backend)`,
      );
    },
  );

  await passo(
    8,
    "Condições de pagamento e frete",
    `PUT /orcamentos/:id/condicoes ${JSON.stringify(CONDICOES)}`,
    async () => {
      const r = await chamar("PUT", `${base()}/condicoes`, {
        corpo: CONDICOES,
        idempotente: true,
      });
      exigir(r, [200], "condições");
      const bloqueios = r.corpo.condicoes?.bloqueios ?? [];
      console.log(
        `    ok: bloqueios de emissão: ${bloqueios.length ? bloqueios.map((b) => b.codigo).join(", ") : "nenhum"}`,
      );
      if (bloqueios.length)
        throw new Error(
          `não dá para emitir: ${bloqueios.map((b) => b.mensagem).join(" | ")}`,
        );
    },
  );

  await passo(
    9,
    "Emitir (UC19)",
    "POST /orcamentos/:id/emitir → ABERTO, com número (imutável daqui em diante)",
    async () => {
      const r = await chamar("POST", `${base()}/emitir`, { idempotente: true });
      exigir(r, [200, 201], "emitir");
      console.log(
        `    ok: orçamento nº ${r.corpo.numeroOrcamento ?? "?"} (${r.corpo.status}), validade ${r.corpo.dataValidade ?? "?"}`,
      );
    },
  );

  await passo(
    10,
    "PDF do orçamento (UC08)",
    "GET /orcamentos/:id/pdf",
    async () => {
      const r = await chamar("GET", `${base()}/pdf`, { bruto: true });
      exigir(r, [200], "PDF");
      if (r.corpo.subarray(0, 4).toString() !== "%PDF")
        throw new Error("a resposta não é um PDF");
      console.log(`    ok: PDF de ${r.corpo.length} bytes`);
    },
  );

  const planoEnvio = ENVIAR
    ? "POST /orcamentos/:id/enviar → 204 (envia e-mail ao vendedor)"
    : "pulado (use --enviar; manda e-mail de verdade)";
  await passo(11, "Enviar ao vendedor (UC08)", planoEnvio, async () => {
    if (!ENVIAR) return console.log("    pulado");
    const r = await chamar("POST", `${base()}/enviar`, { idempotente: true });
    exigir(r, [204], "enviar");
    console.log("    ok: enviado");
  });

  await passo(12, "Logout (UC13)", "POST /auth/logout → 204", async () => {
    const r = await chamar("POST", "/auth/logout");
    exigir(r, [204], "logout");
    estado.token = null;
    console.log("    ok: sessão encerrada");
  });

  console.log(
    EXECUTAR
      ? "\nRoteiro concluído."
      : "\nSimulação concluída: nada foi enviado ao backend.",
  );
}

main().catch(async (e) => {
  if (estado.token) {
    // Encerra a sessão mesmo na falha; o erro original é o que importa.
    try {
      await chamar("POST", "/auth/logout");
    } catch {
      /* ignorado */
    }
  }
  if (!falhou) console.error(`Erro: ${e.message}`);
  process.exit(1);
});
