/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import OrcamentosLista from './OrcamentosLista';
import { renderizarTela } from '@/test/renderizar';

const mockListar = jest.fn();

jest.mock('@/api', () => ({
  ApiError: jest.requireActual('@/api/errors').ApiError,
  orcamentosApi: { listar: (f: unknown) => mockListar(f) },
}));

const { ApiError } = jest.requireActual('@/api/errors');

const ORCAMENTO = {
  idOrcamento: 7,
  numeroOrcamento: 42,
  idCliente: 1,
  cliente: 'Mercado Bom Preço',
  cnpj: '12345678000190',
  dataEmissao: '2026-11-01',
  dataValidade: '2026-11-30',
  diasParaVencer: 12,
  valorTotalProposta: 123456,
  status: 'ABERTO',
};

function Busca() {
  return <span data-testid="busca">{useLocation().search}</span>;
}

function abrir(rota = '/orcamentos') {
  return renderizarTela(
    <>
      <OrcamentosLista />
      <Busca />
    </>,
    rota,
  );
}

beforeEach(() => jest.clearAllMocks());

describe('Lista de orçamentos', () => {
  it('mostra o esqueleto enquanto carrega', () => {
    mockListar.mockReturnValue(new Promise(() => undefined));
    abrir();
    expect(screen.getByRole('heading', { name: 'Orçamentos' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('lista os orçamentos com número, valor em reais, vencimento e link', async () => {
    mockListar.mockResolvedValue([ORCAMENTO]);
    abrir();
    const link = await screen.findByRole('link', { name: '00042' });
    expect(link).toHaveAttribute('href', '/orcamentos/7');
    const linha = link.closest('tr') as HTMLElement;
    expect(within(linha).getByText('Mercado Bom Preço')).toBeInTheDocument();
    expect(linha).toHaveTextContent(/R\$\s*1\.234,56/);
    expect(linha).toHaveTextContent('vence em 12 dias');
  });

  it('rascunho aparece sem número e sem aviso de vencimento', async () => {
    mockListar.mockResolvedValue([
      {
        ...ORCAMENTO,
        idOrcamento: 8,
        numeroOrcamento: null,
        status: 'RASCUNHO',
        diasParaVencer: 3,
      },
    ]);
    abrir();
    const link = await screen.findByRole('link', { name: '—' });
    expect(link.closest('tr')).not.toHaveTextContent('vence em');
  });

  it('mostra o estado vazio quando não há orçamentos', async () => {
    mockListar.mockResolvedValue([]);
    abrir();
    expect(await screen.findByText('Nenhum orçamento encontrado')).toBeInTheDocument();
  });

  it('mostra o erro do servidor e tenta novamente', async () => {
    mockListar
      .mockRejectedValueOnce(new ApiError(500, 'ERRO_INTERNO', 'Falha ao listar'))
      .mockResolvedValueOnce([ORCAMENTO]);
    abrir();
    expect(await screen.findByText('Falha ao listar')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('link', { name: '00042' })).toBeInTheDocument();
  });

  it('lê os filtros da URL ao abrir', async () => {
    mockListar.mockResolvedValue([]);
    abrir('/orcamentos?status=ACEITO&cliente=Bom');
    await screen.findByText('Nenhum orçamento encontrado');
    expect(mockListar).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ACEITO', cliente: 'Bom' }),
    );
    expect(screen.getByLabelText('Status')).toHaveValue('ACEITO');
    expect(screen.getByLabelText('Cliente')).toHaveValue('Bom');
  });

  it('Filtrar grava os campos preenchidos na URL e consulta de novo; Limpar zera', async () => {
    mockListar.mockResolvedValue([ORCAMENTO]);
    abrir();
    await screen.findByRole('link', { name: '00042' });
    await userEvent.type(screen.getByLabelText('Cliente'), 'Bom');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'ABERTO');
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar' }));
    expect(screen.getByTestId('busca')).toHaveTextContent('?status=ABERTO&cliente=Bom');
    expect(mockListar).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'ABERTO', cliente: 'Bom' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(screen.getByTestId('busca')).toBeEmptyDOMElement();
    expect(screen.getByLabelText('Cliente')).toHaveValue('');
  });
});
