-- TripLog v0.16 compatible-v3：同行旅伴邀請及安全共享
-- 在 Supabase SQL Editor 完整執行一次。

-- 沿用初始資料庫已有的 trip_members：
-- id, trip_id, display_name, email, linked_user_id, created_at
create unique index if not exists trip_members_trip_email_idx
  on public.trip_members (trip_id, lower(email));

create table if not exists public.triplog_invitations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  email text not null,
  role text not null default 'editor' check (role in ('editor')),
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

create unique index if not exists triplog_invitations_trip_email_idx
  on public.triplog_invitations (trip_id, lower(email));

alter table public.trip_members enable row level security;
alter table public.triplog_invitations enable row level security;
revoke all on public.trip_members from anon, authenticated;
revoke all on public.triplog_invitations from anon, authenticated;

create or replace function public.triplog_list_accessible_trips()
returns table (
  id uuid,
  name text,
  destination_city text,
  start_date date,
  end_date date,
  status text,
  notes text,
  created_at timestamptz,
  deleted_at timestamptz,
  access_role text
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    t.id,
    t.name,
    t.destination_city,
    t.start_date,
    t.end_date,
    t.status,
    case
      when t.owner_id = auth.uid() then t.notes
      else jsonb_build_object(
        'triplog',
        (coalesce(t.notes::jsonb -> 'triplog', '{}'::jsonb)
          - 'documents' - 'hotelDetails')
      )::text
    end as notes,
    t.created_at,
    t.deleted_at,
    case when t.owner_id = auth.uid() then 'owner' else 'editor' end as access_role
  from public.trips t
  where t.owner_id = auth.uid()
     or exists (
       select 1 from public.trip_members m
       where m.trip_id = t.id and m.linked_user_id = auth.uid()
     )
  order by t.created_at desc;
$$;

create or replace function public.triplog_update_shared_trip(
  p_trip_id uuid,
  p_budget numeric,
  p_itinerary jsonb,
  p_requirements jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_notes jsonb;
begin
  if not exists (
    select 1 from public.trips t
    where t.id = p_trip_id
      and (
        t.owner_id = auth.uid()
        or exists (
          select 1 from public.trip_members m
          where m.trip_id = t.id and m.linked_user_id = auth.uid()
        )
      )
  ) then
    raise exception 'You do not have access to this trip';
  end if;

  select coalesce(notes::jsonb, '{}'::jsonb) into v_notes
  from public.trips where id = p_trip_id;
  v_notes := jsonb_set(v_notes, '{triplog,budget}', to_jsonb(greatest(coalesce(p_budget, 0), 0)), true);
  v_notes := jsonb_set(v_notes, '{triplog,itinerary}', coalesce(p_itinerary, '[]'::jsonb), true);
  v_notes := jsonb_set(v_notes, '{triplog,requirements}', coalesce(p_requirements, '[]'::jsonb), true);
  update public.trips set notes = v_notes::text where id = p_trip_id;
end;
$$;

create or replace function public.triplog_create_invitation(
  p_trip_id uuid,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(p_email));
  v_token uuid;
begin
  if v_email = '' or position('@' in v_email) < 2 then
    raise exception 'Invalid email address';
  end if;
  if not exists (
    select 1 from public.trips where id = p_trip_id and owner_id = auth.uid()
  ) then
    raise exception 'Only the trip owner can invite companions';
  end if;
  if v_email = lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'You are already the trip owner';
  end if;

  delete from public.triplog_invitations
  where trip_id = p_trip_id and lower(email) = v_email;

  insert into public.triplog_invitations (trip_id, email, invited_by)
  values (p_trip_id, v_email, auth.uid())
  returning id into v_token;
  return v_token;
end;
$$;

create or replace function public.triplog_accept_invitation(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite public.triplog_invitations%rowtype;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or v_email = '' then
    raise exception 'Please sign in before accepting the invitation';
  end if;
  select * into v_invite
  from public.triplog_invitations
  where id = p_token and expires_at > now();
  if not found then
    raise exception 'Invitation is invalid or expired';
  end if;
  if lower(v_invite.email) <> v_email then
    raise exception 'Please sign in with the invited email address';
  end if;

  if exists (
    select 1 from public.trip_members
    where trip_id = v_invite.trip_id and lower(email) = v_email
  ) then
    update public.trip_members
    set linked_user_id = auth.uid()
    where trip_id = v_invite.trip_id and lower(email) = v_email;
  else
    insert into public.trip_members (id, trip_id, display_name, email, linked_user_id, created_at)
    values (gen_random_uuid(), v_invite.trip_id, split_part(v_email, '@', 1), v_email, auth.uid(), now());
  end if;
  delete from public.triplog_invitations where id = p_token;
  return v_invite.trip_id;
end;
$$;

create or replace function public.triplog_list_collaborators(p_trip_id uuid)
returns table (email text, status text, joined_at timestamptz)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select m.email, 'active'::text, m.created_at
  from public.trip_members m
  where m.trip_id = p_trip_id
    and exists (select 1 from public.trips t where t.id = p_trip_id and t.owner_id = auth.uid())
  union all
  select i.email, 'pending'::text, i.created_at
  from public.triplog_invitations i
  where i.trip_id = p_trip_id
    and i.expires_at > now()
    and exists (select 1 from public.trips t where t.id = p_trip_id and t.owner_id = auth.uid())
  order by 3;
$$;

create or replace function public.triplog_revoke_collaborator(
  p_trip_id uuid,
  p_email text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.trips where id = p_trip_id and owner_id = auth.uid()) then
    raise exception 'Only the trip owner can remove companions';
  end if;
  delete from public.trip_members where trip_id = p_trip_id and lower(email) = lower(trim(p_email));
  delete from public.triplog_invitations where trip_id = p_trip_id and lower(email) = lower(trim(p_email));
end;
$$;

revoke all on function public.triplog_list_accessible_trips() from public;
revoke all on function public.triplog_update_shared_trip(uuid, numeric, jsonb, jsonb) from public;
revoke all on function public.triplog_create_invitation(uuid, text) from public;
revoke all on function public.triplog_accept_invitation(uuid) from public;
revoke all on function public.triplog_list_collaborators(uuid) from public;
revoke all on function public.triplog_revoke_collaborator(uuid, text) from public;

grant execute on function public.triplog_list_accessible_trips() to authenticated;
grant execute on function public.triplog_update_shared_trip(uuid, numeric, jsonb, jsonb) to authenticated;
grant execute on function public.triplog_create_invitation(uuid, text) to authenticated;
grant execute on function public.triplog_accept_invitation(uuid) to authenticated;
grant execute on function public.triplog_list_collaborators(uuid) to authenticated;
grant execute on function public.triplog_revoke_collaborator(uuid, text) to authenticated;
