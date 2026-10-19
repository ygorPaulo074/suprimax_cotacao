import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { ApiError } from '@/api';

// Biblioteca de componentes (docs/08 seção 8.5 e docs/10 seção 10.3). Sem vermelho: erros e
// bloqueios usam laranja + ícone + texto; a cor nunca é o único indicador de estado.

const cx = (...partes: (string | false | null | undefined)[]) => partes.filter(Boolean).join(' ');

// ---- Badges de status (docs/10, seção 10.4) ----
const BADGES: Record<string, { estilo: string; icone: string }> = {
  // neutro / informativo
  SOLICITADO: { estilo: 'bg-sky-100 text-petroleo', icone: '○' },
  ABERTO: { estilo: 'bg-blue-100 text-blue-800', icone: '◉' },
  OPERADOR: { estilo: 'bg-blue-100 text-blue-800', icone: '●' },
  VENDEDOR: { estilo: 'bg-indigo-100 text-indigo-800', icone: '●' },
  SUBSTITUIDO: { estilo: 'bg-indigo-100 text-indigo-800', icone: '⇄' },
  OPERADOR_CHEFE: { estilo: 'bg-violet-100 text-violet-800', icone: '★' },
  GESTOR: { estilo: 'bg-petroleo text-white', icone: '★' },
  RASCUNHO: { estilo: 'bg-gray-100 text-gray-600', icone: '✎' },
  CANCELADO: { estilo: 'bg-gray-100 text-gray-600', icone: '⊘' },
  EXPIRADO: { estilo: 'bg-gray-100 text-gray-600', icone: '⌛' },
  INATIVO: { estilo: 'bg-gray-100 text-gray-600', icone: '⊘' },
  // em andamento
  EM_ANALISE: { estilo: 'bg-amber-100 text-amber-800', icone: '⟳' },
  ALTERACAO_SOLICITADA: { estilo: 'bg-amber-100 text-amber-800', icone: '✎' },
  ALTERACAO: { estilo: 'bg-amber-100 text-amber-800', icone: '✎' },
  RENEGOCIADA: { estilo: 'bg-amber-100 text-amber-800', icone: '⇄' },
  FISCAL: { estilo: 'bg-amber-100 text-amber-800', icone: '●' },
  // sucesso
  APROVADO: { estilo: 'bg-green-100 text-green-800', icone: '✓' },
  ACEITO: { estilo: 'bg-green-100 text-green-800', icone: '✓' },
  ATIVO: { estilo: 'bg-green-100 text-green-800', icone: '✓' },
  QUITADA: { estilo: 'bg-green-100 text-green-800', icone: '✓' },
  FINANCEIRO: { estilo: 'bg-green-100 text-green-800', icone: '●' },
  // pendência ou bloqueio (laranja)
  NEGADO: { estilo: 'bg-orange-100 text-orange-800', icone: '✕' },
  RECUSADO: { estilo: 'bg-orange-100 text-orange-800', icone: '✕' },
  RECUSA: { estilo: 'bg-orange-100 text-orange-800', icone: '✕' },
  NAO_APROVADO: { estilo: 'bg-orange-100 text-orange-800', icone: '✕' },
  PENDENTE_CREDITO: { estilo: 'bg-orange-100 text-orange-800', icone: '⚠' },
  ITENS_NAO_APROVADOS: { estilo: 'bg-orange-100 text-orange-800', icone: '⚠' },
  ABAIXO_DO_MINIMO: { estilo: 'bg-orange-100 text-orange-800', icone: '⚠' },
  PROTESTADA: { estilo: 'bg-orange-100 text-orange-800', icone: '⚠' },
  EM_ABERTO: { estilo: 'bg-orange-100 text-orange-800', icone: '◉' },
  BLOQUEADO: { estilo: 'bg-orange-100 text-orange-800', icone: '⊘' },
};

/** O texto é sempre o valor literal do status (docs/10, seção 10.4). */
export function Badge({ status }: { status: string }) {
  const cfg = BADGES[status] ?? { estilo: 'bg-gray-100 text-gray-600', icone: '●' };
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold',
        cfg.estilo,
      )}
    >
      <span aria-hidden="true">{cfg.icone}</span>
      {status}
    </span>
  );
}

