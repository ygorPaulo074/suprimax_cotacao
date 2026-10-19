import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { orcamentosApi, type FiltroOrcamentos, type StatusOrcamento } from '@/api';
import { formatarBRL } from '@/lib/dinheiro';
import { formatarCnpj, formatarData, formatarNumeroOrcamento } from '@/lib/datas';
import { DataState } from '@/components/DataState';
import {
  Badge,
  BotaoPrimario,
  BotaoSecundario,
  Campo,
  Cartao,
  EstadoVazio,
  Pagina,
  Selecao,
  Tabela,
  Td,
  Th,
} from '@/components/ui';

const STATUS: StatusOrcamento[] = [
  'RASCUNHO',
  'PENDENTE_CREDITO',
  'ABERTO',
  'ALTERACAO_SOLICITADA',
  'ACEITO',
  'RECUSADO',
  'CANCELADO',
  'SUBSTITUIDO',
  'EXPIRADO',
];

/** Tela 7 — UC03 – Orçamentos: lista. Os filtros ficam na URL, para compartilhar e voltar à busca. */
export default function OrcamentosLista() {
  const [params, setParams] = useSearchParams();
  const filtro: FiltroOrcamentos = {
    status: (params.get('status') as StatusOrcamento | null) ?? undefined,
    cliente: params.get('cliente') ?? undefined,
    cnpj: params.get('cnpj') ?? undefined,
    numero: params.get('numero') ?? undefined,
    de: params.get('de') ?? undefined,
    ate: params.get('ate') ?? undefined,
  };
  const [form, setForm] = useState({
    status: '',
    cliente: '',
    cnpj: '',
    numero: '',
    de: '',
    ate: '',
    ...Object.fromEntries(params),
  });
  const consulta = useQuery({
    queryKey: ['orcamentos', 'lista', filtro],
    queryFn: () => orcamentosApi.listar(filtro),
  });

  const aplicar = (e: FormEvent) => {
    e.preventDefault();
    setParams(Object.fromEntries(Object.entries(form).filter(([, v]) => v !== '')));
  };
  const campo = (nome: keyof typeof form) => ({
    value: form[nome],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [nome]: e.target.value }),
  });

  return (
    <Pagina titulo="Orçamentos">
      <Cartao className="mb-4">
        <form onSubmit={aplicar} className="grid grid-cols-2 items-end gap-3 xl:grid-cols-7">
          <Selecao rotulo="Status" {...campo('status')}>
            <option value="">Todos</option>
            {STATUS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Selecao>
          <Campo rotulo="Cliente" {...campo('cliente')} />
          <Campo rotulo="CNPJ" {...campo('cnpj')} />
          <Campo rotulo="Número" {...campo('numero')} />
          <Campo rotulo="De" type="date" {...campo('de')} />
          <Campo rotulo="Até" type="date" {...campo('ate')} />
          <div className="flex gap-2">
            <BotaoPrimario type="submit">Filtrar</BotaoPrimario>
            <BotaoSecundario
              onClick={() => {
                setForm({ status: '', cliente: '', cnpj: '', numero: '', de: '', ate: '' });
                setParams({});
              }}
            >
              Limpar
            </BotaoSecundario>
          </div>
        </form>
      </Cartao>

      <Cartao className="overflow-hidden p-0">
        <DataState
          consulta={consulta}
          vazio={(d) =>
            d.length === 0 ? (
              <EstadoVazio
                icone="🧾"
                titulo="Nenhum orçamento encontrado"
                descricao="Ajuste os filtros ou crie um orçamento a partir de um pedido."
              />
            ) : null
          }
        >
          {(itens) => (
            <Tabela>
              <thead>
                <tr>
                  <Th>Nº</Th>
                  <Th>Cliente</Th>
                  <Th>Data de emissão</Th>
                  <Th>Vencimento</Th>
                  <Th direita>Valor total</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {itens.map((o) => (
                  <tr key={o.idOrcamento}>
                    <Td>
                      <Link
                        className="font-semibold text-petroleo underline"
                        to={`/orcamentos/${o.idOrcamento}`}
                      >
                        {formatarNumeroOrcamento(o.numeroOrcamento)}
                      </Link>
                    </Td>
                    <Td>
                      <div className="font-semibold">{o.cliente}</div>
                      <div className="text-xs text-gray-500">{formatarCnpj(o.cnpj)}</div>
                    </Td>
                    <Td>{formatarData(o.dataEmissao)}</Td>
                    <Td>
                      {formatarData(o.dataValidade)}
                      {o.diasParaVencer !== null && o.status === 'ABERTO' && (
                        <div className="text-xs text-gray-500">
                          vence em {o.diasParaVencer} dias
                        </div>
                      )}
                    </Td>
                    <Td direita>{formatarBRL(o.valorTotalProposta)}</Td>
                    <Td>
                      <Badge status={o.status} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          )}
        </DataState>
      </Cartao>
    </Pagina>
  );
}
