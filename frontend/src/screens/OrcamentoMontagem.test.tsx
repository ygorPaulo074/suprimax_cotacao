/** @jest-environment <rootDir>/src/test/ambienteJsdom.cjs */
import '@testing-library/jest-dom';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { OrcamentoDetalhe } from '@/api';
import { descartarItem, enfileirar, reiniciarFilaEmMemoria } from '@/api/filaOffline';
import OrcamentoMontagem from './OrcamentoMontagem';
import { renderizarTela } from '@/test/renderizar';

const mockEmitir = jest.fn();
const mockCabecalho = jest.fn();
const mockCondicoes = jest.fn();
let mockIdOperador = 1;

jest.mock('@/api', () => ({
  ApiError: jest.requireActual('@/api/errors').ApiError,
  orcamentosApi: {
    emitir: (id: number) => mockEmitir(id),
    atualizarCabecalho: (id: number, d: unknown) => mockCabecalho(id, d),
    atualizarCondicoes: (id: number, d: unknown) => mockCondicoes(id, d),
  },
  produtosApi: { buscar: jest.fn() },
}));
jest.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ sessao: { idOperador: mockIdOperador, perfil: 'OPERADOR' } }),
}));

const { ApiError } = jest.requireActual('@/api/errors');

const ITEM = {
  idItem: 11,
  idVariacao: 5,
  produto: 'Detergente Neutro',
  marca: 'Limpex',
  embalagem: '500 ml',
  granularidade: 'FARDO',
  quantidade: 2,
  precoUnitarioAplicado: 10000,
  valorLinha: 20000,
  valorImposto: 3600,
  valorTotalItem: 23600,
  aprovacaoHerdada: false,
};

function orcamento(extra: Partial<OrcamentoDetalhe> = {}): OrcamentoDetalhe {
  return {
    idOrcamento: 7,
    responsavel: { idOperador: 1, nome: 'Maria' },
    ultimaAlteracaoDeOutro: null,
    numeroOrcamento: null,
    status: 'RASCUNHO',
    idCliente: 3,
    cliente: 'Mercado Bom Preço',
    cnpj: '12.345.678/0001-90',
    idPedido: null,
    numeroPedido: 'P-100',
    dataEmissao: null,
    dataValidade: null,
    chaveSeguranca: null,
    numeroSolicitacaoCompra: null,
    contato: null,
    idEnderecoEntrega: 20,
    enderecosEntrega: [
      {
        idEndereco: 20,
        tipo: 'ENTREGA',
        logradouro: 'Rua A',
        numero: '10',
        bairro: 'Centro',
        cidade: 'Recife',
        uf: 'PE',
        cep: '50000000',
      },
    ],
    prazoEntregaDias: 5,
    itens: [ITEM],
    anexos: [],
    condicoes: {
      valorTotalItens: 23600,
      valorTotalImposto: 3600,
      modalidadeFrete: 'CIF',
      origemTransportadora: null,
      transportadora: null,
      valorFrete: null,
      freteProvisorio: false,
      condicaoPagamento: null,
      condicoesPagamentoPermitidas: ['ADIANTADO_100', 'BOLETO'],
      condicaoPagamentoSugerida: 'ADIANTADO_100',
      prazoDias: null,
      numeroParcelas: null,
      valorTotalProposta: 23600,
      creditoStatus: 'NAO_EXIGIDO',
      bloqueios: [],
      avisos: [],
    },
    historico: [],
    versoes: [],
    ...extra,
  } as OrcamentoDetalhe;
}

function abrir(o: OrcamentoDetalhe) {
  return renderizarTela(<OrcamentoMontagem orcamento={o} />, `/orcamentos/${o.idOrcamento}`);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIdOperador = 1;
  localStorage.clear();
  reiniciarFilaEmMemoria();
});

