// Item 9 do backend/TAREFAS.md — testes de AgendadorDeJobs: liga, desliga, dispara no intervalo
// configurado e não duplica o temporizador se `iniciar` for chamado duas vezes.
import { criarLogger } from '../../log';
import { AgendadorDeJobs, INTERVALO_PADRAO_MINUTOS } from './agendador';
import type { ResumoDoJob, ServicoDeJobsAgendados } from './servico';

const LOGGER_SILENCIOSO = criarLogger({ nivel: 'silent', destino: { write: () => undefined } });

function servicoFalso(resumo: ResumoDoJob[] = []): {
  servico: Pick<ServicoDeJobsAgendados, 'executarTodos'>;
  chamadas: number[];
} {
  const chamadas: number[] = [];
  return {
    servico: {
      executarTodos: async () => {
        chamadas.push(Date.now());
        return resumo;
      },
    },
    chamadas,
  };
}

describe('AgendadorDeJobs (item 9)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('não dispara nada antes de iniciar()', () => {
    const { servico, chamadas } = servicoFalso();
    new AgendadorDeJobs({ servico: servico as ServicoDeJobsAgendados, logger: LOGGER_SILENCIOSO });

    jest.advanceTimersByTime(INTERVALO_PADRAO_MINUTOS * 60_000 * 3);

    expect(chamadas).toHaveLength(0);
  });

  it('dispara a cada intervalo configurado, depois de iniciar()', async () => {
    const { servico, chamadas } = servicoFalso();
    const agendador = new AgendadorDeJobs({
      servico: servico as ServicoDeJobsAgendados,
      logger: LOGGER_SILENCIOSO,
      intervaloMs: 1000,
    });

    agendador.iniciar();
    await jest.advanceTimersByTimeAsync(3500);

    expect(chamadas).toHaveLength(3);
  });

  it('iniciar() duas vezes não duplica o temporizador', async () => {
    const { servico, chamadas } = servicoFalso();
    const agendador = new AgendadorDeJobs({
      servico: servico as ServicoDeJobsAgendados,
      logger: LOGGER_SILENCIOSO,
      intervaloMs: 1000,
    });

    agendador.iniciar();
    agendador.iniciar();
    await jest.advanceTimersByTimeAsync(1000);

    expect(chamadas).toHaveLength(1);
  });

  it('parar() desliga o temporizador', async () => {
    const { servico, chamadas } = servicoFalso();
    const agendador = new AgendadorDeJobs({
      servico: servico as ServicoDeJobsAgendados,
      logger: LOGGER_SILENCIOSO,
      intervaloMs: 1000,
    });

    agendador.iniciar();
    agendador.parar();
    await jest.advanceTimersByTimeAsync(5000);

    expect(chamadas).toHaveLength(0);
  });

  it('executar() dispara uma rodada imediata e devolve o resumo', async () => {
    const resumoEsperado: ResumoDoJob[] = [{ job: 'expirar_reservas', processados: 2 }];
    const { servico } = servicoFalso(resumoEsperado);
    const agendador = new AgendadorDeJobs({
      servico: servico as ServicoDeJobsAgendados,
      logger: LOGGER_SILENCIOSO,
    });

    await expect(agendador.executar()).resolves.toEqual(resumoEsperado);
  });

  describe('rodadas simultâneas', () => {
    function servicoLento(): {
      servico: ServicoDeJobsAgendados;
      concluir: (resumo: ResumoDoJob[]) => void;
      falhar: (erro: Error) => void;
      chamadas: () => number;
    } {
      let total = 0;
      let concluir: (resumo: ResumoDoJob[]) => void = () => undefined;
      let falhar: (erro: Error) => void = () => undefined;
      const servico = {
        executarTodos: () => {
          total += 1;
          return new Promise<ResumoDoJob[]>((resolve, reject) => {
            concluir = resolve;
            falhar = reject;
          });
        },
      } as unknown as ServicoDeJobsAgendados;
      return {
        servico,
        concluir: (resumo) => concluir(resumo),
        falhar: (erro) => falhar(erro),
        chamadas: () => total,
      };
    }

    it('duas chamadas simultâneas executam uma só rodada e dividem o resumo', async () => {
      const { servico, concluir, chamadas } = servicoLento();
      const agendador = new AgendadorDeJobs({ servico, logger: LOGGER_SILENCIOSO });
      const resumo: ResumoDoJob[] = [{ job: 'expirar_reservas', processados: 1 }];

      const primeira = agendador.executar();
      const segunda = agendador.executar();
      concluir(resumo);

      await expect(primeira).resolves.toEqual(resumo);
      await expect(segunda).resolves.toEqual(resumo);
      expect(chamadas()).toBe(1);
    });

    it('o intervalo não inicia nova rodada enquanto a anterior não terminou', async () => {
      const { servico, concluir, chamadas } = servicoLento();
      const agendador = new AgendadorDeJobs({
        servico,
        logger: LOGGER_SILENCIOSO,
        intervaloMs: 1000,
      });

      agendador.iniciar();
      await jest.advanceTimersByTimeAsync(3500);
      expect(chamadas()).toBe(1);

      concluir([]);
      await jest.advanceTimersByTimeAsync(1000);
      expect(chamadas()).toBe(2);
      agendador.parar();
    });

    it('libera nova rodada depois que a anterior falha', async () => {
      const { servico, falhar, concluir, chamadas } = servicoLento();
      const agendador = new AgendadorDeJobs({ servico, logger: LOGGER_SILENCIOSO });

      const primeira = agendador.executar();
      falhar(new Error('quebrou'));
      await expect(primeira).rejects.toThrow('quebrou');

      const segunda = agendador.executar();
      concluir([]);
      await expect(segunda).resolves.toEqual([]);
      expect(chamadas()).toBe(2);
    });
  });
});
