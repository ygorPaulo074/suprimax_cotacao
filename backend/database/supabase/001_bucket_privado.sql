-- Execute somente no Supabase depois que o Storage estiver habilitado.
-- O bucket é privado e não recebe políticas públicas; o serviço autorizado usa a service role.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION 'Supabase Storage não está habilitado neste projeto';
  END IF;
END $$;

INSERT INTO storage.buckets (id,name,public)
VALUES ('documentos-credito','documentos-credito',FALSE)
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,public=FALSE;
