import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { saudeApi, type NomeDaVerificacao, type VerificacaoDeSaude } from '@/api';
import {
  lerLiberacao,
  liberacaoVale,
  registrarLiberacao,
  textoDoErroDaEtapa,
  type ArmazenamentoDeLiberacao,
} from '@/lib/aguardoDosServicos';
import { Alerta, BotaoSecundario } from '@/components/ui';

/** De quanto em quanto tempo a verificação se repete enquanto algum serviço não responde. */
export const INTERVALO_DA_VERIFICACAO_MS = 3_000;
/** Depois disso a página avisa que está demorando mais que o normal. */
export const SEGUNDOS_PARA_AVISO_DE_DEMORA = 90;

/** As etapas, na ordem em que a página as mostra antes de a primeira resposta chegar. */
const ETAPAS: readonly { nome: NomeDaVerificacao; rotulo: string }[] = [
  { nome: 'backend', rotulo: 'Servidor (backend)' },
  { nome: 'proxy', rotulo: 'Proxy de dados' },
  { nome: 'banco_leitura', rotulo: 'Banco de dados: leitura' },
  { nome: 'banco_gravacao', rotulo: 'Banco de dados: gravação' },
  { nome: 'sessoes', rotulo: 'Login: criação de sessão' },
];

type Situacao = 'aguardando' | 'ok' | 'falhou';

function PaginaDeAguardo({
  aoLiberar,
  intervaloMs,
}: {
  aoLiberar: () => void;
  intervaloMs: number;
}) {
  const [segundos, setSegundos] = useState(0);
  const [verificacoes, setVerificacoes] = useState(0);
  const consulta = useQuery({
    queryKey: ['saude-completa'],
    queryFn: ({ signal }) => saudeApi.completa(signal).finally(() => setVerificacoes((n) => n + 1)),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: (q) => (q.state.data?.ok ? false : intervaloMs),
  });

  useEffect(() => {
    const id = setInterval(() => setSegundos((s) => s + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  const liberado = consulta.data?.ok === true;
  useEffect(() => {
    if (liberado) aoLiberar();
  }, [liberado, aoLiberar]);

  // O servidor nem respondeu (dormindo ou reiniciando): só ele é dado como sem resposta.
  const semRespostaDoServidor = consulta.data === undefined && consulta.isError;
  const respondidas = new Map<NomeDaVerificacao, VerificacaoDeSaude>(
    (consulta.data?.verificacoes ?? []).map((v) => [v.nome, v]),
  );
  const situacaoDe = (nome: NomeDaVerificacao): { situacao: Situacao; detalhe: string } => {
    const verificacao = respondidas.get(nome);
    if (verificacao) {
      return verificacao.ok
        ? { situacao: 'ok', detalhe: `${verificacao.duracaoMs} ms` }
        : { situacao: 'falhou', detalhe: textoDoErroDaEtapa(verificacao.erro) };
    }
    if (nome === 'backend' && semRespostaDoServidor) {
      return { situacao: 'falhou', detalhe: 'ainda não respondeu (pode estar acordando)' };
    }
    return { situacao: 'aguardando', detalhe: 'aguardando' };
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-off-white p-6">
      <div className="w-full max-w-md rounded-xl border border-gray-300 bg-white p-8 shadow-sm">
        <div className="mb-5 text-center">
          <div aria-hidden="true" className="text-4xl">
            🛒
          </div>
          <div className="text-2xl font-bold text-petroleo">SupriMax</div>
          <h1 className="mt-1 text-base font-semibold text-grafite">Verificando os serviços</h1>
        </div>

        <p className="mb-4 text-sm text-gray-600">
          O sistema abre quando todos os serviços responderem. Depois de um tempo parado, acordar os
          serviços pode levar até 2 minutos. Você não precisa fazer nada.
        </p>

        <ul aria-label="Estado dos serviços" className="mb-4 flex flex-col gap-2">
          {ETAPAS.map(({ nome, rotulo }) => {
            const { situacao, detalhe } = situacaoDe(nome);
            return (
              <li
                key={nome}
                data-situacao={situacao}
                className="flex items-start gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm"
              >
                <span aria-hidden="true" className="w-5 text-center">
                  {situacao === 'ok' ? '✓' : situacao === 'falhou' ? '⚠' : '…'}
                </span>
                <span className="flex-1">
                  <span className="font-semibold text-grafite">{rotulo}</span>
                  <span
                    className={
                      situacao === 'ok'
                        ? 'block text-xs text-green-700'
                        : situacao === 'falhou'
                          ? 'block text-xs text-orange-800'
                          : 'block text-xs text-gray-500'
                    }
                  >
                    {situacao === 'ok' ? 'funcionando' : situacao === 'falhou' ? 'não passou' : ''}
                    {situacao === 'ok' ? ' · ' : situacao === 'falhou' ? ': ' : ''}
                    {detalhe}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>

        <div role="status" aria-live="polite" className="mb-3 text-xs text-gray-500">
          Aguardando há {segundos} s · verificação {verificacoes + 1}
        </div>

        {segundos >= SEGUNDOS_PARA_AVISO_DE_DEMORA && (
          <Alerta className="mb-3">
            Está demorando mais que o normal. A página continua verificando sozinha. Se passar de
            alguns minutos, avise quem cuida do sistema e informe qual item acima não passou.
          </Alerta>
        )}

        <BotaoSecundario onClick={() => void consulta.refetch()} disabled={consulta.isFetching}>
          {consulta.isFetching ? 'Verificando…' : 'Verificar agora'}
        </BotaoSecundario>
      </div>
    </div>
  );
}

/**
 * Página de aguardo: antes de abrir o sistema, confere se os serviços respondem e só libera quando
 * todos estão positivos. A liberação vale por 10 minutos na mesma aba. Com `ativo` falso (ex.: em
 * desenvolvimento), o sistema abre direto.
 */
export function GateServicos({
  ativo,
  children,
  intervaloMs = INTERVALO_DA_VERIFICACAO_MS,
  armazenamento,
}: {
  ativo: boolean;
  children: ReactNode;
  intervaloMs?: number;
  /** Onde guardar a liberação; por padrão, o `sessionStorage` da aba. */
  armazenamento?: ArmazenamentoDeLiberacao;
}) {
  const guarda = armazenamento ?? window.sessionStorage;
  const [liberado, setLiberado] = useState(
    () => !ativo || liberacaoVale(lerLiberacao(guarda), Date.now()),
  );
  const liberar = useCallback(() => {
    registrarLiberacao(guarda, Date.now());
    setLiberado(true);
  }, [guarda]);

  if (liberado) return <>{children}</>;
  return <PaginaDeAguardo aoLiberar={liberar} intervaloMs={intervaloMs} />;
}
