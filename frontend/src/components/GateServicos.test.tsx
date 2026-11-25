/** @jest-environment <rootDir>/src/test/ambienteJsdom.cjs */
import '@testing-library/jest-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GateServicos } from './GateServicos';
import { CHAVE_DA_LIBERACAO } from '@/lib/aguardoDosServicos';
import { renderizarTela } from '@/test/renderizar';

const mockCompleta = jest.fn();

jest.mock('@/api', () => ({
  ApiError: jest.requireActual('@/api/errors').ApiError,
  saudeApi: { completa: (sinal?: AbortSignal) => mockCompleta(sinal) },
}));

const { ApiError } = jest.requireActual('@/api/errors');

const ETAPAS = ['backend', 'proxy', 'banco_leitura', 'banco_gravacao', 'sessoes'] as const;
const ROTULOS = {
  backend: 'Servidor (backend)',
  proxy: 'Proxy de dados',
  banco_leitura: 'Banco de dados: leitura',
  banco_gravacao: 'Banco de dados: gravação',
  sessoes: 'Login: criação de sessão',
};

/** Resposta de /saude/completa; `falhas` troca o resultado das etapas indicadas. */
const resposta = (falhas: Record<string, string> = {}) => ({
  ok: Object.keys(falhas).length === 0,
  verificadoEm: '2026-11-24T22:00:00.000Z',
  verificacoes: ETAPAS.map((nome) => ({
    nome,
    rotulo: ROTULOS[nome],
    ok: falhas[nome] === undefined,
    duracaoMs: 12,
    ...(falhas[nome] !== undefined && { erro: falhas[nome] }),
  })),
});

function memoria(inicial?: string) {
  const itens = new Map<string, string>(inicial ? [[CHAVE_DA_LIBERACAO, inicial]] : []);
  return {
    itens,
    getItem: (c: string) => itens.get(c) ?? null,
    setItem: (c: string, v: string) => void itens.set(c, v),
    removeItem: (c: string) => void itens.delete(c),
  };
}

function abrir(opcoes: { ativo?: boolean; armazenamento?: ReturnType<typeof memoria> } = {}) {
  const armazenamento = opcoes.armazenamento ?? memoria();
  renderizarTela(
    <GateServicos ativo={opcoes.ativo ?? true} intervaloMs={20} armazenamento={armazenamento}>
      <p>Sistema aberto</p>
    </GateServicos>,
  );
  return armazenamento;
}

const situacoes = () => screen.getAllByRole('listitem').map((i) => i.getAttribute('data-situacao'));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GateServicos', () => {
  it('libera o sistema quando todos os serviços respondem, e guarda a liberação', async () => {
    mockCompleta.mockResolvedValue(resposta());
    const armazenamento = abrir();

    expect(await screen.findByText('Sistema aberto')).toBeInTheDocument();
    expect(armazenamento.itens.has(CHAVE_DA_LIBERACAO)).toBe(true);
  });

  it('enquanto algum serviço falha, mostra qual e não libera; quando todos passam, libera', async () => {
    // A segunda verificação só termina quando o teste manda, para conferir a tela com a falha.
    let concluirSegunda: () => void = () => undefined;
    const segunda = new Promise((resolver) => {
      concluirSegunda = () => resolver(resposta());
    });
    mockCompleta
      .mockResolvedValueOnce(
        resposta({ banco_gravacao: 'SERVICO_INDISPONIVEL', sessoes: 'SERVICO_INDISPONIVEL' }),
      )
      .mockReturnValueOnce(segunda)
      .mockResolvedValue(resposta());
    abrir();

    expect(await screen.findByText('Verificando os serviços')).toBeInTheDocument();
    expect(await screen.findAllByText(/não passou: não respondeu a tempo/)).toHaveLength(2);
    expect(screen.queryByText('Sistema aberto')).not.toBeInTheDocument();
    expect(situacoes()).toEqual(['ok', 'ok', 'ok', 'falhou', 'falhou']);

    concluirSegunda();
    expect(await screen.findByText('Sistema aberto')).toBeInTheDocument();
  });

  it('servidor que não responde (dormindo): só ele aparece sem resposta e o sistema não abre', async () => {
    mockCompleta.mockRejectedValue(new ApiError(0, 'SEM_CONEXAO', 'Sem conexão com o servidor.'));
    abrir();

    expect(
      await screen.findByText(/ainda não respondeu \(pode estar acordando\)/),
    ).toBeInTheDocument();
    expect(situacoes()).toEqual(['falhou', 'aguardando', 'aguardando', 'aguardando', 'aguardando']);
    expect(screen.queryByText('Sistema aberto')).not.toBeInTheDocument();
  });

  it('com a página inativa (desenvolvimento), abre direto sem consultar a API', () => {
    abrir({ ativo: false });

    expect(screen.getByText('Sistema aberto')).toBeInTheDocument();
    expect(mockCompleta).not.toHaveBeenCalled();
  });

  it('liberação recente na mesma aba abre direto, sem consultar a API', () => {
    abrir({ armazenamento: memoria(String(Date.now() - 60_000)) });

    expect(screen.getByText('Sistema aberto')).toBeInTheDocument();
    expect(mockCompleta).not.toHaveBeenCalled();
  });

  it('liberação vencida (mais de 10 minutos) volta a verificar', async () => {
    mockCompleta.mockResolvedValue(resposta({ proxy: 'PROXY_INDISPONIVEL' }));
    abrir({ armazenamento: memoria(String(Date.now() - 11 * 60_000)) });

    expect(await screen.findByText('Verificando os serviços')).toBeInTheDocument();
    expect(screen.queryByText('Sistema aberto')).not.toBeInTheDocument();
    await waitFor(() => expect(mockCompleta).toHaveBeenCalled());
  });

  it('"Verificar agora" repete a verificação na hora', async () => {
    mockCompleta.mockResolvedValue(resposta({ proxy: 'PROXY_INDISPONIVEL' }));
    renderizarTela(
      <GateServicos ativo intervaloMs={60_000} armazenamento={memoria()}>
        <p>Sistema aberto</p>
      </GateServicos>,
    );
    await screen.findAllByText(/depende do proxy/);
    const antes = mockCompleta.mock.calls.length;

    await userEvent.click(await screen.findByRole('button', { name: 'Verificar agora' }));

    await waitFor(() => expect(mockCompleta.mock.calls.length).toBeGreaterThan(antes));
  });
});
