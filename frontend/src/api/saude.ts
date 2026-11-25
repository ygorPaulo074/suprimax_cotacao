import { api } from './client';
import type { RespostaDeSaudeCompleta } from './types';

export const saudeApi = {
  /**
   * Confere de verdade proxy, leitura e gravação no banco e a criação de sessão. Pública, sem login.
   * Responde sempre 200: quem decide se o sistema abre é `ok`. Pode demorar se o plano gratuito
   * estiver acordando os serviços.
   */
  completa: (signal?: AbortSignal) =>
    api.get<RespostaDeSaudeCompleta>('/saude/completa', { signal }),
};
