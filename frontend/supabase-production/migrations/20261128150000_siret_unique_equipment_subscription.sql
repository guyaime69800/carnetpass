-- Audit du 28/11/2026 : deux écarts de logique dans les fonctions accessibles
-- aux comptes connectés.
-- 1. Un SIRET ne peut appartenir qu'à une seule entreprise (l'inscription le
--    refusait déjà, la modification dans les paramètres ne le contrôlait pas).
-- 2. Ajouter un équipement « Pro » exige un abonnement payant actif (une
--    entreprise résiliée gardait la possibilité par appel direct). Les
--    entreprises de démonstration gardent leur règle ; Découverte passe par
--    create_discovery_equipment, inchangée. Les carnets existants restent
--    consultables.
begin;

create unique index companies_siret_unique on public.companies (siret) where siret is not null;

create or replace function public.update_company_siret(p_company_id uuid, p_siret text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_siret text;
begin
  if v_user_id is null
     or auth.role() is distinct from 'authenticated' then
    raise exception 'Connexion requise.'
      using errcode = '42501';
  end if;

  -- Accepte les espaces de présentation, mais pas les lettres.
  if p_siret is null or length(p_siret) > 64 then
    raise exception 'Le SIRET doit contenir exactement 14 chiffres.'
      using errcode = '22023';
  end if;

  v_siret := regexp_replace(p_siret, '[[:space:]]', '', 'g');

  if v_siret !~ '^[0-9]{14}$' then
    raise exception 'Le SIRET doit contenir exactement 14 chiffres.'
      using errcode = '22023';
  end if;

  -- Vérifie le rôle et empêche sa modification pendant l’opération.
  perform 1
  from public.company_members as m
  where m.company_id = p_company_id
    and m.user_id = v_user_id
    and m.role::text in ('owner', 'admin')
  for share;

  if not found then
    raise exception 'Modification du SIRET non autorisée.'
      using errcode = '42501';
  end if;

  if exists (select 1 from public.companies where siret = v_siret and id <> p_company_id) then
    raise exception 'Ce SIRET est déjà rattaché à une entreprise. Contactez CarnetPass.'
      using errcode = '23505';
  end if;

  update public.companies
  set
    siret = v_siret,
    updated_at = now()
  where id = p_company_id;

  if not found then
    raise exception 'Entreprise introuvable.';
  end if;
exception
  when unique_violation then
    raise exception 'Ce SIRET est déjà rattaché à une entreprise. Contactez CarnetPass.'
      using errcode = '23505';
end;
$function$;

create or replace function public.create_company_equipment(p_company_id uuid, p_equipment_type text, p_brand text, p_model text, p_product_reference text, p_serial_number text)
returns public.equipments
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_equipment public.equipments;
begin
  if v_user_id is null
     or auth.role() is distinct from 'authenticated' then
    raise exception 'Connexion requise.'
      using errcode = '42501';
  end if;

  if p_equipment_type is null
     or p_equipment_type not in (
       'boiler',
       'heat_pump',
       'air_conditioning',
       'vmc',
       'rooftop',
       'other'
     ) then
    raise exception 'Le type d''équipement est invalide.'
      using errcode = '22023';
  end if;

  if nullif(btrim(p_brand), '') is null
     or char_length(btrim(p_brand)) > 100 then
    raise exception 'La marque est obligatoire.'
      using errcode = '22023';
  end if;

  if nullif(btrim(p_model), '') is null
     or char_length(btrim(p_model)) > 150 then
    raise exception 'Le modèle est obligatoire.'
      using errcode = '22023';
  end if;

  if p_serial_number is not null
     and char_length(btrim(p_serial_number)) > 150 then
    raise exception 'Le numéro de série est trop long.'
      using errcode = '22023';
  end if;

  if p_product_reference is not null
     and char_length(btrim(p_product_reference)) > 100 then
    raise exception 'La référence produit est trop longue.'
      using errcode = '22023';
  end if;

  -- L’utilisateur doit appartenir à l’entreprise.
  if not exists (
    select 1
    from public.company_members as m
    where m.company_id = p_company_id
      and m.user_id = v_user_id
  ) then
    raise exception 'Ajout d''équipement non autorisé.'
      using errcode = '42501';
  end if;

  -- Autorisation :
  -- 1. entreprise réellement validée avec un abonnement payant actif ;
  -- 2. ou entreprise de démonstration non suspendue.
  if not exists (
    select 1
    from public.companies as c
    left join public.company_verifications as v
      on v.company_id = c.id
    where c.id = p_company_id
      and (
        (
          c.is_demo is true
          and coalesce(v.status, 'pending') <> 'suspended'
        )
        or
        (
          c.siret ~ '^[0-9]{14}$'
          and v.status = 'approved'
          and v.verified_siret = c.siret
          and v.verified_at is not null
          and exists (
            select 1 from public.subscriptions as s
            where s.company_id = c.id
              and s.plan::text <> 'free'
              and s.status::text in ('active', 'trialing')
              and (s.plan::text <> 'enterprise' or s.current_period_end > now())
          )
        )
      )
  ) then
    raise exception 'Un abonnement actif et une entreprise validée sont nécessaires pour ajouter un équipement.'
      using errcode = '42501';
  end if;

  insert into public.equipments (
    company_id,
    equipment_type,
    brand,
    model,
    product_reference,
    serial_number,
    created_by
  )
  values (
    p_company_id,
    p_equipment_type,
    btrim(p_brand),
    btrim(p_model),
    nullif(btrim(p_product_reference), ''),
    nullif(btrim(p_serial_number), ''),
    v_user_id
  )
  returning * into v_equipment;

  return v_equipment;

exception
  when unique_violation then
    raise exception 'Ce numéro de série existe déjà dans votre entreprise.'
      using errcode = '23505';
end;
$function$;

commit;
