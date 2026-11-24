create extension if not exists pgcrypto;

create table if not exists public.parties (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null check (char_length(name) between 1 and 100),
  join_password_hash text not null,
  organizer_password_hash text not null,
  voting_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.participants (
  id uuid primary key references auth.users(id) on delete cascade,
  party_id uuid not null references public.parties(id) on delete cascade,
  joined_at timestamptz not null default now()
);

create table if not exists public.clips (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  youtube_id text not null check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  position integer not null check (position > 0),
  created_at timestamptz not null default now(),
  unique (party_id, position)
);

create table if not exists public.ratings (
  clip_id uuid not null references public.clips(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  funny smallint not null check (funny between 1 and 5),
  creative smallint not null check (creative between 1 and 5),
  christmas smallint not null check (christmas between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (clip_id, participant_id)
);

alter table public.parties enable row level security;
alter table public.participants enable row level security;
alter table public.clips enable row level security;
alter table public.ratings enable row level security;

revoke all on public.parties from anon, authenticated;
revoke all on public.participants from anon, authenticated;
revoke all on public.clips from anon, authenticated;
revoke all on public.ratings from anon, authenticated;

create or replace function public.initialize_party(
  p_slug text,
  p_name text,
  p_party_password text,
  p_organizer_password text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_party_id uuid;
begin
  if char_length(p_party_password) < 4 then
    raise exception 'Party password must contain at least 4 characters';
  end if;
  if char_length(p_organizer_password) < 8 then
    raise exception 'Organizer password must contain at least 8 characters';
  end if;

  insert into public.parties (slug, name, join_password_hash, organizer_password_hash)
  values (
    lower(trim(p_slug)),
    trim(p_name),
    crypt(p_party_password, gen_salt('bf')),
    crypt(p_organizer_password, gen_salt('bf'))
  )
  on conflict (slug) do update
  set name = excluded.name,
      join_password_hash = excluded.join_password_hash,
      organizer_password_hash = excluded.organizer_password_hash,
      updated_at = now()
  returning id into v_party_id;

  return v_party_id;
end;
$$;

create or replace function public.private_party_state(p_party_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'party', jsonb_build_object(
      'id', p.id,
      'slug', p.slug,
      'name', p.name,
      'votingOpen', p.voting_open
    ),
    'clips', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'title', c.title,
          'youtubeId', c.youtube_id,
          'position', c.position,
          'voteCount', coalesce(c.vote_count, 0),
          'score', c.score,
          'myRating', c.my_rating
        )
        order by c.position
      )
      from (
        select
          clip.id,
          clip.title,
          clip.youtube_id,
          clip.position,
          count(rating.participant_id)::integer as vote_count,
          case
            when count(rating.participant_id) = 0 then null
            else round(avg((rating.funny + rating.creative + rating.christmas) / 3.0)::numeric, 2)
          end as score,
          (
            select jsonb_build_object(
              'funny', mine.funny,
              'creative', mine.creative,
              'christmas', mine.christmas
            )
            from public.ratings mine
            where mine.clip_id = clip.id
              and mine.participant_id = auth.uid()
          ) as my_rating
        from public.clips clip
        left join public.ratings rating on rating.clip_id = clip.id
        where clip.party_id = p_party_id
        group by clip.id
      ) c
    ), '[]'::jsonb)
  )
  into v_result
  from public.parties p
  where p.id = p_party_id;

  return v_result;
end;
$$;

