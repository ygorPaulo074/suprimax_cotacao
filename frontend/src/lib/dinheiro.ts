import type { Centavos } from '@/api/types';

/** R$ 0.000,00 (docs/10, seção 10.7). Recebe centavos inteiros; nunca faz cálculo comercial. */
export function formatarBRL(centavos: Centavos | null | undefined): string {
  if (centavos === null || centavos === undefined || !Number.isFinite(centavos)) return '—';
  const negativo = centavos < 0;
  const abs = Math.abs(Math.trunc(centavos));
  const inteiro = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const resto = (abs % 100).toString().padStart(2, '0');
  return `${negativo ? '-' : ''}R$ ${inteiro},${resto}`;
}

/** Converte o texto digitado ("19", "19,5", "1.234,56") em centavos; null se inválido. */
export function reaisParaCentavos(texto: string): Centavos | null {
  const limpo = texto
    .trim()
    .replace(/^R\$\s*/, '')
    .replace(/\./g, '');
  if (!/^\d+(,\d{1,2})?$/.test(limpo)) return null;
  const [inteiro = '0', decimais = ''] = limpo.split(',');
  return Number(inteiro) * 100 + Number(decimais.padEnd(2, '0'));
}
