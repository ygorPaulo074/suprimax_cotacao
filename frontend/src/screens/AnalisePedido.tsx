import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { pedidosApi } from '@/api';
import { formatarBRL } from '@/lib/dinheiro';
import { DataState } from '@/components/DataState';
import { rotuloCondicaoPagamento } from '@/components/orcamento';
import {
  Alerta,
  Badge,
  BotaoConfirmacao,
  BotaoPrimario,
  BotaoSecundario,
  Cartao,
  CampoTexto,
  Dado,
  mensagemDeErro,
  Modal,
  Pagina,
  Secao,
  Tabela,
  Td,
  Th,
} from '@/components/ui';

/** Tela 3 — UC10 – Análise do pedido. */
export default function AnalisePedido() {
  const id = Number(useParams().id);
  const navegar = useNavigate();
  const consulta = useQuery({ queryKey: ['pedidos', id], queryFn: () => pedidosApi.obter(id) });
  const [negando, setNegando] = useState(false);
  const [motivo, setMotivo] = useState('');

  const aprovar = useMutation({
    mutationFn: () => pedidosApi.aprovarEMontar(id),
    onSuccess: ({ idOrcamento }) => navegar(`/orcamentos/${idOrcamento}`),
  });
  const negar = useMutation({
    mutationFn: () => pedidosApi.negar(id, motivo.trim()),
    onSuccess: () => navegar('/pedidos'),
  });

  return (
    <DataState consulta={consulta}>
      {(p) => {
        const bloqueadoPorDivida = p.situacaoCliente.dividaEmAberto > 0;
        return (
          <Pagina titulo={<>Análise do pedido {p.numero}</>} acoes={<Badge status={p.status} />}>
            <div className="mb-4 grid grid-cols-1 gap-3 xl:grid-cols-3">
              <Dado rotulo="Cliente">{p.cliente}</Dado>
              <Dado rotulo="Vendedor">{p.vendedor}</Dado>
              <Dado rotulo="Operador em atendimento">{p.operadorAtendimento ?? '—'}</Dado>
            </div>

            <Secao titulo="Itens desejados">
              <Cartao className="p-0">
                <Tabela>
                  <thead>
                    <tr>
                      <Th>Produto</Th>
                      <Th>Marca</Th>
                      <Th>Embalagem</Th>
                      <Th>Fardo/Avulso</Th>
                      <Th direita>Qtd. solicitada</Th>
                      <Th direita>Saldo disponível</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.itens.map((i) => (
                      <tr key={i.idItemPedido}>
                        <Td>{i.produto}</Td>
                        <Td>{i.marca}</Td>
                        <Td>{i.embalagem}</Td>
                        <Td>{i.granularidade === 'FARDO' ? 'Fardo' : 'Avulso'}</Td>
                        <Td direita>{i.quantidadeSolicitada}</Td>
                        <Td
                          direita
                          className={
                            i.saldoDisponivel < i.quantidadeSolicitada
                              ? 'font-semibold text-orange-800'
                              : ''
                          }
                        >
                          {i.saldoDisponivel < i.quantidadeSolicitada && (
                            <span aria-hidden="true">⚠ </span>
                          )}
                          {i.saldoDisponivel}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Tabela>
              </Cartao>
            </Secao>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Secao titulo="Configuração do pedido">
                <Cartao className="grid grid-cols-2 gap-3">
                  <Dado rotulo="Endereço de entrega">{p.enderecoEntrega ?? '—'}</Dado>
                  <Dado rotulo="Nº da solicitação de compra">
                    {p.numeroSolicitacaoCompra ?? '—'}
                  </Dado>
                  <Dado rotulo="Contato">{p.contato ?? '—'}</Dado>
                  <Dado rotulo="Condição de pagamento desejada">
                    {rotuloCondicaoPagamento(p.condicaoPagamentoDesejada)}
                  </Dado>
                  <Dado rotulo="Prazo do boleto desejado">
                    {p.prazoDiasDesejado ? `${p.prazoDiasDesejado} dias` : '—'}
                  </Dado>
                  <Dado rotulo="Nº de parcelas desejado">{p.numeroParcelasDesejado ?? '—'}</Dado>
                  <Dado rotulo="Transportadora indicada">{p.transportadoraIndicada ?? '—'}</Dado>
                  <Dado rotulo="Observações">{p.observacoes ?? '—'}</Dado>
                </Cartao>
              </Secao>

              <Secao titulo="Situação do cliente">
                <Cartao className="flex flex-col gap-3">
                  <Dado rotulo="Crédito">
                    {p.situacaoCliente.creditoAprovado === null
                      ? 'Sem análise'
                      : p.situacaoCliente.creditoAprovado
                        ? '✓ Aprovado'
                        : '⚠ Reprovado'}
                  </Dado>
                  <Dado rotulo="Primeira compra">
                    {p.situacaoCliente.primeiraCompra ? 'Sim (100% adiantado)' : 'Não'}
                  </Dado>
                  <Dado rotulo="Dívida em aberto">
                    {formatarBRL(p.situacaoCliente.dividaEmAberto)}
                  </Dado>
                  {bloqueadoPorDivida && (
                    <Alerta>Cliente com dívida em aberto: novo orçamento bloqueado.</Alerta>
                  )}
                </Cartao>
              </Secao>
            </div>

            {(aprovar.isError || negar.isError) && (
              <Alerta className="mt-3">{mensagemDeErro(aprovar.error ?? negar.error)}</Alerta>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <BotaoPrimario
                disabled={bloqueadoPorDivida || aprovar.isPending}
                onClick={() => aprovar.mutate()}
              >
                Aprovar e montar orçamento
              </BotaoPrimario>
              <BotaoSecundario onClick={() => setNegando(true)}>Negar pedido</BotaoSecundario>
              <BotaoSecundario onClick={() => navegar('/pedidos')}>
                Devolver à lista
              </BotaoSecundario>
            </div>

            {negando && (
              <Modal
                titulo="Negar pedido"
                aoFechar={() => setNegando(false)}
                acoes={
                  <>
                    <BotaoSecundario onClick={() => setNegando(false)}>Voltar</BotaoSecundario>
                    <BotaoConfirmacao
                      disabled={!motivo.trim() || negar.isPending}
                      onClick={() => negar.mutate()}
                    >
                      Confirmar negativa
                    </BotaoConfirmacao>
                  </>
                }
              >
                <CampoTexto
                  rotulo="Motivo da negativa"
                  required
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  erro={motivo.trim() ? null : 'O motivo é obrigatório.'}
                />
              </Modal>
            )}
          </Pagina>
        );
      }}
    </DataState>
  );
}