export function SeloAprovacaoHerdada() {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-800">
      <span aria-hidden="true">✦</span> Aprovação herdada
    </span>
  );
}

// ---- Alerta laranja com ícone e texto ----
export function Alerta({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="alert"
      className={cx(
        'flex items-start gap-2 rounded-md border border-laranja bg-orange-50 px-3.5 py-2.5 text-sm text-orange-900',
        className,
      )}
    >
      <span aria-hidden="true" className="shrink-0 text-base text-laranja">
        ⚠
      </span>
      <span>{children}</span>
    </div>
  );
}

// ---- Botões ----
const botaoBase =
  'inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed';
type PropsBotao = ButtonHTMLAttributes<HTMLButtonElement>;

export function BotaoPrimario({ className, ...props }: PropsBotao) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        botaoBase,
        'bg-petroleo text-white hover:bg-petroleo/90 disabled:bg-gray-400',
        className,
      )}
    />
  );
}
export function BotaoSecundario({ className, ...props }: PropsBotao) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        botaoBase,
        'border-[1.5px] border-petroleo bg-transparent text-petroleo hover:bg-petroleo/5 disabled:border-gray-300 disabled:text-gray-400',
        className,
      )}
    />
  );
}
/** Verde-limão só como preenchimento, para concluir fluxos (Emitir orçamento, Emitir nova versão). */
export function BotaoConfirmacao({ className, ...props }: PropsBotao) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        botaoBase,
        'bg-verde text-petroleo hover:brightness-95 disabled:bg-gray-300 disabled:text-gray-500',
        className,
      )}
    />
  );
}
export function BotaoAtencao({ className, ...props }: PropsBotao) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        botaoBase,
        'border-[1.5px] border-laranja bg-transparent text-orange-800 hover:bg-orange-50 disabled:opacity-50',
        className,
      )}
    />
  );
}

// ---- Campos ----
const classeCampo =
  'w-full rounded-md border bg-white px-3 py-2 text-sm text-grafite outline-none focus:border-petroleo focus:ring-1 focus:ring-petroleo disabled:bg-gray-100';

interface PropsRotulo {
  rotulo: string;
  opcional?: boolean;
  erro?: string | null;
}

function Rotulo({ rotulo, opcional, erro, children }: PropsRotulo & { children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold text-grafite">
        {rotulo}
        {opcional && <span className="font-normal text-gray-500"> (opcional)</span>}
      </span>
      {children}
      {erro && (
        <span role="alert" className="text-xs text-orange-800">
          <span aria-hidden="true">⚠ </span>
          {erro}
        </span>
      )}
    </label>
  );
}

export function Campo({
  rotulo,
  opcional,
  erro,
  className,
  ...props
}: PropsRotulo & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Rotulo rotulo={rotulo} opcional={opcional} erro={erro}>
      <input
        {...props}
        className={cx(classeCampo, erro ? 'border-laranja' : 'border-gray-300', className)}
      />
    </Rotulo>
  );
}

export function CampoTexto({
  rotulo,
  opcional,
  erro,
  className,
  ...props
}: PropsRotulo & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Rotulo rotulo={rotulo} opcional={opcional} erro={erro}>
      <textarea
        rows={3}
        {...props}
        className={cx(classeCampo, erro ? 'border-laranja' : 'border-gray-300', className)}
      />
    </Rotulo>
  );
}

export function Selecao({
  rotulo,
  opcional,
  erro,
  className,
  children,
  ...props
}: PropsRotulo & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Rotulo rotulo={rotulo} opcional={opcional} erro={erro}>
      <select
        {...props}
        className={cx(classeCampo, erro ? 'border-laranja' : 'border-gray-300', className)}
      >
        {children}
      </select>
    </Rotulo>
  );
}

