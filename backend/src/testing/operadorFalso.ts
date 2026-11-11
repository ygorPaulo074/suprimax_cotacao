// Simula a tabela `operador` atrás do ProxyClienteFalso para os testes de login: guarda uma linha,
// responde às consultas e faz o papel do gatilho do banco que grava `bloqueado_ate` na terceira
// tentativa inválida (docs/13, seção 13.4).
import { paraCamelCase } from '../dados';
import type { ChamadaAoProxy, ProxyClienteFalso } from './proxyClienteFalso';

/** Linha de `operador` como o cliente do proxy a devolve (chaves em camelCase). */
export interface LinhaDeOperador {
  idOperador: number;
  usuario: string;
  email: string;
  perfil: string;
  status: string;
  senhaHash: string;
  tentativasLoginInvalidas: number;
  bloqueadoAte: string | null;
}

/** Duração do bloqueio aplicada pelo gatilho simulado. */
export const DURACAO_DO_BLOQUEIO_SIMULADO_MS = 15 * 60 * 1000;
const TENTATIVAS_QUE_BLOQUEIAM = 3;

type Filtro = [campo: string, operador: string, valor: unknown];

/** Um usuário cadastrado no banco simulado. */
export class OperadorFalso {
  readonly linha: LinhaDeOperador;

  /**
   * @param proxy Dublê em que as respostas de `dados.consultar` e `dados.atualizar` são programadas.
   * @param linha Campos da linha que diferem do padrão (operador ativo, sem tentativas).
   * @param agora Relógio usado pelo gatilho simulado.
   */
  constructor(
    proxy: ProxyClienteFalso,
    linha: Partial<LinhaDeOperador> & Pick<LinhaDeOperador, 'senhaHash'>,
    private readonly agora: () => Date = () => new Date(),
  ) {
    this.linha = {
      idOperador: 7,
      usuario: 'davi',
      email: 'davi@suprimax.com.br',
      perfil: 'OPERADOR',
      status: 'ATIVO',
      tentativasLoginInvalidas: 0,
      bloqueadoAte: null,
      ...linha,
    };
    proxy.responder('dados.consultar', (chamada: ChamadaAoProxy) => ({
      ok: true,
      dados: this.atende(chamada) ? [{ ...this.linha }] : [],
      proximoCursor: null,
    }));
    proxy.responder('dados.atualizar', (chamada: ChamadaAoProxy) => this.atualizar(chamada));
  }

  private atende({ payload }: ChamadaAoProxy): boolean {
    const filtros = (payload.filtros as { e: Filtro[] }).e;
    const linha = this.linha as unknown as Record<string, unknown>;
    return filtros.every(([campo, , valor]) => linha[paraCamelCase(campo)] === valor);
  }

  private atualizar(chamada: ChamadaAoProxy): unknown {
    if (!this.atende(chamada)) {
      return { ok: true, afetados: 0, dados: [] };
    }
    const valores = chamada.payload.valores as Record<string, unknown>;
    for (const [coluna, valor] of Object.entries(valores)) {
      (this.linha as unknown as Record<string, unknown>)[paraCamelCase(coluna)] = valor;
    }
    this.aplicarGatilhoDeBloqueio();
    const { tentativasLoginInvalidas, bloqueadoAte } = this.linha;
    return { ok: true, afetados: 1, dados: [{ tentativasLoginInvalidas, bloqueadoAte }] };
  }

  private aplicarGatilhoDeBloqueio(): void {
    if (this.linha.tentativasLoginInvalidas >= TENTATIVAS_QUE_BLOQUEIAM) {
      const fim = new Date(this.agora().getTime() + DURACAO_DO_BLOQUEIO_SIMULADO_MS);
      this.linha.bloqueadoAte = fim.toISOString();
    }
  }
}
