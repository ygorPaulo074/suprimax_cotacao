// UC25 — aviso por e-mail ao usuário recém-criado, com o link para definir a senha.
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
 * Envio dos e-mails do sistema. Os módulos dependem desta interface; a implementação que usa o
 * Resend entra com a recuperação de senha (item 3 do TAREFAS.md, parte 2).
 */
export interface NotificadorDeEmail {
  /** Envia ao usuário o link de definição de senha. */
  enviarDefinicaoDeSenha(convite: ConviteDeDefinicaoDeSenha): Promise<void>;
}

/**
 * Implementação provisória: não envia nada, só registra em log que o e-mail deixou de ser
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
