import { useState } from 'react';
import type { BloqueioEmissao, CondicoesComerciais, ItemOrcamento } from '@/api';
import { formatarBRL } from '@/lib/dinheiro';
import { Alerta, Badge, BotaoSecundario, SeloAprovacaoHerdada, Tabela, Td, Th } from './ui';

function QuantidadeEditavel({
  valor,
  aoConfirmar,
  desabilitado,
}: {
  valor: number;
  aoConfirmar: (quantidade: number) => void;
  desabilitado?: boolean;
}) {
  const [texto, setTexto] = useState(String(valor));
  const confirmar = () => {
    const n = Number(texto);
    if (Number.isInteger(n) && n > 0 && n !== valor) aoConfirmar(n);
    else setTexto(String(valor));
  };
  return (
    <input
      type="number"
      min={1}
      value={texto}
      disabled={desabilitado}
      aria-label="Quantidade"
      onChange={(e) => setTexto(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className="w-20 rounded-md border border-gray-300 px-2 py-1 text-right text-sm focus:border-petroleo focus:outline-none"
    />
  );
}

/** Grade de itens do orçamento (docs/10, tela 6, 8 e 10). Valores vêm prontos do backend. */
export function GradeItens({
  itens,
  editavel,
  mostrarSituacao,
  ocupado,
  aoAlterarQuantidade,
  aoRemover,
}: {
  itens: ItemOrcamento[];
  editavel?: boolean;
  mostrarSituacao?: boolean;
  ocupado?: boolean;
  aoAlterarQuantidade?: (item: ItemOrcamento, quantidade: number) => void;
  aoRemover?: (item: ItemOrcamento) => void;
}) {
  return (
    <Tabela>
      <thead>
        <tr>
          <Th>Produto</Th>
          <Th>Granularidade</Th>
          <Th direita>Qtd.</Th>
          <Th direita>Preço aplicado</Th>
          <Th direita>Valor da linha</Th>
          <Th direita>Imposto (18%)</Th>
          <Th direita>Total do item</Th>
          {mostrarSituacao && <Th>Situação</Th>}
          {editavel && <Th />}
        </tr>
      </thead>
      <tbody>
        {itens.map((item) => (
          <tr key={item.idItem}>
            <Td>
              <div className="font-semibold">{item.produto}</div>
              <div className="text-xs text-gray-500">
                {item.marca} · {item.embalagem}
              </div>
            </Td>
            <Td>{item.granularidade === 'FARDO' ? 'Fardo' : 'Avulso'}</Td>
            <Td direita>
              {editavel && aoAlterarQuantidade ? (
                <QuantidadeEditavel
                  key={item.quantidade}
                  valor={item.quantidade}
                  desabilitado={ocupado}
                  aoConfirmar={(q) => aoAlterarQuantidade(item, q)}
                />
              ) : (
                item.quantidade
              )}
            </Td>
            <Td direita>{formatarBRL(item.precoUnitarioAplicado)}</Td>
            <Td direita>{formatarBRL(item.valorLinha)}</Td>
            <Td direita>{formatarBRL(item.valorImposto)}</Td>
            <Td direita className="font-semibold">
              {formatarBRL(item.valorTotalItem)}
            </Td>
            {mostrarSituacao && (
              <Td>
                <div className="flex flex-col items-start gap-1">
                  {item.situacao && <Badge status={item.situacao} />}
                  {item.aprovacaoHerdada && <SeloAprovacaoHerdada />}
                </div>
              </Td>
            )}
            {editavel && (
              <Td>
                <div className="flex flex-col items-start gap-1">
                  {item.aprovacaoHerdada && <SeloAprovacaoHerdada />}
                  <BotaoSecundario disabled={ocupado} onClick={() => aoRemover?.(item)}>
                    Remover
                  </BotaoSecundario>
                </div>
              </Td>
            )}
          </tr>
        ))}
      </tbody>
    </Tabela>
  );
}

const ROTULO_PAGAMENTO: Record<string, string> = {
  ADIANTADO_100: '100% adiantado',
  BOLETO: 'Boleto',
  PARCELADO: 'Parcelado',
  ADIANTADO_50_50: '50% adiantado + 50% após a entrega',
};

export function rotuloCondicaoPagamento(condicao: string | null): string {
  return condicao ? (ROTULO_PAGAMENTO[condicao] ?? condicao) : '—';
}

/** Totais do orçamento: itens, imposto, frete e total da proposta (já com impostos inclusos). */
export function ResumoTotais({ condicoes }: { condicoes: CondicoesComerciais }) {
  const linhas: [string, string][] = [
    ['Subtotal com imposto', formatarBRL(condicoes.valorTotalItens)],
    ['Imposto total', formatarBRL(condicoes.valorTotalImposto)],
    [
      `Frete ${condicoes.modalidadeFrete ?? ''}`.trim(),
      condicoes.modalidadeFrete === 'CIF'
        ? 'Por conta da SupriMax'
        : condicoes.valorFrete === null
          ? 'A cotar'
          : formatarBRL(condicoes.valorFrete),
    ],
  ];
  return (
    <dl className="flex flex-col gap-1.5 text-sm">
      {linhas.map(([rotulo, valor]) => (
        <div key={rotulo} className="flex justify-between">
          <dt className="text-gray-600">{rotulo}</dt>
          <dd className="tabular-nums">{valor}</dd>
        </div>
      ))}
      {condicoes.freteProvisorio && (
        <Alerta className="my-1">
          Frete provisório: valor ainda não cotado com a transportadora.
        </Alerta>
      )}
      <div className="mt-1 flex justify-between border-t border-gray-300 pt-2 text-base font-bold text-petroleo">
        <dt>Total da proposta</dt>
        <dd className="tabular-nums">{formatarBRL(condicoes.valorTotalProposta)}</dd>
      </div>
    </dl>
  );
}

/** Cada bloqueio de emissão aparece em alerta laranja, com o texto recebido do backend. */
export function Bloqueios({ bloqueios }: { bloqueios: BloqueioEmissao[] }) {
  if (bloqueios.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {bloqueios.map((b) => (
        <Alerta key={b.codigo}>{b.mensagem}</Alerta>
      ))}
    </div>
  );
}
