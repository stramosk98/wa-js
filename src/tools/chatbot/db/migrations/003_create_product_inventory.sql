create table if not exists marketplace_accounts (
  id bigserial primary key,
  marketplace text not null,
  external_account_id text not null,
  display_name text,
  enabled boolean not null default true,
  credentials_source text not null default 'env',
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_accounts_marketplace_chk check (marketplace in ('mercado_livre', 'shopify'))
);

create unique index if not exists marketplace_accounts_marketplace_external_uidx
  on marketplace_accounts (marketplace, external_account_id);
create index if not exists marketplace_accounts_enabled_idx
  on marketplace_accounts (enabled);

create table if not exists products (
  id bigserial primary key,
  source_marketplace text not null,
  source_external_id text not null,
  title text not null,
  normalized_title text not null,
  brand text,
  category text,
  description_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_source_marketplace_chk check (source_marketplace in ('mercado_livre', 'shopify'))
);

create unique index if not exists products_source_uidx
  on products (source_marketplace, source_external_id);
create index if not exists products_normalized_title_idx
  on products (normalized_title);

create table if not exists product_listings (
  id bigserial primary key,
  product_id bigint not null references products (id),
  marketplace_account_id bigint not null references marketplace_accounts (id),
  marketplace text not null,
  external_id text not null,
  title text not null,
  normalized_title text not null,
  sku text,
  permalink text,
  status text,
  raw_payload jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_listings_marketplace_chk check (marketplace in ('mercado_livre', 'shopify'))
);

create unique index if not exists product_listings_marketplace_external_uidx
  on product_listings (marketplace, external_id);
create index if not exists product_listings_account_idx
  on product_listings (marketplace_account_id);
create index if not exists product_listings_normalized_title_idx
  on product_listings (normalized_title);
create index if not exists product_listings_sku_idx
  on product_listings (sku)
  where sku is not null;

create table if not exists product_variants (
  id bigserial primary key,
  listing_id bigint not null references product_listings (id),
  external_id text,
  sku text,
  title text,
  attributes jsonb not null default '{}'::jsonb,
  size text,
  color text,
  barcode text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists product_variants_listing_external_uidx
  on product_variants (listing_id, external_id)
  where external_id is not null;
create unique index if not exists product_variants_listing_no_external_uidx
  on product_variants (listing_id)
  where external_id is null;
create index if not exists product_variants_sku_idx
  on product_variants (sku)
  where sku is not null;
create index if not exists product_variants_size_idx
  on product_variants (size)
  where size is not null;

create table if not exists product_prices (
  id bigserial primary key,
  listing_id bigint not null references product_listings (id),
  variant_id bigint references product_variants (id),
  currency text not null,
  amount numeric(12, 2) not null,
  regular_amount numeric(12, 2),
  sale_amount numeric(12, 2),
  updated_at timestamptz not null default now()
);

create unique index if not exists product_prices_listing_variant_uidx
  on product_prices (listing_id, coalesce(variant_id, 0));

create table if not exists product_inventory (
  id bigserial primary key,
  listing_id bigint not null references product_listings (id),
  variant_id bigint references product_variants (id),
  available_quantity integer not null default 0,
  reserved_quantity integer not null default 0,
  inventory_policy text,
  updated_at timestamptz not null default now()
);

create unique index if not exists product_inventory_listing_variant_uidx
  on product_inventory (listing_id, coalesce(variant_id, 0));
create index if not exists product_inventory_available_idx
  on product_inventory (available_quantity);

create table if not exists product_sync_runs (
  id bigserial primary key,
  marketplace text not null,
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  items_seen integer not null default 0,
  items_upserted integer not null default 0,
  error_message text,
  constraint product_sync_runs_marketplace_chk check (marketplace in ('mercado_livre', 'shopify')),
  constraint product_sync_runs_status_chk check (status in ('started', 'succeeded', 'failed'))
);

create index if not exists product_sync_runs_marketplace_started_idx
  on product_sync_runs (marketplace, started_at);
