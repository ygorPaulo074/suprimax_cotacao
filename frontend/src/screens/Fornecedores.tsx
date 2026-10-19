import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fornecedoresApi } from '@/api';
import { formatarCnpj } from '@/lib/datas';
import { DataState } from '@/components/DataState';
import {
  Alerta,
  BotaoPrimario,
  Campo,
  Cartao,
  EstadoVazio,
  mensagemDeErro,
  Pagina,
  Secao,
  Tabela,
  Td,
  Th,
} from '@/components/ui';

const vazio = { cnpj: '', razaoSocial: '', nomeContato: '', telefoneContato: '', emailContato: '' };

/** Tela 16 — UC22 – Fornecedores (somente OPERADOR_CHEFE). Cadastro mínimo. */
export default function Fornecedores() {
  const queryClient = useQueryClient();
  const consulta = useQuery({ queryKey: ['fornecedores'], queryFn: fornecedoresApi.listar });
  const [f, setF] = useState(vazio);
  const cnpjValido = f.cnpj.replace(/\D/g, '').length === 14;

  const criar = useMutation({
    mutationFn: () =>
      fornecedoresApi.criar({
        cnpj: f.cnpj.replace(/\D/g, ''),
        razaoSocial: f.razaoSocial.trim(),
        nomeContato: f.nomeContato.trim() || null,
        telefoneContato: f.telefoneContato.trim() || null,
        emailContato: f.emailContato.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fornecedores'] });
      setF(vazio);
    },
  });

  return (
    <Pagina titulo="Fornecedores">
      <Secao titulo="Cadastrar fornecedor">
        <Cartao>
          <form
            className="grid grid-cols-1 gap-3 md:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (cnpjValido && f.razaoSocial.trim()) criar.mutate();
            }}
          >
            <Campo
              rotulo="CNPJ"
              value={f.cnpj}
              onChange={(e) => setF({ ...f, cnpj: e.target.value })}
              erro={f.cnpj && !cnpjValido ? 'Informe os 14 dígitos.' : null}
              required
            />
            <div className="md:col-span-2">
              <Campo
                rotulo="Razão social"
                value={f.razaoSocial}
                onChange={(e) => setF({ ...f, razaoSocial: e.target.value })}
                required
              />
            </div>
            <Campo
              rotulo="Nome do contato"
              opcional
              value={f.nomeContato}
              onChange={(e) => setF({ ...f, nomeContato: e.target.value })}
            />
            <Campo
              rotulo="Telefone"
              opcional
              value={f.telefoneContato}
              onChange={(e) => setF({ ...f, telefoneContato: e.target.value })}
            />
            <Campo
              rotulo="E-mail"
              opcional
              type="email"
              value={f.emailContato}
              onChange={(e) => setF({ ...f, emailContato: e.target.value })}
            />
            <div>
              <BotaoPrimario
                type="submit"
                disabled={!cnpjValido || !f.razaoSocial.trim() || criar.isPending}
              >
                Salvar fornecedor
              </BotaoPrimario>
            </div>
          </form>
          {criar.isError && <Alerta className="mt-3">{mensagemDeErro(criar.error)}</Alerta>}
        </Cartao>
      </Secao>

      <Cartao className="overflow-hidden p-0">
        <DataState
          consulta={consulta}
          vazio={(d) =>
            d.length === 0 ? (
              <EstadoVazio
                icone="🏭"
                titulo="Nenhum fornecedor cadastrado"
                descricao="Cadastre o primeiro fornecedor acima."
              />
            ) : null
          }
        >
          {(itens) => (
            <Tabela>
              <thead>
                <tr>
                  <Th>CNPJ</Th>
                  <Th>Razão social</Th>
                  <Th>Contato</Th>
                  <Th>Telefone</Th>
                  <Th>E-mail</Th>
                </tr>
              </thead>
              <tbody>
                {itens.map((x) => (
                  <tr key={x.idFornecedor}>
                    <Td>{formatarCnpj(x.cnpj)}</Td>
                    <Td className="font-semibold">{x.razaoSocial}</Td>
                    <Td>{x.nomeContato ?? '—'}</Td>
                    <Td>{x.telefoneContato ?? '—'}</Td>
                    <Td>{x.emailContato ?? '—'}</Td>
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
