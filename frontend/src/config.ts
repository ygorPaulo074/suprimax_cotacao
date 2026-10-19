// Único ponto que lê variáveis de ambiente do Vite (import.meta só existe no bundle).
export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
