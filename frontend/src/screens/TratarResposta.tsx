import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { orcamentosApi, respostasApi } from '@/api';
import { formatarBRL } from '@/lib/dinheiro';
import { formatarNumeroOrcamento } from '@/lib/datas';
import { DataState } from '@/components/DataState';
import { Bloqueios, GradeItens, ResumoTotais } from '@/components/orcamento';
import {
  Alerta,
  Badge,
  BotaoAtencao,
  BotaoConfirmacao,
  BotaoSecundario,
  Cartao,
  Dado,
  mensagemDeErro,
  Modal,
  Pagina,
  Secao,
  Tabela,
  Td,
  Th,
} from '@/components/ui';

/** Tela 10 — UC21 – Tratar resposta e nova versão. */
export default function TratarResposta() {
  const id = Number(useParams().id);
  const navegar = useNavigate();
  const queryClient = useQueryClient();
  const chave = ['respostas', id];
  const consulta = useQuery({ queryKey: chave, queryFn: () => respostasApi.obter(id) });
  const [confirmando, setConfirmando] = useState(false);

  const recarregar = () => queryClient.invalidateQueries({ queryKey: chave });
  const encerrar = () => {
    void queryClient.invalidateQueries({ queryKey: ['respostas'] });
    void queryClient.invalidateQueries({ queryKey: ['orcamentos'] });
    navegar('/respostas');
  };

  const alterar = useMutation({
    mutationFn: (v: { idRascunho: number; idItem: number; quantidade: number }) =>
      orcamentosApi.alterarQuantidade(v.idRascunho, v.idItem, v.quantidade),
    onSuccess: recarregar,
  });
  const remover = useMutation({
    mutationFn: (v: { idRascunho: number; idItem: number }) =>
      orcamentosApi.removerItem(v.idRascunho, v.idItem),
    onSuccess: recarregar,
  });
  const emitir = useMutation({
    mutationFn: () => respostasApi.emitirNovaVersao(id),
    onSuccess: encerrar,
  });
  const tratada = useMutation({
    mutationFn: () => respostasApi.marcarTratada(id),
    onSuccess: encerrar,
  });
  const descartar = useMutation({
    mutationFn: () => respostasApi.cancelarRascunho(id),
    onSuccess: encerrar,
  });

  return (
    <DataState consulta={consulta}>
      {(r) => {
        const rascunho = r.novaVersao;
        const ocupado = alterar.isPending || remover.isPending;
        const emissaoBloqueada =
          rascunho.condicoes.bloqueios.length > 0 || rascunho.itens.length === 0;
        const erro =
          alterar.error ?? remover.error ?? emitir.error ?? tratada.error ?? descartar.error;
        return (
          <Pagina
            titulo={<>Tratar resposta — orçamento {formatarNumeroOrcamento(r.numeroOrcamento)}</>}
            acoes={<Badge status={r.tipo} />}
          >
            <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
              <Secao titulo="Orçamento original">
                <Cartao className="mb-3 grid grid-cols-2 gap-3">
                  <Dado rotulo="Cliente">{r.cliente}</Dado>
                  <Dado rotulo="Vendedor">{r.vendedor}</Dado>
                </Cartao>
                <Cartao className="mb-3 p-0">
                  <Tabela>
                    <thead>
                      <tr>
                        <Th>Produto</Th>
                        <Th>Situação</Th>
                        <Th direita>Cotado</Th>
                        <Th direita>Aprovado</Th>
                        <Th direita>Valor recalculado</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.itensOriginal.map((i) => (
                        <tr key={i.idItem}>
                          <Td>{i.produto}</Td>
                          <Td>
                            <Badge status={i.situacao} />
                          </Td>
                          <Td direita>{i.quantidadeCotada}</Td>
                          <Td direita>{i.quantidadeAprovada}</Td>
                          <Td direita>{formatarBRL(i.valorTotalItemAceito)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Tabela>
                </Cartao>
                <Cartao>
                  <Dado rotulo="Justificativa do vendedor">
                    {r.justificativa?.trim() ? (
                      r.justificativa
                    ) : (
                      <span className="font-normal italic text-gray-500">
                        Sem justificativa informada.
                      </span>
                    )}
                  </Dado>
                </Cartao>
              </Secao>

              <Secao titulo="Nova versão (rascunho)">
                <Alerta className="mb-3">A nova versão exige a confirmação do cliente.</Alerta>
                <Cartao className="mb-3 p-0">
                  <GradeItens
                    itens={rascunho.itens}
                    editavel
                    ocupado={ocupado}
                    aoAlterarQuantidade={(item, quantidade) =>
                      alterar.mutate({
                        idRascunho: rascunho.idOrcamento,
                        idItem: item.idItem,
                        quantidade,
                      })
                    }
                    aoRemover={(item) =>
                      remover.mutate({ idRascunho: rascunho.idOrcamento, idItem: item.idItem })
                    }
                  />
                </Cartao>
                <Cartao className="mb-3">
                  <ResumoTotais condicoes={rascunho.condicoes} />
                </Cartao>
                <Bloqueios bloqueios={rascunho.condicoes.bloqueios} />
                {erro && <Alerta className="mt-3">{mensagemDeErro(erro)}</Alerta>}
                <div className="mt-4 flex flex-wrap gap-3">
                  <BotaoConfirmacao
                    disabled={emissaoBloqueada || emitir.isPending}
                    onClick={() => setConfirmando(true)}
                  >
                    Emitir nova versão
                  </BotaoConfirmacao>
                  <BotaoSecundario disabled={tratada.isPending} onClick={() => tratada.mutate()}>
                    Marcar como tratada sem nova versão
                  </BotaoSecundario>
                  <BotaoAtencao disabled={descartar.isPending} onClick={() => descartar.mutate()}>
                    Cancelar rascunho
                  </BotaoAtencao>
                </div>
              </Secao>
            </div>

            {confirmando && (
              <Modal
                titulo="Substituir o orçamento original"
                aoFechar={() => setConfirmando(false)}
                acoes={
                  <>
                    <BotaoSecundario onClick={() => setConfirmando(false)}>Voltar</BotaoSecundario>
                    <BotaoConfirmacao
                      disabled={emitir.isPending}
                      onClick={() => {
                        setConfirmando(false);
                        emitir.mutate();
                      }}
                    >
                      Confirmar e emitir
                    </BotaoConfirmacao>
                  </>
                }
              >
                <p className="text-sm">
                  Ao emitir a nova versão, o orçamento {formatarNumeroOrcamento(r.numeroOrcamento)}{' '}
                  passará a <strong>SUBSTITUIDO</strong>. A nova versão recebe número novo e
                  validade de 30 dias.
                </p>
              </Modal>
            )}
          </Pagina>
        );
      }}
    </DataState>
  );
}
