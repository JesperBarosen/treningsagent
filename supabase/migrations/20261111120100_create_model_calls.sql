-- One row per Claude API call, for cost and latency per conversation.
-- input_tokens excludes cached tokens; the two cache columns are billed at
-- different rates, so all four are needed to compute cost.
create table public.model_calls (
    id                          bigint generated always as identity primary key,
    -- TODO: references auth.users (id) once real login exists.
    user_id                     uuid        not null default auth.uid(),
    conversation_id             uuid        not null,
    model                       text        not null,
    input_tokens                integer     not null,
    output_tokens               integer     not null,
    cache_creation_input_tokens integer     not null default 0,
    cache_read_input_tokens     integer     not null default 0,
    latency_ms                  integer     not null,
    stop_reason                 text,
    created_at                  timestamptz not null default now()
);

create index model_calls_user_id_conversation_id_idx
    on public.model_calls (user_id, conversation_id);

alter table public.model_calls enable row level security;

create policy "Users can read their own model calls"
    on public.model_calls for select to authenticated
    using (user_id = (select auth.uid()));

create policy "Users can insert their own model calls"
    on public.model_calls for insert to authenticated
    with check (user_id = (select auth.uid()));

grant select, insert on public.model_calls to authenticated;
