/** @jest-environment <rootDir>/src/test/ambienteJsdom.cjs */
import '@testing-library/jest-dom';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, useLocation } from 'react-router-dom';
import type { OrcamentoDetalhe } from '@/api';
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
  });
});
