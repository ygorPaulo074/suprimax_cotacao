// UC19 — docs/11, seção 11.6.3.5.
import type { DataISO } from './types';
import { VALIDADE_ORCAMENTO_DIAS } from './regras';
import { validarDataISO, validarNumero } from './validacao';

export function formatarNumeroOrcamento({ numero }: { numero: number }): {
  numeroFormatado: string;
} {
  validarNumero(numero);
  return { numeroFormatado: String(numero).padStart(5, '0') };
}

export function calcularValidadeOrcamento({ dataEmissao }: { dataEmissao: DataISO }): {
  dataValidade: DataISO;
} {
  validarDataISO(dataEmissao);
  const partes = dataEmissao.split('-').map(Number) as [number, number, number];
  const ano = partes[0];
  const mes = partes[1];
  const dia = partes[2];
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  data.setUTCDate(data.getUTCDate() + VALIDADE_ORCAMENTO_DIAS);
  const dataValidade = data.toISOString().slice(0, 10) as DataISO;
  return { dataValidade };
}
