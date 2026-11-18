// UC13, UC25 — envio por Resend com `fetch` falso e escolha do notificador pela configuração.
import { carregarConfig } from '../config';
import { criarLogger } from '../log';
import {
  NotificadorDeRecuperacaoDeSenhaMudo,
  NotificadorDeRecuperacaoDeSenhaPorEmail,
} from '../modulos/auth/notificador';
import { NotificadorDeEmailMudo } from '../modulos/usuarios/notificador';
import { EmailViaResend, ErroDeEnvioDeEmail, URL_DO_RESEND, type FetchDeEmail } from './enviador';
import { criarNotificadoresDeEmail } from './notificadores';
import { montarLinkDeSenha } from './linkDeSenha';

const CHAVE = 're_chave_secreta';
const TOKEN = 'token/secreto+do=link';
const EMAIL = 'davi@suprimax.com.br';
const VALIDADE = new Date('2026-11-12T15:00:00Z');
const FRONTEND = 'https://app.suprimax.com.br';

interface Chamada {
  readonly url: string;
  readonly init: RequestInit;
}

function fetchFalso(resposta: () => Response | Promise<Response>) {
  const chamadas: Chamada[] = [];
  const fetchDeEmail: FetchDeEmail = (url, init) => {
    chamadas.push({ url, init });
    return Promise.resolve(resposta());
  };
  return { chamadas, fetchDeEmail };
}

const ok = () => new Response('{"id":"1"}', { status: 200 });

describe('EmailViaResend', () => {
  it('faz POST em /emails com Bearer e o corpo no formato do Resend', async () => {
    const { chamadas, fetchDeEmail } = fetchFalso(ok);
    const enviador = new EmailViaResend({
      chaveDaApi: CHAVE,
      remetente: 'SupriMax <nao-responda@suprimax.com.br>',
      fetch: fetchDeEmail,
    });

    await enviador.enviar({ para: EMAIL, assunto: 'Assunto', texto: 'texto', html: '<p>html</p>' });

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.url).toBe(URL_DO_RESEND);
    expect(chamadas[0]?.init.method).toBe('POST');
    expect(chamadas[0]?.init.headers).toMatchObject({ Authorization: `Bearer ${CHAVE}` });
    expect(JSON.parse(String(chamadas[0]?.init.body))).toEqual({
      from: 'SupriMax <nao-responda@suprimax.com.br>',
      to: [EMAIL],
      subject: 'Assunto',
      text: 'texto',
      html: '<p>html</p>',
    });
  });

  it('envia anexos em base64 no campo attachments (UC08)', async () => {
    const { chamadas, fetchDeEmail } = fetchFalso(ok);
    const enviador = new EmailViaResend({
      chaveDaApi: CHAVE,
      remetente: 'a@b.com',
      fetch: fetchDeEmail,
    });

    await enviador.enviar({
      para: EMAIL,
      assunto: 'a',
      texto: 't',
      html: 'h',
      anexos: [{ nomeArquivo: 'orcamento-1.pdf', conteudo: Buffer.from('%PDF-x') }],
    });

    expect(JSON.parse(String(chamadas[0]?.init.body))).toMatchObject({
      attachments: [
        { filename: 'orcamento-1.pdf', content: Buffer.from('%PDF-x').toString('base64') },
      ],
    });
  });

  it('lança erro sem endereço nem chave quando o Resend recusa', async () => {
    const { fetchDeEmail } = fetchFalso(() => new Response(`{"to":"${EMAIL}"}`, { status: 422 }));
    const enviador = new EmailViaResend({
      chaveDaApi: CHAVE,
      remetente: 'a@b.com',
      fetch: fetchDeEmail,
    });

    const erro: unknown = await enviador
      .enviar({ para: EMAIL, assunto: 'a', texto: 't', html: 'h' })
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDeEnvioDeEmail);
    expect((erro as ErroDeEnvioDeEmail).status).toBe(422);
    expect((erro as Error).message).not.toContain(EMAIL);
    expect((erro as Error).message).not.toContain(CHAVE);
  });

  it('lança erro genérico quando a requisição não completa', async () => {
    const fetchDeEmail: FetchDeEmail = () =>
      Promise.reject(new Error(`falha ao chamar com ${CHAVE} e ${EMAIL}`));
    const enviador = new EmailViaResend({
      chaveDaApi: CHAVE,
      remetente: 'a@b.com',
      fetch: fetchDeEmail,
    });

    const erro: unknown = await enviador
      .enviar({ para: EMAIL, assunto: 'a', texto: 't', html: 'h' })
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDeEnvioDeEmail);
    expect((erro as Error).message).not.toContain(EMAIL);
    expect((erro as Error).message).not.toContain(CHAVE);
  });
});

