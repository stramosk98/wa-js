# Chatbot Database

Start the local database stack:

```bash
docker compose up -d
```

PostgreSQL is available on `localhost:5432`. pgAdmin is available at
`http://localhost:5050`.

The SQL files in `migrations/` are mounted into Postgres initialization and run
when the `postgres_data` volume is first created. To reset local data and rerun
the init scripts:

```bash
docker compose down -v
docker compose up -d
```

To apply a new migration to an existing local volume, run it manually:

```bash
docker compose exec -T postgres psql -U wa_js -d wa_js_chatbot -f /docker-entrypoint-initdb.d/002_simplify_conversation_status.sql
```

Product inventory tables are created by
`003_create_product_inventory.sql`. To apply it to an existing local volume:

```bash
docker compose exec -T postgres psql -U wa_js -d wa_js_chatbot -f /docker-entrypoint-initdb.d/003_create_product_inventory.sql
```

After applying the migration, run `npm run chatbot:sync-inventory` from the
repository root to sync Mercado Livre and Shopify product data into PostgreSQL.
