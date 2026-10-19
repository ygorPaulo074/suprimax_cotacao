import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pedidosApi } from '@/api';
import { formatarCnpj, formatarData } from '@/lib/datas';
import { DataState } from '@/components/DataState';
import {
  Alerta,
  Badge,
  BotaoPrimario,
  CartaoIndicador,
  EstadoVazio,
  mensagemDeErro,
  Pagina,
  Tabela,
  Td,
  Th,
} from '@/components/ui';

/** Tela 2 — UC10 – Pedidos em aberto. Fila dos pedidos registrados pelo Sistema 1. */
export default function Pedidos() {
  const navegar = useNavigate();
  const queryClient = useQueryClient();
  const consulta = useQuery({ queryKey: ['pedidos'], queryFn: () => pedidosApi.listar() });

  const assumir = useMutation({
    mutationFn: (idPedido: number) => pedidosApi.assumir(idPedido),
    onSuccess: (pedido) => navegar(`/pedidos/${pedido.idPedido}`),
    // PEDIDO_JA_ASSUMIDO: outro operador chegou antes; a fila é recarregada.
    onError: () => void queryClient.invalidateQueries({ queryKey: ['pedidos'] }),
  });

  return (
    <Pagina titulo="Pedidos em aberto">
      {assumir.isError && <Alerta className="mb-4">{mensagemDeErro(assumir.error)}</Alerta>}
      <DataState consulta={consulta}>
        {({ itens, indicadores }) => (
          <>
            <div className="mb-7 flex flex-wrap gap-4">
              <CartaoIndicador rotulo="Aguardando análise" valor={indicadores.aguardandoAnalise} />
              <CartaoIndicador rotulo="Em análise" valor={indicadores.emAnalise} atencao />
              <CartaoIndicador
                rotulo="Orçamentos em aberto"
                valor={indicadores.orcamentosEmAberto}
              />
              <CartaoIndicador
                rotulo="Pendentes de crédito"
                valor={indicadores.pendentesCredito}
                atencao
              />
            </div>
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-200 px-5 py-4">
                <h2 className="text-base font-semibold text-petroleo">
                  Pedidos recebidos pelo Sistema 1
                </h2>
              </div>
              {itens.length === 0 ? (
                <EstadoVazio
                  icone="📋"
                  titulo="Nenhum pedido em aberto"
                  descricao="Os novos pedidos dos vendedores aparecem aqui."
                />
              ) : (
                <Tabela>
                  <thead>
                    <tr>
                      <Th>Nº do pedido</Th>
                      <Th>Cliente</Th>
                      <Th>Vendedor</Th>
                      <Th>Data da solicitação</Th>
                      <Th direita>Itens</Th>
                      <Th>Status</Th>
                      <Th>Ação</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((p) => (
                      <tr key={p.idPedido}>
                        <Td className="font-semibold text-petroleo">{p.numero}</Td>
                        <Td>
                          <div className="font-semibold">{p.cliente}</div>
                          <div className="text-xs text-gray-500">{formatarCnpj(p.cnpj)}</div>
                        </Td>
                        <Td>{p.vendedor}</Td>
                        <Td>{formatarData(p.dataSolicitacao)}</Td>
                        <Td direita>{p.quantidadeItens}</Td>
                        <Td>
                          <Badge status={p.status} />
                        </Td>
                        <Td>
                          {p.status === 'SOLICITADO' ? (
                            <BotaoPrimario
                              disabled={assumir.isPending}
                              onClick={() => assumir.mutate(p.idPedido)}
                            >
                              Selecionar pedido
                            </BotaoPrimario>
                          ) : p.assumidoPorOutro ? (
                            <span className="text-xs text-gray-500">
                              Em análise
                              {p.operadorAtendimento
                                ? ` por ${p.operadorAtendimento}`
                                : ' por outro operador'}
                            </span>
                          ) : (
                            <Link
                              className="text-sm font-semibold text-petroleo underline"
                              to={`/pedidos/${p.idPedido}`}
                            >
                              Continuar análise
                            </Link>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Tabela>
              )}
            </div>
          </>
        )}
      </DataState>
    </Pagina>
  );
}
