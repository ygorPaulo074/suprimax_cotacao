// Verificação de saúde completa: confere de verdade as etapas que o login usa (proxy, leitura e
// gravação no banco, criação e encerramento de sessão). `GET /saude` só diz que o processo está de pé;
// esta verificação diz se o sistema consegue ser usado. Alimenta a página de aguardo do frontend.
import { z } from 'zod';
import type { ClienteDeProxy } from '../dados/proxyCliente';
import { PERFIS, type RepositorioDeSessoes } from '../modulos/auth/sessoes';

export const NOMES_DAS_VERIFICACOES = [
  'backend',
  'proxy',
  'banco_leitura',
  'banco_gravacao',
  'sessoes',
] as const;
export type NomeDaVerificacao = (typeof NOMES_DAS_VERIFICACOES)[number];

/** Resultado de uma etapa. `erro` é só um código curto (nunca mensagem, URL ou dado do banco). */
export interface VerificacaoDeSaude {
  readonly nome: NomeDaVerificacao;
  readonly rotulo: string;
  readonly ok: boolean;
  readonly duracaoMs: number;
  readonly erro?: string;
}

/** Corpo de `GET /saude/completa`. `ok` só é verdadeiro quando todas as etapas passam. */
export interface RespostaDeSaudeCompleta {
  readonly ok: boolean;
  readonly verificacoes: readonly VerificacaoDeSaude[];
  readonly verificadoEm: string;
}

export type VerificadorDeSaude = () => Promise<RespostaDeSaudeCompleta>;

/** Quanto se espera o proxy acordar: o plano gratuito do Render leva até cerca de 1 minuto. */
export const TEMPO_LIMITE_DO_PROXY_MS = 60_000;
/** Prazo da gravação de teste, igual ao da gravação do login que conta a senha errada. */
export const TEMPO_LIMITE_DA_GRAVACAO_MS = 25_000;
/** Várias telas aguardando ao mesmo tempo compartilham a mesma verificação por este tempo. */
export const VALIDADE_DA_VERIFICACAO_MS = 3_000;

const ROTULOS: Readonly<Record<NomeDaVerificacao, string>> = {
  backend: 'Servidor (backend)',
  proxy: 'Proxy de dados',
  banco_leitura: 'Banco de dados: leitura',
  banco_gravacao: 'Banco de dados: gravação',
  sessoes: 'Login: criação de sessão',
};

const CODIGO_PROXY_NAO_CONFIGURADO = 'PROXY_NAO_CONFIGURADO';
const CODIGO_PROXY_INDISPONIVEL = 'PROXY_INDISPONIVEL';
const CODIGO_SEM_USUARIOS = 'SEM_USUARIOS';
const CODIGO_SEM_LEITURA = 'SEM_LEITURA';
const CODIGO_ERRO_GENERICO = 'ERRO';

/** Id que nunca existe (os ids começam em 1): a gravação de teste passa pela fila e não altera linha. */
const ID_DE_OPERADOR_INEXISTENTE = 0;

const esquemaDaLeitura = z.object({
  dados: z
    .array(
      z.object({
        idOperador: z.number().int(),
        usuario: z.string(),
        email: z.string(),
        perfil: z.enum(PERFIS),
      }),
    )
    .optional(),
});

type OperadorDeTeste = NonNullable<z.infer<typeof esquemaDaLeitura>['dados']>[number];

export interface DependenciasDoVerificador {
  /** Endereço do proxy; ausente, a etapa do proxy falha com `PROXY_NAO_CONFIGURADO`. */
  readonly proxyUrl?: string;
  readonly proxy: ClienteDeProxy;
  readonly sessoes: RepositorioDeSessoes;
  readonly fetch?: typeof fetch;
  readonly agora?: () => number;
  readonly tempoLimiteDoProxyMs?: number;
  readonly validadeMs?: number;
}

/** Só um código curto: a resposta é pública e não pode revelar mensagem, endereço nem dado. */
function codigoDoErro(erro: unknown): string {
  const codigo = (erro as { codigo?: unknown } | null)?.codigo;
  return typeof codigo === 'string' && /^[A-Z_]{2,40}$/.test(codigo)
    ? codigo
    : CODIGO_ERRO_GENERICO;
}

/**
 * Cria o verificador. As etapas rodam em sequência e cada uma só roda se as anteriores de que depende
 * passaram. Chamadas simultâneas dividem a mesma verificação, e o resultado vale por poucos
 * segundos, para a página de aguardo não sobrecarregar o proxy e o banco.
 */
