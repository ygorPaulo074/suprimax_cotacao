import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { orcamentosApi, type OrcamentoDetalhe as Orcamento } from '@/api';
import { formatarBRL } from '@/lib/dinheiro';
import { formatarCnpj, formatarData, formatarDataHora, formatarNumeroOrcamento } from '@/lib/datas';
import { GradeItens, ResumoTotais, rotuloCondicaoPagamento } from '@/components/orcamento';
import {
  Alerta,
  Badge,
  BotaoAtencao,
  BotaoPrimario,
  BotaoSecundario,
  Cartao,
  CampoTexto,
  Dado,
  mensagemDeErro,
  Modal,
  Pagina,
  Secao,
} from '@/components/ui';

/** Pré-visualização do PDF a partir do arquivo gerado pelo backend. */
function PreviewPdf({ idOrcamento }: { idOrcamento: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  useEffect(() => {
    let atual: string | null = null;
    let cancelado = false;
    orcamentosApi
      .baixarPdf(idOrcamento)
      .then((blob) => {
        if (cancelado) return;
        atual = URL.createObjectURL(blob);
        setUrl(atual);
      })
      .catch(() => !cancelado && setFalhou(true));
    return () => {
      cancelado = true;
      if (atual) URL.revokeObjectURL(atual);
    };
  }, [idOrcamento]);
  if (falhou) return <Alerta>Não foi possível carregar a pré-visualização do PDF.</Alerta>;
  if (!url)
    return (
      <div
        className="h-96 animate-pulse rounded bg-gray-200"
        role="status"
        aria-label="Carregando PDF"
      />
    );
  return (
    <iframe
      title="Pré-visualização do PDF do orçamento"
      src={url}
      className="h-[600px] w-full rounded border border-gray-300"
    />
  );
}

/** Tela 8 — UC08/UC19 – Orçamento emitido: detalhe. Somente leitura (RN22). */
export default function OrcamentoDetalhe({ orcamento }: { orcamento: Orcamento }) {
  const id = orcamento.idOrcamento;
  const navegar = useNavigate();
  const queryClient = useQueryClient();
  const [cancelando, setCancelando] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const [verPdf, setVerPdf] = useState(false);

  const cancelar = useMutation({
    mutationFn: () => orcamentosApi.cancelar(id, justificativa.trim() || undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orcamentos'] });
      navegar('/orcamentos');
    },
  });
  const enviar = useMutation({ mutationFn: () => orcamentosApi.enviar(id) });
  const baixar = useMutation({
    mutationFn: async () => {
      const blob = await orcamentosApi.baixarPdf(id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `orcamento-${formatarNumeroOrcamento(orcamento.numeroOrcamento)}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    },
  });

  const cancelavel = orcamento.status === 'ABERTO';

  return (
    <Pagina
      titulo={<>Orçamento {formatarNumeroOrcamento(orcamento.numeroOrcamento)}</>}
      acoes={
        <>
          <Badge status={orcamento.status} />
          <BotaoSecundario disabled={baixar.isPending} onClick={() => baixar.mutate()}>
            Baixar PDF
          </BotaoSecundario>
          {cancelavel && (
            <>
              <BotaoPrimario
                disabled={enviar.isPending || enviar.isSuccess}
                onClick={() => enviar.mutate()}
              >
                {enviar.isSuccess ? '✓ Enviado' : 'Enviar'}
              </BotaoPrimario>
              <BotaoAtencao onClick={() => setCancelando(true)}>Cancelar orçamento</BotaoAtencao>
            </>
          )}
        </>
      }
    >
      <Alerta className="mb-4">
        Imutável: para alterar, crie uma nova versão (pelo tratamento da resposta do cliente).
      </Alerta>
      {(enviar.isError || baixar.isError) && (
        <Alerta className="mb-4">{mensagemDeErro(enviar.error ?? baixar.error)}</Alerta>
      )}

      <Cartao className="mb-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Dado rotulo="Cliente">
          {orcamento.cliente}
          <div className="text-xs font-normal text-gray-500">{formatarCnpj(orcamento.cnpj)}</div>
        </Dado>
        <Dado rotulo="Pedido de origem">{orcamento.numeroPedido ?? '—'}</Dado>
        <Dado rotulo="Data de emissão">{formatarData(orcamento.dataEmissao)}</Dado>
        <Dado rotulo="Vencimento (30 dias)">{formatarData(orcamento.dataValidade)}</Dado>
        <Dado rotulo="Chave de segurança">
          <span className="break-all font-mono text-xs">{orcamento.chaveSeguranca ?? '—'}</span>
        </Dado>
        <Dado rotulo="Nº da solicitação de compra">{orcamento.numeroSolicitacaoCompra ?? '—'}</Dado>
        <Dado rotulo="Condição de pagamento">
          {rotuloCondicaoPagamento(orcamento.condicoes.condicaoPagamento)}
        </Dado>
        <Dado rotulo="Total da proposta">
          {formatarBRL(orcamento.condicoes.valorTotalProposta)}
        </Dado>
      </Cartao>

      <Secao titulo="Itens">
        <Cartao className="p-0">
          <GradeItens itens={orcamento.itens} mostrarSituacao />
        </Cartao>
        <Cartao className="mt-3 ml-auto max-w-sm">
          <ResumoTotais condicoes={orcamento.condicoes} />
        </Cartao>
      </Secao>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Secao titulo="Histórico de versões">
          <Cartao>
            {orcamento.versoes.length === 0 ? (
              <p className="text-sm text-gray-500">Sem outras versões.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {orcamento.versoes.map((v) => (
                  <li key={v.idOrcamento} className="flex items-center justify-between">
                    <Link
                      className="font-semibold text-petroleo underline"
                      to={`/orcamentos/${v.idOrcamento}`}
                    >
                      {formatarNumeroOrcamento(v.numeroOrcamento)}
                      {v.idOrcamento === id && ' (atual)'}
                    </Link>
                    <Badge status={v.status} />
                  </li>
                ))}
              </ul>
            )}
          </Cartao>
        </Secao>
        <Secao titulo="Linha do tempo">
          <Cartao>
            <ol className="flex flex-col gap-2 text-sm">
              {orcamento.historico.map((e, i) => (
                <li key={i} className="border-l-2 border-petroleo pl-3">
                  <div className="font-semibold">
                    {e.tipoEvento === 'MUDANCA_STATUS'
                      ? `${e.statusAnterior ?? '—'} → ${e.statusNovo}`
                      : `Follow-up (${e.statusNovo})`}
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatarDataHora(e.dataRegistro)}
                    {e.usuario ? ` · ${e.usuario}` : ''}
                  </div>
                  {e.observacao && <div className="text-xs">{e.observacao}</div>}
                </li>
              ))}
            </ol>
          </Cartao>
        </Secao>
      </div>

      <Secao titulo="Pré-visualização do PDF">
        {verPdf ? (
          <PreviewPdf idOrcamento={id} />
        ) : (
          <BotaoSecundario onClick={() => setVerPdf(true)}>
            Carregar pré-visualização
          </BotaoSecundario>
        )}
      </Secao>

      {cancelando && (
        <Modal
          titulo="Cancelar orçamento"
          aoFechar={() => setCancelando(false)}
          acoes={
            <>
              <BotaoSecundario onClick={() => setCancelando(false)}>Voltar</BotaoSecundario>
              <BotaoPrimario disabled={cancelar.isPending} onClick={() => cancelar.mutate()}>
                Confirmar cancelamento
              </BotaoPrimario>
            </>
          }
        >
          <CampoTexto
            rotulo="Justificativa"
            opcional
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
          />
          {cancelar.isError && <Alerta>{mensagemDeErro(cancelar.error)}</Alerta>}
        </Modal>
      )}
    </Pagina>
  );
}
