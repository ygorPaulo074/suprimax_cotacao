// UC13 — aviso por e-mail ao operador que pediu a recuperação de senha, com o link para redefinir.
import type { Logger } from '../../log';

/** O que o e-mail de recuperação de senha precisa. */
export interface RecuperacaoDeSenha {
  readonly idOperador: number;
  readonly usuario: string;
  readonly email: string;
  /** Token em texto puro, para montar o link. Nunca grave nem registre em log. */
  readonly token: string;
  readonly validade: Date;
}

/**
 * Envio dos e-mails de recuperação de senha. A implementação que usa o Resend ainda não foi
 * configurada (sem `RESEND_API_KEY`); por ora, só o notificador que registra em log.
 */
export interface NotificadorDeRecuperacaoDeSenha {
  /** Envia ao usuário o link de redefinição de senha. */
  enviarRecuperacaoDeSenha(recuperacao: RecuperacaoDeSenha): Promise<void>;
}

/**
 * Implementação provisória: não envia nada, só registra em log que o e-mail deixou de ser
 * enviado. O log leva o identificador do usuário e a validade; o token e o endereço ficam de fora.
 */
export class NotificadorDeRecuperacaoDeSenhaMudo implements NotificadorDeRecuperacaoDeSenha {
  constructor(private readonly logger: Logger) {}

  enviarRecuperacaoDeSenha({ idOperador, validade }: RecuperacaoDeSenha): Promise<void> {
    this.logger.warn(
      { evento: 'email_nao_enviado', tipo: 'recuperacao_de_senha', idOperador, validade },
      'E-mail de recuperação de senha não enviado: o envio de e-mails ainda não foi configurado.',
    );
    return Promise.resolve();
  }
}