export function criarVerificadorDeSaude(
  dependencias: DependenciasDoVerificador,
): VerificadorDeSaude {
  const { proxy, sessoes } = dependencias;
  const requisitar = dependencias.fetch ?? fetch;
  const agora = dependencias.agora ?? (() => Date.now());
  const tempoDoProxy = dependencias.tempoLimiteDoProxyMs ?? TEMPO_LIMITE_DO_PROXY_MS;
  const validade = dependencias.validadeMs ?? VALIDADE_DA_VERIFICACAO_MS;

  const resultado = (
    nome: NomeDaVerificacao,
    inicio: number,
    erro?: string,
  ): VerificacaoDeSaude => ({
    nome,
    rotulo: ROTULOS[nome],
    ok: erro === undefined,
    duracaoMs: Math.max(0, agora() - inicio),
    ...(erro !== undefined && { erro }),
  });
  const pulada = (nome: NomeDaVerificacao, erro: string): VerificacaoDeSaude => ({
    nome,
    rotulo: ROTULOS[nome],
    ok: false,
    duracaoMs: 0,
    erro,
  });

  async function verificarProxy(): Promise<VerificacaoDeSaude> {
    const inicio = agora();
    if (dependencias.proxyUrl === undefined) {
      return resultado('proxy', inicio, CODIGO_PROXY_NAO_CONFIGURADO);
    }
    try {
      const resposta = await requisitar(`${dependencias.proxyUrl}/saude`, {
        method: 'GET',
        signal: AbortSignal.timeout(tempoDoProxy),
      });
      await resposta.text();
      return resultado('proxy', inicio, resposta.ok ? undefined : CODIGO_PROXY_INDISPONIVEL);
    } catch (erro) {
      return resultado('proxy', inicio, codigoDoErro(erro));
    }
  }

  async function executar(): Promise<RespostaDeSaudeCompleta> {
    const verificacoes: VerificacaoDeSaude[] = [resultado('backend', agora())];

    const doProxy = await verificarProxy();
    verificacoes.push(doProxy);
    if (!doProxy.ok) {
      for (const nome of ['banco_leitura', 'banco_gravacao', 'sessoes'] as const) {
        verificacoes.push(pulada(nome, CODIGO_PROXY_INDISPONIVEL));
      }
      return concluir(verificacoes);
    }

    // Leitura: pede um operador qualquer, que também serve de dono da sessão de teste.
    let operador: OperadorDeTeste | undefined;
    const inicioDaLeitura = agora();
    try {
      const lida = esquemaDaLeitura.parse(
        await proxy.executar(
          'dados.consultar',
          {
            tabela: 'operador',
            campos: ['id_operador', 'usuario', 'email', 'perfil'],
            limite: 1,
          },
          'saude-completa-leitura',
        ),
      );
      operador = lida.dados?.[0];
      verificacoes.push(resultado('banco_leitura', inicioDaLeitura));
    } catch (erro) {
      verificacoes.push(resultado('banco_leitura', inicioDaLeitura, codigoDoErro(erro)));
    }

    // Gravação: passa pela fila de escrita do proxy, como a que conta a senha errada, sem alterar linha.
    const inicioDaGravacao = agora();
    try {
      await proxy.executar(
        'dados.atualizar',
        {
          tabela: 'operador',
          filtros: { e: [['id_operador', '=', ID_DE_OPERADOR_INEXISTENTE]] },
          valores: { tentativas_login_invalidas: 0 },
        },
        'saude-completa-gravacao',
        { tempoLimiteMs: TEMPO_LIMITE_DA_GRAVACAO_MS },
      );
      verificacoes.push(resultado('banco_gravacao', inicioDaGravacao));
    } catch (erro) {
      verificacoes.push(resultado('banco_gravacao', inicioDaGravacao, codigoDoErro(erro)));
    }

    // Sessão: abre e encerra uma sessão de teste, o mesmo caminho que o login percorre ao entrar.
    const verificacaoDaLeitura = verificacoes.find((v) => v.nome === 'banco_leitura');
    if (!verificacaoDaLeitura?.ok) {
      verificacoes.push(pulada('sessoes', CODIGO_SEM_LEITURA));
    } else if (operador === undefined) {
      verificacoes.push(pulada('sessoes', CODIGO_SEM_USUARIOS));
    } else {
      const inicioDaSessao = agora();
      let token: string | undefined;
      try {
        token = await sessoes.criar({
          idOperador: operador.idOperador,
          usuario: operador.usuario,
          nome: operador.usuario,
          email: operador.email,
          perfil: operador.perfil,
        });
        await sessoes.encerrar(token);
        verificacoes.push(resultado('sessoes', inicioDaSessao));
      } catch (erro) {
        verificacoes.push(resultado('sessoes', inicioDaSessao, codigoDoErro(erro)));
        if (token !== undefined) await sessoes.encerrar(token).catch(() => undefined);
      }
    }
    return concluir(verificacoes);
  }

  function concluir(verificacoes: VerificacaoDeSaude[]): RespostaDeSaudeCompleta {
    return {
      ok: verificacoes.every((v) => v.ok),
      verificacoes,
      verificadoEm: new Date(agora()).toISOString(),
    };
  }

  let emAndamento: Promise<RespostaDeSaudeCompleta> | null = null;
  let ultima: { readonly em: number; readonly resposta: RespostaDeSaudeCompleta } | null = null;

  return () => {
    if (emAndamento) return emAndamento;
    if (ultima && agora() - ultima.em < validade) return Promise.resolve(ultima.resposta);
    emAndamento = executar()
      .then((resposta) => {
        ultima = { em: agora(), resposta };
        return resposta;
      })
      .finally(() => {
        emAndamento = null;
      });
    return emAndamento;
  };
}
