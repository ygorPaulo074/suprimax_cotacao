import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { BotaoPrimario, EstadoVazio } from '@/components/ui';

/** Vendedor e Gestor não têm menu no Sistema 2: atuam nos Sistemas 1 e 3 (docs/10, seção 10.2). */
export default function SemAcesso() {
  const { sair } = useAuth();
  const navegar = useNavigate();
  return (
    <div className="flex min-h-screen items-center justify-center bg-off-white">
      <EstadoVazio
        icone="🔒"
        titulo="Seu perfil não utiliza o Sistema de Cotação"
        descricao="O vendedor atua no aplicativo mobile (Sistema 1) e o gestor, no Painel Gerencial (Sistema 3)."
        acao={
          <BotaoPrimario onClick={() => void sair().then(() => navegar('/login'))}>
            Sair
          </BotaoPrimario>
        }
      />
    </div>
  );
}
