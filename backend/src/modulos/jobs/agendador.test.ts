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
});
