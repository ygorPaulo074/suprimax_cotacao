/** Datas no padrão brasileiro (docs/10, seção 10.7). Aceita 'AAAA-MM-DD' ou timestamp ISO. */
export function formatarData(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [ano, mes, dia] = iso.slice(0, 10).split('-');
  if (!ano || !mes || !dia) return '—';
  return `${dia}/${mes}/${ano}`;
}

export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  const hora = iso.length > 10 ? iso.slice(11, 16) : '';
  return hora ? `${formatarData(iso)} ${hora}` : formatarData(iso);
}

/** 12345678000199 -> 12.345.678/0001-99 */
export function formatarCnpj(cnpj: string): string {
  const d = cnpj.replace(/\D/g, '');
  if (d.length !== 14) return cnpj;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Número do orçamento: mínimo de 5 dígitos, sem limite superior (RF12). Só existe na exibição. */
export function formatarNumeroOrcamento(numero: number | null | undefined): string {
  return numero === null || numero === undefined ? '—' : String(numero).padStart(5, '0');
}
