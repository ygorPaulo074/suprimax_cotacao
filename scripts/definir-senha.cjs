#!/usr/bin/env node
// Define a senha de um usuário existente ou cria um usuário já com senha, direto no banco.
// Existe porque o envio de e-mail (link de definição e de recuperação de senha, UC13 e UC25) ainda não
// está implementado: sem ele, um usuário criado pela tela não consegue entrar e ninguém troca a senha.
//
// Uso (o padrão é SIMULAR: roda tudo e desfaz; só grava com --gravar):
//   node scripts/definir-senha.cjs trocar <usuario> [--gravar]
//   node scripts/definir-senha.cjs criar  <usuario> <email> <perfil> [--gravar]
//
// A senha NUNCA vai por argumento (ficaria no histórico do terminal):
//   - em terminal interativo ela é pedida duas vezes, sem aparecer na tela;
//   - sem terminal (scripts), use a variável de ambiente SENHA_NOVA.
//
// Conexão: DIRECT_URL (ou DATABASE_URL) no ambiente; se ausente, lê o DIRECT_URL do database.env da
// pasta gerada mais recente por scripts/gerar-env.cjs. Este script grava no banco indicado: confira o
// host impresso antes de usar --gravar.
//
// O hash é o mesmo do backend (bcrypt, custo 12). Só usa pg (de proxy/node_modules) e bcryptjs (de
// backend/node_modules): rode `npm ci` nos dois. Sessões já abertas no backend continuam valendo até
// expirarem por inatividade ou até o backend reiniciar.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const raiz = path.resolve(__dirname, '..');
const { Client } = require(path.join(raiz, 'proxy/node_modules/pg'));
const bcrypt = require(path.join(raiz, 'backend/node_modules/bcryptjs'));

const CUSTO_BCRYPT = 12; // o mesmo do backend (senha.ts)
const TAMANHO_MINIMO = 8; // RN01
const TAMANHO_MAXIMO = 200;
const SENHA_PUBLICA_DE_DEMONSTRACAO = 'Suprimax@2026'; // a do seed-demo.cjs: não vale como senha nova
const PERFIS = ['VENDEDOR', 'OPERADOR', 'OPERADOR_CHEFE', 'FISCAL', 'FINANCEIRO', 'GESTOR', 'ADMIN'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

/** Lê uma linha do terminal sem ecoar o que é digitado. */
function lerOculto(pergunta) {
  return new Promise((resolve, reject) => {
    const entrada = process.stdin;
    process.stdout.write(pergunta);
    entrada.setRawMode(true);
    entrada.resume();
    entrada.setEncoding('utf8');
    let texto = '';
    const encerrar = (erro) => {
      entrada.setRawMode(false);
      entrada.pause();
      entrada.removeListener('data', aoReceber);
      process.stdout.write('\n');
      if (erro) reject(erro);
      else resolve(texto);
    };
    const aoReceber = (trecho) => {
      for (const c of trecho) {
        if (c === '\r' || c === '\n') return encerrar();
        if (c === '\u0003') return encerrar(new Error('Cancelado.'));
        if (c === '\u007f' || c === '\b') texto = texto.slice(0, -1);
        else if (c >= ' ') texto += c;
      }
    };
    entrada.on('data', aoReceber);
  });
}

async function obterSenha() {
  if (process.stdin.isTTY) {
    const a = await lerOculto('Nova senha: ');
    const b = await lerOculto('Repita a nova senha: ');
    if (a !== b) throw new Error('As senhas não conferem.');
    return a;
  }
  if (!process.env.SENHA_NOVA) {
    throw new Error('Sem terminal interativo: defina a variável de ambiente SENHA_NOVA.');
  }
  return process.env.SENHA_NOVA;
}

function validarSenha(senha) {
  if (senha.length < TAMANHO_MINIMO) throw new Error(`A senha precisa ter no mínimo ${TAMANHO_MINIMO} caracteres (RN01).`);
  if (senha.length > TAMANHO_MAXIMO) throw new Error(`A senha pode ter no máximo ${TAMANHO_MAXIMO} caracteres.`);
  if (senha === SENHA_PUBLICA_DE_DEMONSTRACAO) throw new Error('Essa é a senha pública de demonstração: escolha outra.');
}

function lerArgumentos(argv) {
  const gravar = argv.includes('--gravar');
  const [comando, ...resto] = argv.filter((a) => !a.startsWith('--'));
  if (comando === 'trocar' && resto.length === 1) return { comando, gravar, usuario: resto[0] };
  if (comando === 'criar' && resto.length === 3) {
    const [usuario, email, perfil] = resto;
    if (!EMAIL.test(email)) throw new Error('E-mail inválido.');
    if (!PERFIS.includes(perfil)) throw new Error(`Perfil inválido. Use um de: ${PERFIS.join(', ')}.`);
    if (usuario.length > 50) throw new Error('O usuário pode ter no máximo 50 caracteres.');
    return { comando, gravar, usuario, email: email.toLowerCase(), perfil };
  }
  throw new Error('Uso: definir-senha.cjs trocar <usuario> [--gravar]  |  criar <usuario> <email> <perfil> [--gravar]');
}

async function main() {
  const args = lerArgumentos(process.argv.slice(2));
  const url = conexao();
  const alvo = new URL(url);
  const modo = args.gravar ? '--gravar' : 'SIMULAÇÃO (nada é gravado; use --gravar)';
  console.log(`Banco: ${alvo.hostname}:${alvo.port || 5432}${alvo.pathname}  (${modo})`);

  const senha = await obterSenha();
  validarSenha(senha);
  const hash = await bcrypt.hash(senha, CUSTO_BCRYPT);

  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    await db.query('BEGIN');
    if (args.comando === 'trocar') {
      // Também zera o bloqueio por tentativas inválidas e invalida um link de recuperação pendente.
      const r = await db.query(
        `UPDATE operador
            SET senha_hash = $1, tentativas_login_invalidas = 0, bloqueado_ate = NULL,
                token_recuperacao_senha = NULL, validade_token = NULL
          WHERE usuario = $2 RETURNING usuario, perfil, status`,
        [hash, args.usuario],
      );
      if (!r.rowCount) throw new Error(`Usuário "${args.usuario}" não existe.`);
      const u = r.rows[0];
      console.log(`Senha de ${u.usuario} (${u.perfil}, ${u.status}) ${args.gravar ? 'trocada.' : 'seria trocada.'}`);
      if (u.status !== 'ATIVO') console.warn('AVISO: o usuário não está ATIVO e continuará sem conseguir entrar.');
    } else {
      const r = await db.query(
        `INSERT INTO operador (usuario, email, senha_hash, perfil, status)
         VALUES ($1, $2, $3, $4, 'ATIVO') ON CONFLICT DO NOTHING RETURNING usuario, perfil`,
        [args.usuario, args.email, hash, args.perfil],
      );
      if (!r.rowCount) throw new Error(`Já existe um usuário com o nome "${args.usuario}" ou com esse e-mail. Use "trocar".`);
      console.log(`Usuário ${args.usuario} (${args.perfil}) ${args.gravar ? 'criado.' : 'seria criado.'}`);
    }
    await db.query(args.gravar ? 'COMMIT' : 'ROLLBACK');
    if (!args.gravar) console.log('Simulação OK: nada foi gravado.');
  } catch (e) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error('Erro:', String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '<url>'));
  process.exit(1);
});
