import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { clientesApi, respostasApi, type FiltroRespostas, type TipoRespostaPendente } from '@/api';
import { formatarDataHora, formatarNumeroOrcamento } from '@/lib/datas';
import { DataState } from '@/components/DataState';
import { Badge, Cartao, EstadoVazio, Pagina, Selecao, Tabela, Td, Th } from '@/components/ui';

const TIPOS: TipoRespostaPendente[] = [
  'RECUSA',
  'ALTERACAO',
  'ITENS_NAO_APROVADOS',
  'ABAIXO_DO_MINIMO',
];

/** Tela 9 — UC21 – Respostas pendentes: lista. */
export default function RespostasPendentes() {
  const [tipo, setTipo] = useState('');
  const [vendedor, setVendedor] = useState('');
  const filtro: FiltroRespostas = {
    tipo: (tipo || undefined) as TipoRespostaPendente | undefined,
    idVendedor: vendedor ? Number(vendedor) : undefined,
  };
  const vendedores = useQuery({ queryKey: ['vendedores'], queryFn: clientesApi.vendedores });
  const consulta = useQuery({
    queryKey: ['respostas', 'lista', filtro],
    queryFn: () => respostasApi.listar(filtro),
  });

  return (
    <Pagina titulo="Respostas pendentes">
      <Cartao className="mb-4 grid max-w-xl grid-cols-2 gap-3">
        <Selecao rotulo="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="">Todos</option>
          {TIPOS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Selecao>
        <Selecao rotulo="Vendedor" value={vendedor} onChange={(e) => setVendedor(e.target.value)}>
          <option value="">Todos</option>
          {vendedores.data?.map((v) => (
            <option key={v.idOperador} value={v.idOperador}>
              {v.nome}
            </option>
          ))}
        </Selecao>
      </Cartao>

      <Cartao className="overflow-hidden p-0">
        <DataState
          consulta={consulta}
          vazio={(d) =>
            d.length === 0 ? (
              <EstadoVazio
                icone="✅"
                titulo="Nenhuma resposta pendente"
                descricao="As respostas dos clientes que exigem tratamento aparecem aqui."
              />
            ) : null
          }
        >
          {(itens) => (
            <Tabela>
              <thead>
                <tr>
                  <Th>Orçamento</Th>
                  <Th>Cliente</Th>
                  <Th>Vendedor</Th>
                  <Th>Tipo</Th>
                  <Th>Data da resposta</Th>
                </tr>
              </thead>
              <tbody>
                {itens.map((r) => (
                  <tr key={r.idResposta}>
                    <Td>
                      <Link
                        className="font-semibold text-petroleo underline"
                        to={`/respostas/${r.idResposta}`}
                      >
                        {formatarNumeroOrcamento(r.numeroOrcamento)}
                      </Link>
                    </Td>
                    <Td>{r.cliente}</Td>
                    <Td>{r.vendedor}</Td>
                    <Td>
                      <Badge status={r.tipo} />
                    </Td>
                    <Td>{formatarDataHora(r.dataResposta)}</Td>
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
