# WA-JS Chatbot MVP

Local chatbot runner for WhatsApp Web using WA-JS as the browser bridge and
OpenAI from Node.

## Run

```bash
docker compose up -d
npm run chatbot:sync-inventory
OPENAI_API_KEY="your-key" npm run chatbot
```

Useful optional environment variables:

- `OPENAI_MODEL`: defaults to `gpt-4.1-mini`.
- `CHATBOT_ALLOWED_CHATS`: comma-separated chat ids, for example `23194213421321@lid`.
- `CHATBOT_DEBOUNCE_MS`: defaults to `1500`.
- `CHATBOT_HUMAN_KEYWORDS`: comma-separated words that transfer to human,
  defaults to `atendente,humano,reclamacao,reclamação,cancelamento`.
- `CHATBOT_IGNORE_GROUPS`: defaults to `true`.
- `CHATBOT_INVENTORY_SYNC_ENABLED`: defaults to `false`. Set to `true` to run
  product inventory sync in the chatbot process.
- `CHATBOT_INVENTORY_SYNC_INTERVAL_MINUTES`: defaults to `15` and controls the
  background inventory sync interval.
- `CHATBOT_MENU_ENABLED`: defaults to `true`.
- `CHATBOT_OPTOUT_KEYWORDS`: comma-separated opt-out words, defaults to
  `parar,sair`.
- `CHATBOT_PRODUCT_SEARCH_LIMIT`: max product inventory results sent to the
  responder, defaults to `3` and is capped at `5`.
- `CHATBOT_SESSION_TTL_MS`: defaults to 24 hours.
- `CHATBOT_TEMPLATE_PRODUCT_REPLIES`: defaults to `true`. When a product
  stock/price answer is clear, the chatbot replies without an LLM call.
- `DATABASE_URL`: PostgreSQL connection string, for example
  `postgresql://wa_js:wa_js_password@localhost:5432/wa_js_chatbot`.
- `MERCADO_LIVRE_ENABLED`: set to `true` to sync Mercado Livre inventory.
- `MERCADO_LIVRE_SELLER_ID`: seller id used by
  `/users/{seller_id}/items/search`.
- `MERCADO_LIVRE_ACCESS_TOKEN`: OAuth access token. If omitted, the sync command
  can refresh it with `MERCADO_LIVRE_CLIENT_ID`,
  `MERCADO_LIVRE_CLIENT_SECRET`, and `MERCADO_LIVRE_REFRESH_TOKEN`.
- `SHOPIFY_ENABLED`: set to `true` to sync Shopify inventory.
- `SHOPIFY_SHOP_DOMAIN`: shop domain, for example `example.myshopify.com`.
- `SHOPIFY_ADMIN_ACCESS_TOKEN`: Admin API token.
- `SHOPIFY_API_VERSION`: defaults to `2026-01`.

## Local database

`docker-compose.yml` starts PostgreSQL on `localhost:5432` and pgAdmin at
`http://localhost:5050`. Database initialization SQL lives in `db/migrations`
and runs when the local Docker volume is created for the first time.

The first run opens WhatsApp Web with a persistent browser profile. Scan the QR
code if needed, then send a text message from an allowed contact or leave
`CHATBOT_ALLOWED_CHATS` empty to respond to all one-to-one text chats.

The chatbot persists contacts, one conversation per contact, messages, state
transitions, LLM calls, and tool calls in PostgreSQL. Conversation status is
stored as `0` pending, `1` open for human handling, or `2` resolved. It still
keeps short-lived in-memory state per `chatId` for debounce and local response
serialization.

## Product inventory sync

Run a manual inventory sync before asking the chatbot about stock or price:

```bash
npm run chatbot:sync-inventory
```

The sync reads Mercado Livre and Shopify credentials from `.env`, fetches product
listings and variants, then upserts normalized products, prices, stock, links,
marketplace, and timestamps into PostgreSQL. Webhooks and an admin panel are out
of scope for this MVP.

To keep inventory fresh while the chatbot is running, enable the background sync:

```bash
CHATBOT_INVENTORY_SYNC_ENABLED=true
CHATBOT_INVENTORY_SYNC_INTERVAL_MINUTES=15
```

The background sync runs once when the chatbot starts and then repeats at the
configured interval. If one run is still active, the next scheduled run is
skipped.

When a WhatsApp message looks product-related, the responder queries PostgreSQL
with a deterministic top-3 search. Only the compact result payload is passed to
the LLM, and simple one-product answers can be sent from a template without
calling the LLM.
