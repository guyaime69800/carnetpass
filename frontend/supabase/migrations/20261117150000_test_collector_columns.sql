-- Base de TEST (Preview) uniquement : aligne platform_document_intake sur la
-- production Paris 2 (colonnes du collecteur, définitions relues en lecture
-- seule le 17/11/2026). Ajout pur, colonnes facultatives, aucune donnée modifiée.
-- Appliquée le 17/11/2026 au projet de test bqqzzbwqmiyxcotvqtoc.
alter table public.platform_document_intake
  add column if not exists collector_metadata jsonb,
  add column if not exists brand_hotlines jsonb,
  add column if not exists collector_ingestion_key text;
create unique index if not exists platform_document_collector_ingestion_uidx
  on public.platform_document_intake using btree (collector_ingestion_key);
