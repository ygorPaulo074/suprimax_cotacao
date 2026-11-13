-- Pré-requisito: habilitar a extensão pg_cron no Supabase Dashboard.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    RAISE EXCEPTION 'Habilite a extensão pg_cron antes de agendar os jobs SupriMax';
  END IF;
END $$;

SELECT cron.schedule('suprimax-expirar-orcamentos','*/15 * * * *','SELECT public.proxy_job_expirar_orcamentos()');
SELECT cron.schedule('suprimax-expirar-reservas','*/15 * * * *','SELECT public.proxy_job_expirar_reservas()');
SELECT cron.schedule('suprimax-expirar-rascunhos','10 4 * * *','SELECT public.proxy_job_expirar_rascunhos()');
SELECT cron.schedule('suprimax-protestar-dividas','20 4 * * *','SELECT public.proxy_job_protestar_dividas()');
SELECT cron.schedule('suprimax-expirar-tokens','*/15 * * * *','SELECT public.proxy_job_expirar_tokens_recuperacao()');
