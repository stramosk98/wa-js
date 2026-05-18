create table contacts (
  id bigserial primary key,
  chat_id text not null,
  phone text,
  lid text,
  display_name text,
  is_blocked boolean not null default false,
  opted_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index contacts_chat_id_uidx on contacts (chat_id);
create unique index contacts_phone_uidx on contacts (phone) where phone is not null;
create unique index contacts_lid_uidx on contacts (lid) where lid is not null;
create index contacts_opted_out_at_idx on contacts (opted_out_at) where opted_out_at is not null;

create table conversations (
  id bigserial primary key,
  contact_id bigint not null references contacts (id),
  chat_id text not null,
  status smallint not null default 0,
  selected_menu_option text,
  handoff_reason text,
  assigned_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_customer_message_at timestamptz,
  last_bot_message_at timestamptz,
  resolved_at timestamptz,
  expires_at timestamptz,
  constraint conversations_status_chk check (status in (0, 1, 2))
);

create unique index conversations_contact_id_uidx on conversations (contact_id);
create index conversations_chat_id_idx on conversations (chat_id);
create index conversations_status_idx on conversations (status);

create table messages (
  id bigserial primary key,
  conversation_id bigint not null references conversations (id),
  contact_id bigint not null references contacts (id),
  chat_id text not null,
  wa_message_id text,
  direction text not null,
  sender_type text not null,
  message_type text not null default 'chat',
  body text not null default '',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint messages_direction_chk check (direction in ('inbound', 'outbound')),
  constraint messages_sender_type_chk check (sender_type in ('customer', 'bot', 'agent', 'system'))
);

create unique index messages_wa_message_id_uidx
  on messages (wa_message_id)
  where wa_message_id is not null;
create index messages_conversation_created_idx on messages (conversation_id, created_at);
create index messages_contact_created_idx on messages (contact_id, created_at);
create index messages_chat_created_idx on messages (chat_id, created_at);

create table conversation_transitions (
  id bigserial primary key,
  conversation_id bigint not null references conversations (id),
  from_status smallint,
  to_status smallint not null,
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint conversation_transitions_from_status_chk check (from_status is null or from_status in (0, 1, 2)),
  constraint conversation_transitions_to_status_chk check (to_status in (0, 1, 2))
);

create index conversation_transitions_conversation_created_idx
  on conversation_transitions (conversation_id, created_at);

create table llm_calls (
  id bigserial primary key,
  conversation_id bigint not null references conversations (id),
  message_id bigint references messages (id),
  provider text not null default 'openai',
  model text not null,
  status text not null,
  prompt_summary text,
  response_text text,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  error_message text,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  estimated_cost numeric(12, 6),
  latency_ms integer,
  created_at timestamptz not null default now(),
  constraint llm_calls_status_chk check (status in ('started', 'succeeded', 'failed'))
);

create index llm_calls_conversation_created_idx on llm_calls (conversation_id, created_at);
create index llm_calls_message_id_idx on llm_calls (message_id) where message_id is not null;
create index llm_calls_status_idx on llm_calls (status);

create table tool_calls (
  id bigserial primary key,
  conversation_id bigint not null references conversations (id),
  llm_call_id bigint references llm_calls (id),
  tool_name text not null,
  status text not null,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  error_message text,
  latency_ms integer,
  created_at timestamptz not null default now(),
  constraint tool_calls_status_chk check (status in ('started', 'succeeded', 'failed'))
);

create index tool_calls_conversation_created_idx on tool_calls (conversation_id, created_at);
create index tool_calls_llm_call_id_idx on tool_calls (llm_call_id) where llm_call_id is not null;
create index tool_calls_tool_name_idx on tool_calls (tool_name);

create table human_agents (
  id bigserial primary key,
  name text not null,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index human_agents_email_uidx on human_agents (lower(email)) where email is not null;
create index human_agents_active_idx on human_agents (active);
