alter table conversation_messages rename to messages;
alter index conversation_messages_wa_message_id_uidx rename to messages_wa_message_id_uidx;
alter index conversation_messages_conversation_created_idx rename to messages_conversation_created_idx;
alter index conversation_messages_contact_created_idx rename to messages_contact_created_idx;
alter index conversation_messages_chat_created_idx rename to messages_chat_created_idx;
alter table messages rename constraint conversation_messages_direction_chk to messages_direction_chk;
alter table messages rename constraint conversation_messages_sender_type_chk to messages_sender_type_chk;

alter table llm_calls drop constraint llm_calls_message_id_fkey;
alter table llm_calls
  add constraint llm_calls_message_id_fkey foreign key (message_id) references messages (id);

drop index conversations_one_active_per_contact_uidx;
drop index conversations_status_idx;
drop index conversations_expires_at_idx;
alter table conversations drop constraint conversations_status_chk;

alter table conversation_transitions drop constraint conversation_transitions_from_status_chk;
alter table conversation_transitions drop constraint conversation_transitions_to_status_chk;

alter table conversations
  alter column status drop default,
  alter column status type smallint using case
    when status in ('new', 'waiting_menu_choice', 'llm_support') then 0
    when status in ('waiting_human', 'human_in_progress') then 1
    when status in ('resolved', 'opted_out') then 2
    else 0
  end,
  alter column status set default 0;

alter table conversation_transitions
  alter column from_status type smallint using case
    when from_status is null then null
    when from_status in ('new', 'waiting_menu_choice', 'llm_support') then 0
    when from_status in ('waiting_human', 'human_in_progress') then 1
    when from_status in ('resolved', 'opted_out') then 2
    else 0
  end,
  alter column to_status type smallint using case
    when to_status in ('new', 'waiting_menu_choice', 'llm_support') then 0
    when to_status in ('waiting_human', 'human_in_progress') then 1
    when to_status in ('resolved', 'opted_out') then 2
    else 0
  end;

alter table conversations
  add constraint conversations_status_chk check (status in (0, 1, 2));

alter table conversation_transitions
  add constraint conversation_transitions_from_status_chk check (from_status is null or from_status in (0, 1, 2)),
  add constraint conversation_transitions_to_status_chk check (to_status in (0, 1, 2));

create unique index conversations_contact_id_uidx on conversations (contact_id);
create index conversations_status_idx on conversations (status);
