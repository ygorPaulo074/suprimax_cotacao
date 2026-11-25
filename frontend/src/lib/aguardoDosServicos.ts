// Página de aguardo: guarda por alguns minutos que os serviços já responderam, para não repetir a
// verificação a cada recarga. O plano gratuito hiberna os serviços depois de 15 minutos sem uso.

/** Por quanto tempo uma verificação positiva vale dentro da mesma aba. */
export const VALIDADE_DA_LIBERACAO_MS = 10 * 60 * 1000;

export const CHAVE_DA_LIBERACAO = 'suprimax:servicos-liberados-em';

/** O que se precisa do armazenamento da aba (`sessionStorage`). */
export type ArmazenamentoDeLiberacao = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Instante da última verificação positiva, ou `null` se não houver (ou o navegador não deixar ler). */
export function lerLiberacao(armazenamento: ArmazenamentoDeLiberacao): number | null {
  try {
    const bruto = armazenamento.getItem(CHAVE_DA_LIBERACAO);
    const instante = bruto === null ? Number.NaN : Number(bruto);
    return Number.isFinite(instante) ? instante : null;
  } catch {
    return null;
  }
}

export function registrarLiberacao(armazenamento: ArmazenamentoDeLiberacao, agora: number): void {
  try {
    armazenamento.setItem(CHAVE_DA_LIBERACAO, String(agora));
  } catch {
    // Sem armazenamento (modo privado restrito): a verificação só se repete na próxima carga.
  }
}

export function liberacaoVale(instante: number | null, agora: number): boolean {
  return instante !== null && agora >= instante && agora - instante < VALIDADE_DA_LIBERACAO_MS;
}

const TEXTOS_DE_ERRO: Readonly<Record<string, string>> = {
  PROXY_NAO_CONFIGURADO: 'o servidor não tem o endereço do proxy configurado',
  PROXY_INDISPONIVEL: 'depende do proxy, que não respondeu',
  SEM_LEITURA: 'depende da leitura do banco, que falhou',
  SEM_USUARIOS: 'o banco não tem nenhum usuário para testar',
  SERVICO_INDISPONIVEL: 'não respondeu a tempo',
  TEMPO_ESGOTADO: 'não respondeu a tempo',
  FALHA_DE_REDE: 'sem resposta da rede',
  LIMITE_EXCEDIDO: 'limite de requisições atingido, aguarde um instante',
};

/** Frase para o código de erro de uma etapa; código desconhecido aparece como veio. */
export function textoDoErroDaEtapa(codigo: string | undefined): string {
  if (codigo === undefined) return 'falhou';
  return TEXTOS_DE_ERRO[codigo] ?? `falhou (${codigo})`;
}
