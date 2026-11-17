// UC13, UC25 — interface única de envio de e-mail e a implementação por Resend (fetch, sem SDK).
/** Um e-mail pronto para sair. */
export interface MensagemDeEmail {
  /** Endereço do destinatário. Nunca registre em log. */
  readonly para: string;
  readonly assunto: string;
  readonly texto: string;
  readonly html: string;
}

/** Envio de e-mail do sistema. Os notificadores dependem só desta interface. */
export interface EnviadorDeEmail {
  /** @throws {ErroDeEnvioDeEmail} Se o provedor recusar ou não responder. */
  enviar(mensagem: MensagemDeEmail): Promise<void>;
}

/** Falha do provedor de e-mail. A mensagem não leva endereço, token nem chave. */
export class ErroDeEnvioDeEmail extends Error {
  constructor(
    mensagem: string,
    public readonly status?: number,
  ) {
    super(mensagem);
    this.name = 'ErroDeEnvioDeEmail';
  }
}

export const URL_DO_RESEND = 'https://api.resend.com/emails';
export const PRAZO_DO_RESEND_MS = 10_000;

export type FetchDeEmail = (url: string, init: RequestInit) => Promise<Response>;

export interface OpcoesDoEmailViaResend {
  readonly chaveDaApi: string;
  /** Remetente verificado no Resend, por exemplo `SupriMax <nao-responda@dominio.com.br>`. */
  readonly remetente: string;
  /** Substituível nos testes; por padrão, o `fetch` global. */
  readonly fetch?: FetchDeEmail;
}

/** Envia pelo Resend (`POST /emails`, Bearer). */
export class EmailViaResend implements EnviadorDeEmail {
  private readonly fetch: FetchDeEmail;

  constructor(private readonly opcoes: OpcoesDoEmailViaResend) {
    this.fetch = opcoes.fetch ?? ((url, init) => fetch(url, init));
  }

  async enviar({ para, assunto, texto, html }: MensagemDeEmail): Promise<void> {
    let resposta: Response;
    try {
      resposta = await this.fetch(URL_DO_RESEND, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.opcoes.chaveDaApi}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.opcoes.remetente,
          to: [para],
          subject: assunto,
          text: texto,
          html,
        }),
        signal: AbortSignal.timeout(PRAZO_DO_RESEND_MS),
      });
    } catch {
      // A causa original pode citar a URL ou o corpo; fica só a descrição genérica.
      throw new ErroDeEnvioDeEmail('Resend indisponível: a requisição não completou.');
    }
    if (!resposta.ok) {
      throw new ErroDeEnvioDeEmail(
        `Resend recusou o envio (HTTP ${resposta.status}).`,
        resposta.status,
      );
    }
  }
}
