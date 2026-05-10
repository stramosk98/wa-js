# WA-JS Chatbot MVP

Local chatbot runner for WhatsApp Web using WA-JS as the browser bridge and
OpenAI from Node.

## Run

```bash
OPENAI_API_KEY="your-key" npm run chatbot
```

Useful optional environment variables:

- `OPENAI_MODEL`: defaults to `gpt-4.1-mini`.
- `CHATBOT_ALLOWED_CHATS`: comma-separated chat ids, for example `554791688946@c.us`.
- `CHATBOT_DEBOUNCE_MS`: defaults to `1500`.
- `CHATBOT_HUMAN_KEYWORDS`: comma-separated words that transfer to human,
  defaults to `atendente,humano,reclamacao,reclamação,cancelamento`.
- `CHATBOT_IGNORE_GROUPS`: defaults to `true`.
- `CHATBOT_MENU_ENABLED`: defaults to `true`.
- `CHATBOT_OPTOUT_KEYWORDS`: comma-separated opt-out words, defaults to
  `parar,sair`.
- `CHATBOT_SESSION_TTL_MS`: defaults to 24 hours.
- `STOCK_API_URL`: optional product/stock search endpoint. The runner calls it
  with `?q=<customer message>` when the message looks product-related.

The first run opens WhatsApp Web with a persistent browser profile. Scan the QR
code if needed, then send a text message from an allowed contact or leave
`CHATBOT_ALLOWED_CHATS` empty to respond to all one-to-one text chats.

The chatbot keeps an in-memory state per `chatId`. A new contact receives a
menu first, support choices move the conversation to LLM support, and human
handoff states silence the bot until a future resolver marks the conversation as
resolved.
