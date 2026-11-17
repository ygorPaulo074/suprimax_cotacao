// UC13, UC25 — texto e link dos e-mails de definição e de recuperação de senha.
import type { MensagemDeEmail } from './enviador';

/** Rota do frontend (frontend/src/App.tsx) que recebe o token e pede a nova senha. */
export const CAMINHO_DE_REDEFINIR_SENHA = '/redefinir-senha';
const FUSO = 'America/Sao_Paulo';

export function montarLinkDeSenha(frontendUrl: string, token: string): string {
  const base = frontendUrl.replace(/\/+$/, '');
  return `${base}${CAMINHO_DE_REDEFINIR_SENHA}?token=${encodeURIComponent(token)}`;
}

function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatarValidade(validade: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: FUSO,
  }).format(validade);
}

export interface DadosDoEmailDeSenha {
  readonly usuario: string;
  readonly email: string;
  readonly token: string;
  readonly validade: Date;
  readonly frontendUrl: string;
}

/** Monta o e-mail; `abertura` é a frase que explica por que ele chegou. */
export function montarEmailDeSenha(
  dados: DadosDoEmailDeSenha,
  assunto: string,
  abertura: string,
): MensagemDeEmail {
  const link = montarLinkDeSenha(dados.frontendUrl, dados.token);
  const validade = formatarValidade(dados.validade);
  const texto = [
    `Olá, ${dados.usuario}.`,
    '',
    abertura,
    link,
    '',
    `O link vale até ${validade} e só pode ser usado uma vez.`,
    'Se você não esperava este e-mail, ignore-o.',
  ].join('\n');
  const html =
    `<p>Olá, ${escaparHtml(dados.usuario)}.</p><p>${escaparHtml(abertura)}</p>` +
    `<p><a href="${escaparHtml(link)}">${escaparHtml(link)}</a></p>` +
    `<p>O link vale até ${escaparHtml(validade)} e só pode ser usado uma vez.<br>` +
    'Se você não esperava este e-mail, ignore-o.</p>';
  return { para: dados.email, assunto, texto, html };
}
