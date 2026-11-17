// UC13, UC25 — escolhe o envio real (Resend) ou o mudo, conforme a configuração.
import type { Config } from '../config';
import type { Logger } from '../log';
import {
  NotificadorDeRecuperacaoDeSenhaMudo,
  NotificadorDeRecuperacaoDeSenhaPorEmail,
  type NotificadorDeRecuperacaoDeSenha,
} from '../modulos/auth/notificador';
import {
  NotificadorDeEmailMudo,
  NotificadorDeEmailPorEmail,
  type NotificadorDeEmail,
} from '../modulos/usuarios/notificador';
import { EmailViaResend, type FetchDeEmail } from './enviador';

export interface NotificadoresDeEmail {
  readonly notificador: NotificadorDeEmail;
  readonly notificadorDeRecuperacao: NotificadorDeRecuperacaoDeSenha;
}

/**
 * Com `RESEND_API_KEY` (e remetente e URL do frontend, que a config exige junto), envia de
 * verdade; sem ela, os notificadores mudos só registram em log.
 */
export function criarNotificadoresDeEmail(
  config: Config,
  logger: Logger,
  fetchDeEmail?: FetchDeEmail,
): NotificadoresDeEmail {
  const { resendApiKey, emailRemetente, frontendUrl } = config;
  if (resendApiKey === undefined || emailRemetente === undefined || frontendUrl === undefined) {
    return {
      notificador: new NotificadorDeEmailMudo(logger),
      notificadorDeRecuperacao: new NotificadorDeRecuperacaoDeSenhaMudo(logger),
    };
  }
  const enviador = new EmailViaResend({
    chaveDaApi: resendApiKey,
    remetente: emailRemetente,
    ...(fetchDeEmail && { fetch: fetchDeEmail }),
  });
  return {
    notificador: new NotificadorDeEmailPorEmail(enviador, frontendUrl),
    notificadorDeRecuperacao: new NotificadorDeRecuperacaoDeSenhaPorEmail(enviador, frontendUrl),
  };
}
