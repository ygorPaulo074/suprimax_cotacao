import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, clientesApi, usuariosApi, type Perfil, type Usuario } from '@/api';
import { DataState } from '@/components/DataState';
import {
  Alerta,
  Badge,
  BotaoConfirmacao,
  BotaoPrimario,
  BotaoSecundario,
  Campo,
  Cartao,
  EstadoVazio,
  mensagemDeErro,
  Modal,
  Pagina,
  Secao,
  Selecao,
  Tabela,
  Td,
  Th,
} from '@/components/ui';

const PERFIS: Perfil[] = [
  'VENDEDOR',
  'OPERADOR',
  'OPERADOR_CHEFE',
  'FISCAL',
  'FINANCEIRO',
  'GESTOR',
];

function ModalNovoVendedor({ usuario, aoFechar }: { usuario: Usuario; aoFechar: () => void }) {
  const queryClient = useQueryClient();
  const [idNovo, setIdNovo] = useState('');
  const vendedores = useQuery({ queryKey: ['vendedores'], queryFn: clientesApi.vendedores });
  const inativar = useMutation({
    mutationFn: () =>
      usuariosApi.atualizar(usuario.idOperador, {
        status: 'INATIVO',
        idNovoVendedor: Number(idNovo),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      aoFechar();
    },
  });
  return (
    <Modal
      titulo="Novo vendedor responsável"
      aoFechar={aoFechar}
      acoes={
        <>
          <BotaoSecundario onClick={aoFechar}>Voltar</BotaoSecundario>
          <BotaoConfirmacao
            disabled={!idNovo || inativar.isPending}
            onClick={() => inativar.mutate()}
          >
            Inativar e transferir carteira
          </BotaoConfirmacao>
        </>
      }
    >
      <p className="text-sm">
        {usuario.usuario} tem {usuario.clientesNaCarteira} cliente(s) na carteira. Indique o
        vendedor que passa a responder por eles.
      </p>
      <Selecao
        rotulo="Novo vendedor responsável"
        value={idNovo}
        onChange={(e) => setIdNovo(e.target.value)}
      >
        <option value="">Selecione…</option>
        {vendedores.data
          ?.filter((v) => v.idOperador !== usuario.idOperador)
          .map((v) => (
            <option key={v.idOperador} value={v.idOperador}>
              {v.nome}
            </option>
          ))}
      </Selecao>
      {inativar.isError && <Alerta>{mensagemDeErro(inativar.error)}</Alerta>}
    </Modal>
  );
}

/** Tela 17 — UC25 – Usuários (somente OPERADOR_CHEFE). */
export default function Usuarios() {
  const queryClient = useQueryClient();
  const consulta = useQuery({ queryKey: ['usuarios'], queryFn: usuariosApi.listar });
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [perfil, setPerfil] = useState<Perfil>('OPERADOR');
  const [transferindo, setTransferindo] = useState<Usuario | null>(null);

  const criar = useMutation({
    mutationFn: () => usuariosApi.criar({ usuario: nome.trim(), email: email.trim(), perfil }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      setNome('');
      setEmail('');
    },
  });
  const atualizar = useMutation({
    mutationFn: (v: { usuario: Usuario; status?: 'ATIVO' | 'INATIVO'; perfil?: Perfil }) =>
      usuariosApi.atualizar(v.usuario.idOperador, { status: v.status, perfil: v.perfil }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['usuarios'] }),
    onError: (erro, v) => {
      // NOVO_VENDEDOR_OBRIGATORIO: pede o vendedor que assume a carteira.
      if (erro instanceof ApiError && erro.codigo === 'NOVO_VENDEDOR_OBRIGATORIO')
        setTransferindo(v.usuario);
    },
  });

  return (
    <Pagina titulo="Usuários">
      <Secao titulo="Novo usuário">
        <Cartao>
          <form
            className="grid grid-cols-1 items-end gap-3 md:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              criar.mutate();
            }}
          >
            <Campo
              rotulo="Usuário"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
            />
            <Campo
              rotulo="E-mail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Selecao
              rotulo="Perfil"
              value={perfil}
              onChange={(e) => setPerfil(e.target.value as Perfil)}
            >
              {PERFIS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Selecao>
            <BotaoPrimario
              type="submit"
              disabled={!nome.trim() || !email.trim() || criar.isPending}
            >
              Cadastrar
            </BotaoPrimario>
          </form>
          {criar.isError && <Alerta className="mt-3">{mensagemDeErro(criar.error)}</Alerta>}
        </Cartao>
      </Secao>

      {atualizar.isError && !transferindo && (
        <Alerta className="mb-3">{mensagemDeErro(atualizar.error)}</Alerta>
      )}
      <Cartao className="overflow-hidden p-0">
        <DataState
          consulta={consulta}
          vazio={(d) =>
            d.length === 0 ? <EstadoVazio icone="👥" titulo="Nenhum usuário cadastrado" /> : null
          }
        >
          {(itens) => (
            <Tabela>
              <thead>
                <tr>
                  <Th>Usuário</Th>
                  <Th>E-mail</Th>
                  <Th>Perfil</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {itens.map((u) => (
                  <tr key={u.idOperador}>
                    <Td className="font-semibold">{u.usuario}</Td>
                    <Td>{u.email}</Td>
                    <Td>
                      <Badge status={u.perfil} />
                    </Td>
                    <Td>
                      <Badge status={u.status} />
                    </Td>
                    <Td>
                      <BotaoSecundario
                        disabled={atualizar.isPending}
                        onClick={() => {
                          const inativando = u.status === 'ATIVO';
                          if (inativando && u.perfil === 'VENDEDOR' && u.clientesNaCarteira > 0)
                            setTransferindo(u);
                          else
                            atualizar.mutate({
                              usuario: u,
                              status: inativando ? 'INATIVO' : 'ATIVO',
                            });
                        }}
                      >
                        {u.status === 'ATIVO' ? 'Inativar' : 'Reativar'}
                      </BotaoSecundario>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          )}
        </DataState>
      </Cartao>
      {transferindo && (
        <ModalNovoVendedor usuario={transferindo} aoFechar={() => setTransferindo(null)} />
      )}
    </Pagina>
  );
}
