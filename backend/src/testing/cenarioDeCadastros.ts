// Cenário dos testes de rota dos cadastros: aplicação montada com o banco em memória atrás do
// dublê do proxy, usuários já com sessão aberta e um notificador que guarda o que seria enviado.
import type { Perfil } from '../modulos/auth/sessoes';
import type {
  ConviteDeDefinicaoDeSenha,
  NotificadorDeEmail,
} from '../modulos/usuarios/notificador';
import { montarAppDeTeste, type AppDeTeste, type OpcoesDoAppDeTeste } from './appDeTeste';
import { BancoFalso } from './bancoFalso';

/** Hash qualquer para a coluna `senha_hash` dos usuários semeados; nenhum teste entra com senha. */
export const SENHA_HASH_DE_TESTE = '$2b$04$hash.de.teste.sem.senha.conhecida';

/** Notificador que não envia nada e guarda os convites recebidos, para o teste conferir. */
export class NotificadorDeEmailEspiao implements NotificadorDeEmail {
  readonly convites: ConviteDeDefinicaoDeSenha[] = [];
  /** Quando definido, o envio falha com este erro. */
  falha?: Error;

  enviarDefinicaoDeSenha(convite: ConviteDeDefinicaoDeSenha): Promise<void> {
    if (this.falha) {
      return Promise.reject(this.falha);
    }
    this.convites.push(convite);
    return Promise.resolve();
  }
}

/** Usuário semeado com sessão aberta. */
export interface UsuarioDeTeste {
  readonly idOperador: number;
  readonly token: string;
  /** Valor do cabeçalho `Authorization`. */
  readonly autorizacao: string;
}

export interface CenarioDeCadastros extends AppDeTeste {
  readonly banco: BancoFalso;
  readonly notificador: NotificadorDeEmailEspiao;
  /** Grava um usuário na tabela `operador`, sem abrir sessão, e devolve o identificador. */
  semearUsuario(perfil: Perfil, usuario: string, status?: string): number;
  /** Grava um usuário ativo com o perfil informado e abre uma sessão para ele. */
  entrarComo(perfil: Perfil, usuario?: string): Promise<UsuarioDeTeste>;
}

/** Monta a aplicação de teste sobre um banco em memória vazio. */
export function montarCenarioDeCadastros(opcoes: OpcoesDoAppDeTeste = {}): CenarioDeCadastros {
  const notificador = new NotificadorDeEmailEspiao();
  const teste = montarAppDeTeste({ notificador, ...opcoes });
  const banco = new BancoFalso({ agora: opcoes.agora }).instalarEm(teste.proxy);

  const semearUsuario = (perfil: Perfil, usuario: string, status = 'ATIVO'): number => {
    const [linha] = banco.semear('operador', {
      usuario,
      email: `${usuario}@suprimax.com.br`,
      senha_hash: SENHA_HASH_DE_TESTE,
      perfil,
      status,
    });
    return linha?.id_operador as number;
  };

  const entrarComo = async (
    perfil: Perfil,
    usuario = perfil.toLowerCase(),
  ): Promise<UsuarioDeTeste> => {
    const idOperador = semearUsuario(perfil, usuario);
    const email = `${usuario}@suprimax.com.br`;
    const token = await teste.sessoes.criar({ idOperador, usuario, nome: usuario, email, perfil });
    return { idOperador, token, autorizacao: `Bearer ${token}` };
  };

  return { ...teste, banco, notificador, semearUsuario, entrarComo };
}
