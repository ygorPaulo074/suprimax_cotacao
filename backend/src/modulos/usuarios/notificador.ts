// UC25 — aviso por e-mail ao usuário recém-criado, com o link para definir a senha.
import type { EnviadorDeEmail } from '../../email/enviador';
import { montarEmailDeSenha } from '../../email/linkDeSenha';
import type { Logger } from '../../log';

/** O que o e-mail de definição de senha precisa. */
export interface ConviteDeDefinicaoDeSenha {
  readonly idOperador: number;
  readonly usuario: string;
  readonly email: string;
  /** Token em texto puro, para montar o link. Nunca grave nem registre em log. */
  readonly token: string;
  readonly validade: Date;
}

/**
 * Envio dos e-mails do sistema. Os módulos dependem desta interface; a implementação real usa o
 * Resend (`RESEND_API_KEY`), e sem ela vale o notificador mudo.
 */
export interface NotificadorDeEmail {
  /** Envia ao usuário o link de definição de senha. */
  enviarDefinicaoDeSenha(convite: ConviteDeDefinicaoDeSenha): Promise<void>;
}

/** Envia o link de definição de senha pela interface única de e-mail; falha do provedor propaga o erro. */
export class NotificadorDeEmailPorEmail implements NotificadorDeEmail {
  constructor(
    private readonly enviador: EnviadorDeEmail,
    private readonly frontendUrl: string,
  ) {}

  enviarDefinicaoDeSenha({
    usuario,
    email,
    token,
    validade,
  }: ConviteDeDefinicaoDeSenha): Promise<void> {
    return this.enviador.enviar(
      montarEmailDeSenha(
        { usuario, email, token, validade, frontendUrl: this.frontendUrl },
        'SupriMax: defina a sua senha',
        'Sua conta no SupriMax Cotação foi criada. Use o link abaixo para definir a sua senha:',
      ),
    );
  }
}

/**
 * Sem provedor configurado: não envia nada, só registra em log que o e-mail deixou de ser
 * enviado. O log leva o identificador do usuário e a validade; o token e o endereço ficam de fora.
 */
export class NotificadorDeEmailMudo implements NotificadorDeEmail {
  constructor(private readonly logger: Logger) {}

  enviarDefinicaoDeSenha({ idOperador, validade }: ConviteDeDefinicaoDeSenha): Promise<void> {
    this.logger.warn(
      { evento: 'email_nao_enviado', tipo: 'definicao_de_senha', idOperador, validade },
      'E-mail de definição de senha não enviado: o envio de e-mails ainda não foi configurado.',
    );
    return Promise.resolve();
  }
}