describe('Montagem do orçamento', () => {
  it('mostra cliente, pedido de origem e itens do rascunho', () => {
    abrir(orcamento());
    expect(screen.getByRole('heading', { name: 'Orçamento: Montagem' })).toBeInTheDocument();
    expect(screen.getByText('Mercado Bom Preço')).toBeInTheDocument();
    expect(screen.getByText('P-100')).toBeInTheDocument();
    expect(screen.getByText('Detergente Neutro')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Rua A, 10/ })).toBeInTheDocument();
  });

  it('não mostra aviso ao responsável sem alteração de outro operador', () => {
    abrir(orcamento());
    expect(screen.queryByText(/Rascunho de /)).not.toBeInTheDocument();
    expect(screen.queryByText(/foi alterado por/)).not.toBeInTheDocument();
  });

  it('avisa o outro operador de quem é o rascunho', () => {
    mockIdOperador = 2;
    abrir(orcamento());
    expect(
      screen.getByText('Rascunho de Maria. Suas alterações serão informadas a ele.'),
    ).toBeInTheDocument();
  });

  it('avisa o responsável quando outro operador alterou o rascunho', () => {
    abrir(
      orcamento({
        ultimaAlteracaoDeOutro: {
          idOperador: 2,
          nome: 'Carlos',
          data: '2026-11-17T13:30:00Z',
        },
      }),
    );
    expect(screen.getByText(/Este rascunho foi alterado por Carlos em /)).toBeInTheDocument();
  });

  it('cliente sem endereço de entrega mostra o link para a ficha', () => {
    abrir(orcamento({ enderecosEntrega: [], idEnderecoEntrega: null }));
    expect(
      screen.getByText(/Este cliente não tem endereço de entrega cadastrado\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir a ficha para adicionar' })).toHaveAttribute(
      'href',
      '/clientes?cnpj=12345678000190',
    );
  });

  it('salva o cabeçalho com os campos aparados e vazios como null', async () => {
    mockCabecalho.mockResolvedValue(orcamento());
    abrir(orcamento());
    await userEvent.type(screen.getByLabelText(/Nº da solicitação de compra/), ' SC-9 ');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar dados' }));
    await waitFor(() =>
      expect(mockCabecalho).toHaveBeenCalledWith(7, {
        contato: null,
        numeroSolicitacaoCompra: 'SC-9',
        idEnderecoEntrega: 20,
        prazoEntregaDias: 5,
      }),
    );
  });

  it('emite o orçamento quando não há bloqueios', async () => {
    mockEmitir.mockResolvedValue(orcamento({ status: 'ABERTO', numeroOrcamento: 42 }));
    abrir(orcamento());
    const emitir = screen.getByRole('button', { name: 'Emitir orçamento' });
    expect(emitir).toBeEnabled();
    await userEvent.click(emitir);
    await waitFor(() => expect(mockEmitir).toHaveBeenCalledWith(7));
  });

  it('sem condição gravada, o seletor já vem com a sugerida', () => {
    abrir(orcamento());
    expect(screen.getByLabelText(/Condição de pagamento/)).toHaveValue('ADIANTADO_100');
  });

  it('com condição gravada, mostra a gravada e não a sugerida', () => {
    const base = orcamento();
    abrir(
      orcamento({
        condicoes: { ...base.condicoes, condicaoPagamento: 'BOLETO', prazoDias: 30 },
      }),
    );
    expect(screen.getByLabelText(/Condição de pagamento/)).toHaveValue('BOLETO');
  });

  it('sem condição gravada, emitir grava a sugerida antes e depois emite', async () => {
    const base = orcamento();
    const incompleto = orcamento({
      condicoes: {
        ...base.condicoes,
        modalidadeFrete: null,
        bloqueios: [{ codigo: 'CONDICOES_INCOMPLETAS', mensagem: 'Defina a condição.' }],
      },
    });
    mockCondicoes.mockResolvedValue(
      orcamento({ condicoes: { ...base.condicoes, condicaoPagamento: 'ADIANTADO_100' } }),
    );
    mockEmitir.mockResolvedValue(orcamento({ status: 'ABERTO', numeroOrcamento: 42 }));
    abrir(incompleto);
    const emitir = screen.getByRole('button', { name: 'Emitir orçamento' });
    expect(emitir).toBeEnabled();
    await userEvent.click(emitir);
    await waitFor(() => expect(mockEmitir).toHaveBeenCalledWith(7));
    expect(mockCondicoes).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ condicaoPagamento: 'ADIANTADO_100' }),
    );
  });

  it('com um único endereço de entrega, ele já vem selecionado', () => {
    abrir(orcamento({ idEnderecoEntrega: null }));
    expect(screen.getByLabelText(/Endereço de entrega/)).toHaveValue('20');
  });

  it('com vários endereços de entrega e nenhum gravado, continua em Selecione…', () => {
    const base = orcamento();
    abrir(
      orcamento({
        idEnderecoEntrega: null,
        enderecosEntrega: [
          ...base.enderecosEntrega,
          { ...(base.enderecosEntrega[0] as object), idEndereco: 21 } as never,
        ],
      }),
    );
    expect(screen.getByLabelText(/Endereço de entrega/)).toHaveValue('');
  });

  it('bloqueios do backend aparecem e desabilitam a emissão', () => {
    const base = orcamento();
    abrir(
      orcamento({
        condicoes: {
          ...base.condicoes,
          bloqueios: [
            { codigo: 'ABAIXO_DO_MINIMO', mensagem: 'Valor abaixo do mínimo de R$ 500,00.' },
          ],
        },
      }),
    );
    expect(screen.getByText('Valor abaixo do mínimo de R$ 500,00.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Emitir orçamento' })).toBeDisabled();
  });

  it('sem itens a emissão fica desabilitada', () => {
    abrir(orcamento({ itens: [] }));
    expect(screen.getByRole('button', { name: 'Emitir orçamento' })).toBeDisabled();
  });

  it('pendente de crédito bloqueia a emissão com aviso', () => {
    abrir(orcamento({ status: 'PENDENTE_CREDITO' }));
    expect(
      screen.getByText('Emissão bloqueada: aguardando a análise de crédito.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Emitir orçamento' })).toBeDisabled();
  });

  it('erro 422 na emissão mostra a mensagem do servidor', async () => {
    mockEmitir.mockRejectedValue(
      new ApiError(422, 'ESTOQUE_INSUFICIENTE', 'Estoque insuficiente na emissão.'),
    );
    abrir(orcamento());
    await userEvent.click(screen.getByRole('button', { name: 'Emitir orçamento' }));
    expect(await screen.findByText('Estoque insuficiente na emissão.')).toBeInTheDocument();
  });

  describe('alterações não salvas (RNF06)', () => {
    function Rota() {
      return <span data-testid="rota">{useLocation().pathname}</span>;
    }
    /** Como na tela real: o orçamento vem da consulta, que `aplicar` atualiza ao salvar. */
    function TelaComConsulta({ lido }: { lido: OrcamentoDetalhe }) {
      const { data } = useQuery({
        queryKey: ['orcamentos', 7],
        queryFn: () => Promise.resolve(lido),
        initialData: lido,
        staleTime: Infinity,
      });
      return (
        <>
          <OrcamentoMontagem orcamento={data} />
          <Link to="/pedidos">Ir para Pedidos</Link>
          <Rota />
        </>
      );
    }
    function abrirComSaida(o: OrcamentoDetalhe) {
      return renderizarTela(
        <>
          <OrcamentoMontagem orcamento={o} />
          <Link to="/pedidos">Ir para Pedidos</Link>
          <Rota />
        </>,
        `/orcamentos/${o.idOrcamento}`,
      );
    }

    it('sem campo alterado, sai da tela sem aviso e sem beforeunload', async () => {
      abrirComSaida(orcamento());
      const evento = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(evento);
      expect(evento.defaultPrevented).toBe(false);
      await userEvent.click(screen.getByRole('link', { name: 'Ir para Pedidos' }));
      expect(screen.queryByRole('dialog', { name: 'Alterações não salvas' })).toBeNull();
      expect(screen.getByTestId('rota')).toHaveTextContent('/pedidos');
    });

    it('com texto digitado, pergunta antes de sair; "Ficar na tela" mantém o texto', async () => {
      abrirComSaida(orcamento());
      const contato = screen.getByLabelText(/Contato/);
      await userEvent.type(contato, 'Joana');
      const evento = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(evento);
      expect(evento.defaultPrevented).toBe(true);

      await userEvent.click(screen.getByRole('link', { name: 'Ir para Pedidos' }));
      expect(await screen.findByRole('dialog', { name: 'Alterações não salvas' })).toBeVisible();
      await userEvent.click(screen.getByRole('button', { name: 'Ficar na tela' }));
      expect(screen.queryByRole('dialog', { name: 'Alterações não salvas' })).toBeNull();
      expect(screen.getByLabelText(/Contato/)).toHaveValue('Joana');
      expect(screen.getByTestId('rota')).toHaveTextContent('/orcamentos/7');
    });

    it('"Sair sem salvar" deixa a tela', async () => {
      abrirComSaida(orcamento());
      await userEvent.type(screen.getByLabelText(/Contato/), 'Joana');
      await userEvent.click(screen.getByRole('link', { name: 'Ir para Pedidos' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Sair sem salvar' }));
      await waitFor(() => expect(screen.getByTestId('rota')).toHaveTextContent('/pedidos'));
    });

    it('voltar ao valor original desfaz o aviso', async () => {
      abrirComSaida(orcamento());
      const contato = screen.getByLabelText(/Contato/);
      fireEvent.change(contato, { target: { value: 'X' } });
      fireEvent.change(contato, { target: { value: '' } });
      await userEvent.click(screen.getByRole('link', { name: 'Ir para Pedidos' }));
      expect(screen.queryByRole('dialog', { name: 'Alterações não salvas' })).toBeNull();
      expect(screen.getByTestId('rota')).toHaveTextContent('/pedidos');
    });

    describe('condições comerciais', () => {
      const FOB = {
        modalidadeFrete: 'FOB',
        origemTransportadora: 'SUPRIMAX',
        transportadora: 'Rápido Log',
        valorFrete: 150050,
        condicaoPagamento: 'ADIANTADO_100',
      } as const;
      const comFob = () => {
        const base = orcamento();
        return orcamento({ condicoes: { ...base.condicoes, ...FOB } });
      };
      const dialogo = () => screen.queryByRole('dialog', { name: 'Alterações não salvas' });
      const sair = () => userEvent.click(screen.getByRole('link', { name: 'Ir para Pedidos' }));

      it('sem condição gravada, a sugerida já selecionada não conta como alteração', async () => {
        abrirComSaida(orcamento());
        expect(screen.getByLabelText('Condição de pagamento')).toHaveValue('ADIANTADO_100');
        await sair();
        expect(dialogo()).toBeNull();
      });

      it('trocar a condição de pagamento avisa; voltar ao valor original desfaz', async () => {
        abrirComSaida(orcamento());
        const pagamento = screen.getByLabelText('Condição de pagamento');
        await userEvent.selectOptions(pagamento, 'BOLETO');
        const evento = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(evento);
        expect(evento.defaultPrevented).toBe(true);
        await userEvent.selectOptions(pagamento, 'ADIANTADO_100');
        await sair();
        expect(dialogo()).toBeNull();
        expect(screen.getByTestId('rota')).toHaveTextContent('/pedidos');
      });

      it('boleto: trocar o prazo avisa e voltar desfaz', async () => {
        const base = orcamento();
        abrirComSaida(
          orcamento({
            condicoes: { ...base.condicoes, condicaoPagamento: 'BOLETO', prazoDias: 28 },
          }),
        );
        const prazo = screen.getByLabelText('Prazo do boleto');
        expect(prazo).toHaveValue('28');
        await userEvent.selectOptions(prazo, '30');
        await sair();
        expect(await screen.findByRole('dialog', { name: 'Alterações não salvas' })).toBeVisible();
        await userEvent.click(screen.getByRole('button', { name: 'Ficar na tela' }));
        await userEvent.selectOptions(prazo, '28');
        await sair();
        expect(dialogo()).toBeNull();
      });

      it('frete: máscara, zeros e espaços (mesmos centavos) não geram aviso', async () => {
        abrirComSaida(comFob());
        const frete = screen.getByLabelText(/Valor do frete cotado/);
        expect(frete).toHaveValue('1500,50');
        fireEvent.change(frete, { target: { value: ' R$ 1.500,50 ' } });
        fireEvent.change(screen.getByLabelText(/Nome da transportadora/), {
          target: { value: '  Rápido Log ' },
        });
        await sair();
        expect(dialogo()).toBeNull();
      });

      it('frete: outro valor em centavos avisa; voltar ao original desfaz', async () => {
        abrirComSaida(comFob());
        const frete = screen.getByLabelText(/Valor do frete cotado/);
        fireEvent.change(frete, { target: { value: '1.500,51' } });
        await sair();
        expect(await screen.findByRole('dialog', { name: 'Alterações não salvas' })).toBeVisible();
        await userEvent.click(screen.getByRole('button', { name: 'Ficar na tela' }));
        fireEvent.change(frete, { target: { value: '1500,5' } });
        await sair();
        expect(dialogo()).toBeNull();
      });

      it('frete: texto inválido avisa (não é igual a nenhum valor lido)', async () => {
        abrirComSaida(comFob());
        fireEvent.change(screen.getByLabelText(/Valor do frete cotado/), {
          target: { value: 'abc' },
        });
        await sair();
        expect(await screen.findByRole('dialog', { name: 'Alterações não salvas' })).toBeVisible();
      });

      it('transportadora diferente avisa', async () => {
        abrirComSaida(comFob());
        fireEvent.change(screen.getByLabelText(/Nome da transportadora/), {
          target: { value: 'Outra Log' },
        });
        await sair();
        expect(await screen.findByRole('dialog', { name: 'Alterações não salvas' })).toBeVisible();
      });

      it('frete sem valor gravado (null) e campo vazio: sem aviso', async () => {
        const base = orcamento();
        abrirComSaida(
          orcamento({
            condicoes: {
              ...base.condicoes,
              modalidadeFrete: 'FOB',
              valorFrete: null,
              transportadora: null,
              condicaoPagamento: 'ADIANTADO_100',
            },
          }),
        );
        await sair();
        expect(dialogo()).toBeNull();
      });

      it('"Aplicar condições" com sucesso não avisa ao sair', async () => {
        const salvo = comFob();
        const novo = orcamento({
          condicoes: { ...salvo.condicoes, valorFrete: 160000 },
        });
        mockCondicoes.mockResolvedValue(novo);
        renderizarTela(<TelaComConsulta lido={salvo} />, '/orcamentos/7');
        fireEvent.change(screen.getByLabelText(/Valor do frete cotado/), {
          target: { value: '1.600,00' },
        });
        await userEvent.click(screen.getByRole('button', { name: 'Aplicar condições' }));
        await waitFor(() => expect(mockCondicoes).toHaveBeenCalled());
        expect(mockCondicoes.mock.calls[0][1]).toMatchObject({ valorFrete: 160000 });
        await sair();
        expect(dialogo()).toBeNull();
        expect(screen.getByTestId('rota')).toHaveTextContent('/pedidos');
      });
    });

    describe('alteração guardada na fila offline', () => {
      const dialogo = () => screen.queryByRole('dialog', { name: 'Alterações não salvas' });
      const sair = () => userEvent.click(screen.getByRole('link', { name: 'Ir para Pedidos' }));
      const semConexao = () =>
        new ApiError(0, 'ENFILEIRADA', 'Sem conexão. A alteração foi guardada neste aparelho.');
      const guardar = (extra: Record<string, unknown> = {}) =>
        enfileirar({
          chave: 'k1',
          metodo: 'PATCH',
          caminho: '/orcamentos/7',
          body: {},
          criadoEm: Date.now(),
          ...extra,
        });
      const salvarSemConexao = async (extra: Record<string, unknown> = {}) => {
        mockCabecalho.mockImplementation(() => {
          guardar(extra);
          return Promise.reject(semConexao());
        });
        abrirComSaida(orcamento());
        await userEvent.type(screen.getByLabelText(/Contato/), 'Joana');
        await userEvent.click(screen.getByRole('button', { name: 'Salvar dados' }));
        await screen.findByText(/foi guardada neste aparelho/);
      };

      it('cabeçalho guardado na fila: sair não pergunta e não há beforeunload', async () => {
        await salvarSemConexao();
        const evento = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(evento);
        expect(evento.defaultPrevented).toBe(false);
        await sair();
        expect(dialogo()).toBeNull();
        expect(screen.getByTestId('rota')).toHaveTextContent('/pedidos');
      });

      it('texto novo digitado depois do que foi guardado volta a avisar', async () => {
        await salvarSemConexao();
        await userEvent.type(screen.getByLabelText(/Contato/), ' Silva');
        await sair();
        expect(await screen.findByRole('dialog', { name: 'Alterações não salvas' })).toBeVisible();
      });

      it('condições guardadas na fila não avisam', async () => {
        mockCondicoes.mockImplementation(() => {
          guardar({ metodo: 'PUT', caminho: '/orcamentos/7/condicoes' });
          return Promise.reject(semConexao());
        });
        abrirComSaida(orcamento());
        await userEvent.selectOptions(screen.getByLabelText('Condição de pagamento'), 'BOLETO');
        await userEvent.click(screen.getByRole('button', { name: 'Aplicar condições' }));
        await screen.findByText(/foi guardada neste aparelho/);
        await sair();
        expect(dialogo()).toBeNull();
      });

      it('fila travada por falha definitiva: o aviso volta (o dado não está a caminho)', async () => {
        await salvarSemConexao({ falhou: true });
        await sair();
        expect(await screen.findByRole('dialog', { name: 'Alterações não salvas' })).toBeVisible();
      });

      it('item da fila descartado pelo servidor (4xx): o aviso volta', async () => {
        await salvarSemConexao();
        const antes = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(antes);
        expect(antes.defaultPrevented).toBe(false);
        act(() => descartarItem('k1'));
        const depois = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(depois);
        expect(depois.defaultPrevented).toBe(true);
      });
    });

    it('"Salvar dados" com sucesso não avisa ao sair', async () => {
      const lido = orcamento();
      mockCabecalho.mockResolvedValue(orcamento({ contato: 'Joana' }));
      renderizarTela(<TelaComConsulta lido={lido} />, '/orcamentos/7');
      await userEvent.type(screen.getByLabelText(/Contato/), 'Joana');
      await userEvent.click(screen.getByRole('button', { name: 'Salvar dados' }));
      await waitFor(() => expect(mockCabecalho).toHaveBeenCalled());
      await waitFor(() => {
        const evento = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(evento);
        expect(evento.defaultPrevented).toBe(false);
      });
      await userEvent.click(screen.getByRole('link', { name: 'Ir para Pedidos' }));
      expect(screen.queryByRole('dialog', { name: 'Alterações não salvas' })).toBeNull();
      expect(screen.getByTestId('rota')).toHaveTextContent('/pedidos');
    });
  });
});