create or replace function public.join_party(p_slug text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_party public.parties%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Please reload and try joining again';
  end if;

  select * into v_party
  from public.parties
  where slug = lower(trim(p_slug));

  if v_party.id is null or crypt(p_password, v_party.join_password_hash) <> v_party.join_password_hash then
    raise exception 'Incorrect party password';
  end if;

  insert into public.participants (id, party_id)
  values (auth.uid(), v_party.id)
  on conflict (id) do update
  set party_id = excluded.party_id,
      joined_at = now();

  return public.private_party_state(v_party.id);
end;
$$;

create or replace function public.get_party_state(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party_id uuid;
begin
  select participant.party_id into v_party_id
  from public.participants participant
  join public.parties party on party.id = participant.party_id
  where participant.id = auth.uid()
    and party.slug = lower(trim(p_slug));

  if v_party_id is null then
    raise exception 'Join the party before viewing clips';
  end if;

  return public.private_party_state(v_party_id);
end;
$$;

create or replace function public.rate_clip(
  p_clip_id uuid,
  p_funny smallint,
  p_creative smallint,
  p_christmas smallint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party_id uuid;
begin
  if p_funny not between 1 and 5
     or p_creative not between 1 and 5
     or p_christmas not between 1 and 5 then
    raise exception 'Every category must have a rating from 1 to 5';
  end if;

  select clip.party_id into v_party_id
  from public.clips clip
  join public.participants participant on participant.party_id = clip.party_id
  join public.parties party on party.id = clip.party_id
  where clip.id = p_clip_id
    and participant.id = auth.uid()
    and party.voting_open;

  if v_party_id is null then
    raise exception 'This clip cannot be rated because voting is closed or you have not joined its party';
  end if;

  insert into public.ratings (clip_id, participant_id, funny, creative, christmas, updated_at)
  values (p_clip_id, auth.uid(), p_funny, p_creative, p_christmas, now())
  on conflict (clip_id, participant_id) do update
  set funny = excluded.funny,
      creative = excluded.creative,
      christmas = excluded.christmas,
      updated_at = now();

  return public.private_party_state(v_party_id);
end;
$$;

create or replace function public.admin_manage_party(
  p_slug text,
  p_secret text,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_party public.parties%rowtype;
  v_clip_id uuid;
begin
  select * into v_party
  from public.parties
  where slug = lower(trim(p_slug));

  if v_party.id is null or crypt(p_secret, v_party.organizer_password_hash) <> v_party.organizer_password_hash then
    raise exception 'Incorrect organizer password';
  end if;

  case p_action
    when 'get_state' then
      null;
    when 'toggle_voting' then
      update public.parties
      set voting_open = not voting_open, updated_at = now()
      where id = v_party.id;
    when 'save_clip' then
      v_clip_id := nullif(p_payload ->> 'id', '')::uuid;
      if coalesce(trim(p_payload ->> 'title'), '') = '' then
        raise exception 'Clip title is required';
      end if;
      if coalesce(p_payload ->> 'youtubeId', '') !~ '^[A-Za-z0-9_-]{11}$' then
        raise exception 'Invalid YouTube video ID';
      end if;

      if v_clip_id is not null then
        update public.clips
        set title = trim(p_payload ->> 'title'),
            youtube_id = p_payload ->> 'youtubeId',
            position = coalesce((p_payload ->> 'position')::integer, position)
        where id = v_clip_id and party_id = v_party.id;
      else
        insert into public.clips (party_id, title, youtube_id, position)
        select
          v_party.id,
          trim(p_payload ->> 'title'),
          p_payload ->> 'youtubeId',
          coalesce(max(position), 0) + 1
        from public.clips
        where party_id = v_party.id;
      end if;
    when 'delete_clip' then
      delete from public.clips
      where id = nullif(p_payload ->> 'id', '')::uuid
        and party_id = v_party.id;
    else
      raise exception 'Unknown organizer action';
  end case;

  return public.private_party_state(v_party.id);
end;
$$;

revoke all on function public.initialize_party(text, text, text, text) from public, anon, authenticated;
revoke all on function public.private_party_state(uuid) from public, anon, authenticated;
grant execute on function public.join_party(text, text) to anon, authenticated;
grant execute on function public.get_party_state(text) to anon, authenticated;
grant execute on function public.rate_clip(uuid, smallint, smallint, smallint) to anon, authenticated;
grant execute on function public.admin_manage_party(text, text, text, jsonb) to anon, authenticated;