describe('montarLinkDeSenha', () => {
  it('monta ${FRONTEND_URL}/redefinir-senha?token=… com o token codificado', () => {
    expect(montarLinkDeSenha(`${FRONTEND}/`, TOKEN)).toBe(
      `${FRONTEND}/redefinir-senha?token=${encodeURIComponent(TOKEN)}`,
    );
  });
});

describe('criarNotificadoresDeEmail', () => {
  const linhas: Record<string, unknown>[] = [];
  const destino = { write: (linha: string) => void linhas.push(JSON.parse(linha)) };
  const logger = criarLogger({ nivel: 'info', destino });
  const configComResend = carregarConfig({
    RESEND_API_KEY: CHAVE,
    EMAIL_REMETENTE: 'SupriMax <nao-responda@suprimax.com.br>',
    FRONTEND_URL: FRONTEND,
  });

  beforeEach(() => {
    linhas.length = 0;
  });

  it('sem RESEND_API_KEY usa os notificadores mudos, que não chamam o fetch', async () => {
    const { chamadas, fetchDeEmail } = fetchFalso(ok);
    const { notificador, notificadorDeRecuperacao } = criarNotificadoresDeEmail(
      carregarConfig({}),
      logger,
      fetchDeEmail,
    );

    expect(notificador).toBeInstanceOf(NotificadorDeEmailMudo);
    expect(notificadorDeRecuperacao).toBeInstanceOf(NotificadorDeRecuperacaoDeSenhaMudo);
    await notificadorDeRecuperacao.enviarRecuperacaoDeSenha({
      idOperador: 1,
      usuario: 'davi',
      email: EMAIL,
      token: TOKEN,
      validade: VALIDADE,
    });
    expect(chamadas).toHaveLength(0);
  });

  it('UC25: o convite sai com o link de definição de senha e sem nada em log', async () => {
    const { chamadas, fetchDeEmail } = fetchFalso(ok);
    const { notificador } = criarNotificadoresDeEmail(configComResend, logger, fetchDeEmail);

    await notificador.enviarDefinicaoDeSenha({
      idOperador: 9,
      usuario: 'davi',
      email: EMAIL,
      token: TOKEN,
      validade: VALIDADE,
    });

    const corpo = JSON.parse(String(chamadas[0]?.init.body)) as { to: string[]; text: string };
    expect(corpo.to).toEqual([EMAIL]);
    expect(corpo.text).toContain(`${FRONTEND}/redefinir-senha?token=${encodeURIComponent(TOKEN)}`);
    expect(JSON.stringify(linhas)).not.toMatch(/token|davi@|re_chave/);
  });

  it('UC13: a recuperação sai com o link; falha do provedor propaga para o serviço tratar', async () => {
    const enviada = fetchFalso(ok);
    const { notificadorDeRecuperacao } = criarNotificadoresDeEmail(
      configComResend,
      logger,
      enviada.fetchDeEmail,
    );
    expect(notificadorDeRecuperacao).toBeInstanceOf(NotificadorDeRecuperacaoDeSenhaPorEmail);
    const recuperacao = {
      idOperador: 1,
      usuario: 'davi',
      email: EMAIL,
      token: TOKEN,
      validade: VALIDADE,
    };

    await notificadorDeRecuperacao.enviarRecuperacaoDeSenha(recuperacao);
    expect(String(enviada.chamadas[0]?.init.body)).toContain('redefinir-senha?token=');

    const recusada = fetchFalso(() => new Response('{}', { status: 500 }));
    const falho = criarNotificadoresDeEmail(configComResend, logger, recusada.fetchDeEmail);
    await expect(
      falho.notificadorDeRecuperacao.enviarRecuperacaoDeSenha(recuperacao),
    ).rejects.toBeInstanceOf(ErroDeEnvioDeEmail);
  });
});

describe('configuração do e-mail', () => {
  it('lê a chave, o remetente e a URL do frontend sem barra final', () => {
    const config = carregarConfig({
      RESEND_API_KEY: CHAVE,
      EMAIL_REMETENTE: 'a@b.com',
      FRONTEND_URL: `${FRONTEND}/`,
    });
    expect(config).toMatchObject({
      resendApiKey: CHAVE,
      emailRemetente: 'a@b.com',
      frontendUrl: FRONTEND,
    });
  });

  it('exige remetente e URL do frontend quando há chave, sem citar os valores', () => {
    let mensagem = '';
    try {
      carregarConfig({ RESEND_API_KEY: CHAVE });
    } catch (erro) {
      mensagem = (erro as Error).message;
    }
    expect(mensagem).toContain('EMAIL_REMETENTE');
    expect(mensagem).toContain('FRONTEND_URL');
    expect(mensagem).not.toContain(CHAVE);
  });
});
