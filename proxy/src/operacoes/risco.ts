import { AppError } from '../erros';
import { SEM_CREDENCIAIS } from '../sql/base';
import { montarContagem } from '../sql/consultar';
import { filtroVazio, type Filtro } from '../sql/filtros';
import type { ContextoOperacao } from './tipos';

// Verificação de risco estrutural (docs/12, seções 12.1 e 12.4): dados.atualizar e dados.excluir
// sem filtro, ou que afetariam mais de 50 linhas, são bloqueados (RISCO_ESTRUTURAL). A alteração
// de chave primária é barrada no gerador de SQL (escrita.ts).

export const LIMITE_LINHAS_RISCO = 50;

export async function verificarRiscoEscrita(
  ctx: Pick<ContextoOperacao, 'banco' | 'esquema' | 'registrarRisco'>,
  tabela: string,
  filtros: Filtro | undefined,
): Promise<void> {
  const bloquear = (motivo: string): never => {
    ctx.registrarRisco('BLOQUEADO');
    throw new AppError('RISCO_ESTRUTURAL', undefined, motivo);
  };

  if (filtroVazio(filtros)) bloquear(`${tabela}: operação sem filtro`);

  const contagem = montarContagem(ctx.esquema, tabela, filtros as Filtro, SEM_CREDENCIAIS);
  const { linhas } = await ctx.banco.consultar(contagem);
  const total = Number(linhas[0]?.total ?? 0);
  if (total > LIMITE_LINHAS_RISCO)
    bloquear(`${tabela}: ${total} linhas afetadas (máximo ${LIMITE_LINHAS_RISCO})`);

  ctx.registrarRisco('APROVADO');
}
