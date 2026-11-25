import {
  CHAVE_DA_LIBERACAO,
  VALIDADE_DA_LIBERACAO_MS,
  lerLiberacao,
  liberacaoVale,
  registrarLiberacao,
  textoDoErroDaEtapa,
  type ArmazenamentoDeLiberacao,
} from './aguardoDosServicos';

function armazenamentoEmMemoria(): ArmazenamentoDeLiberacao & { itens: Map<string, string> } {
  const itens = new Map<string, string>();
  return {
    itens,
    getItem: (chave) => itens.get(chave) ?? null,
    setItem: (chave, valor) => void itens.set(chave, valor),
    removeItem: (chave) => void itens.delete(chave),
  };
}

const quebrado: ArmazenamentoDeLiberacao = {
  getItem: () => {
    throw new Error('sem acesso');
  },
  setItem: () => {
    throw new Error('sem acesso');
  },
  removeItem: () => undefined,
};

describe('liberação guardada na aba', () => {
  it('registra o instante e lê de volta', () => {
    const armazenamento = armazenamentoEmMemoria();
    registrarLiberacao(armazenamento, 1_000);
    expect(armazenamento.itens.get(CHAVE_DA_LIBERACAO)).toBe('1000');
    expect(lerLiberacao(armazenamento)).toBe(1_000);
  });

  it.each([
    ['nada guardado', null],
    ['texto que não é número', 'abc'],
  ])('lê null quando há %s', (_caso, valor) => {
    const armazenamento = armazenamentoEmMemoria();
    if (valor !== null) armazenamento.setItem(CHAVE_DA_LIBERACAO, valor);
    expect(lerLiberacao(armazenamento)).toBeNull();
  });

  it('se o navegador não deixa usar o armazenamento, lê null e não lança ao gravar', () => {
    expect(lerLiberacao(quebrado)).toBeNull();
    expect(() => registrarLiberacao(quebrado, 1)).not.toThrow();
  });
});

describe('liberacaoVale', () => {
  it('vale dentro do prazo e deixa de valer depois dele', () => {
    expect(liberacaoVale(1_000, 1_000 + VALIDADE_DA_LIBERACAO_MS - 1)).toBe(true);
    expect(liberacaoVale(1_000, 1_000 + VALIDADE_DA_LIBERACAO_MS)).toBe(false);
  });

  it('não vale sem registro nem com instante no futuro (relógio mudou)', () => {
    expect(liberacaoVale(null, 5)).toBe(false);
    expect(liberacaoVale(10_000, 5)).toBe(false);
  });
});

describe('textoDoErroDaEtapa', () => {
  it('traduz os códigos conhecidos e mostra os desconhecidos como vieram', () => {
    expect(textoDoErroDaEtapa('PROXY_INDISPONIVEL')).toBe('depende do proxy, que não respondeu');
    expect(textoDoErroDaEtapa('SERVICO_INDISPONIVEL')).toBe('não respondeu a tempo');
    expect(textoDoErroDaEtapa('OUTRO')).toBe('falhou (OUTRO)');
    expect(textoDoErroDaEtapa(undefined)).toBe('falhou');
  });
});