// ---- Tabelas: cabeçalho petróleo, zebra off-white, números à direita ----
export function Tabela({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse [&_tbody_tr:nth-child(even)]:bg-off-white">
        {children}
      </table>
    </div>
  );
}
export function Th({ children, direita }: { children?: ReactNode; direita?: boolean }) {
  return (
    <th
      scope="col"
      className={cx(
        'whitespace-nowrap bg-petroleo px-3 py-2.5 text-sm font-semibold text-white',
        direita ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}
export function Td({
  children,
  direita,
  suave,
  className,
}: {
  children?: ReactNode;
  direita?: boolean;
  suave?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cx(
        'px-3 py-2.5 text-sm',
        direita ? 'text-right tabular-nums' : 'text-left',
        suave ? 'text-gray-500' : 'text-grafite',
        className,
      )}
    >
      {children}
    </td>
  );
}

// ---- Estrutura ----
export function Pagina({
  titulo,
  acoes,
  children,
}: {
  titulo: ReactNode;
  acoes?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="p-7">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-petroleo">{titulo}</h1>
        {acoes && <div className="ml-auto flex items-center gap-2">{acoes}</div>}
      </div>
      {children}
    </div>
  );
}

export function Cartao({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('rounded-lg border border-gray-300 bg-white p-5', className)}>
      {children}
    </div>
  );
}

export function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="mb-4">
      <h2 className="mb-3 text-xl font-semibold text-petroleo">{titulo}</h2>
      {children}
    </section>
  );
}

export function CartaoIndicador({
  rotulo,
  valor,
  atencao,
}: {
  rotulo: string;
  valor: number | string;
  atencao?: boolean;
}) {
  return (
    <div className="min-w-40 rounded-lg border border-gray-300 bg-white px-5 py-4">
      <div className="text-sm text-gray-500">{rotulo}</div>
      <div className={cx('mt-1 text-3xl font-bold', atencao ? 'text-orange-700' : 'text-petroleo')}>
        {valor}
      </div>
    </div>
  );
}

export function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold text-gray-500">{rotulo}</div>
      <div className="text-sm font-semibold text-grafite">{children}</div>
    </div>
  );
}

// ---- Modal (largura máxima 560 px, título petróleo, ações à direita) ----
export function Modal({
  titulo,
  children,
  acoes,
  aoFechar,
}: {
  titulo: string;
  children: ReactNode;
  acoes?: ReactNode;
  aoFechar?: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
    >
      <div className="w-full max-w-[560px] rounded-xl bg-white p-7 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-xl font-bold text-petroleo">{titulo}</h3>
          {aoFechar && (
            <button
              type="button"
              onClick={aoFechar}
              aria-label="Fechar"
              className="text-xl text-gray-500"
            >
              ✕
            </button>
          )}
        </div>
        <div className="mb-5 flex flex-col gap-3">{children}</div>
        {acoes && <div className="flex justify-end gap-2.5">{acoes}</div>}
      </div>
    </div>
  );
}

// ---- Carregamento, vazio e erro (docs/10, seção 10.7) ----
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cx(
        'h-4 w-full rounded bg-gray-200 [animation:skeleton-pulse_1.5s_infinite]',
        className,
      )}
    />
  );
}

export function SkeletonTabela({ linhas = 5 }: { linhas?: number }) {
  return (
    <div role="status" aria-label="Carregando" className="flex flex-col gap-3 p-4">
      {Array.from({ length: linhas }, (_, i) => (
        <Skeleton key={i} className="h-5" />
      ))}
    </div>
  );
}

export function EstadoVazio({
  icone = '📭',
  titulo,
  descricao,
  acao,
}: {
  icone?: string;
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
}) {
  return (
    <div className="px-10 py-14 text-center">
      <div aria-hidden="true" className="mb-3 text-5xl">
        {icone}
      </div>
      <div className="mb-1.5 text-lg font-semibold text-grafite">{titulo}</div>
      {descricao && <div className="mb-5 text-sm text-gray-500">{descricao}</div>}
      {acao}
    </div>
  );
}

export function mensagemDeErro(erro: unknown): string {
  if (erro instanceof ApiError) return erro.message;
  return 'Não foi possível concluir a operação.';
}

/** Alerta de erro de requisição, com o motivo recebido do backend e a opção de tentar novamente. */
export function ErroRequisicao({
  erro,
  aoTentarNovamente,
}: {
  erro: unknown;
  aoTentarNovamente?: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3 p-4">
      <Alerta>{mensagemDeErro(erro)}</Alerta>
      {aoTentarNovamente && (
        <BotaoSecundario onClick={aoTentarNovamente}>Tentar novamente</BotaoSecundario>
      )}
    </div>
  );
}
