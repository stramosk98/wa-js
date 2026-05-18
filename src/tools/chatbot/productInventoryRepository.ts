/*!
 * Copyright 2026 WPPConnect Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Pool, PoolClient } from 'pg';

import {
  MarketplaceAccountSnapshot,
  MarketplaceProductSnapshot,
  MarketplaceProductVariantSnapshot,
} from './marketplaces/types';
import {
  Marketplace,
  ProductInventorySearchItem,
  ProductInventorySearchResult,
} from './types';

interface AccountRow {
  id: string;
}

interface ProductRow {
  id: string;
}

interface ListingRow {
  id: string;
}

interface VariantRow {
  id: string;
}

interface SyncRunRow {
  id: string;
}

interface SearchRow {
  available_quantity: number;
  color: string | null;
  currency: string | null;
  last_synced_at: Date;
  marketplace: Marketplace;
  permalink: string | null;
  price_amount: string | null;
  sku: string | null;
  title: string;
  variant_title: string | null;
}

export interface SearchProductInventoryInput {
  limit: number;
  marketplace?: Marketplace;
  query: string;
}

export class ProductInventoryRepository {
  constructor(private readonly pool: Pool) {}

  async beginSync(marketplace: Marketplace): Promise<number> {
    const result = await this.pool.query<SyncRunRow>(
      `
        insert into product_sync_runs (marketplace, status)
        values ($1, 'started')
        returning id
      `,
      [marketplace]
    );

    return Number(result.rows[0].id);
  }

  async finishSync(
    syncRunId: number,
    input: { itemsSeen: number; itemsUpserted: number }
  ): Promise<void> {
    await this.pool.query(
      `
        update product_sync_runs
        set status = 'succeeded',
            finished_at = now(),
            items_seen = $2,
            items_upserted = $3
        where id = $1
      `,
      [syncRunId, input.itemsSeen, input.itemsUpserted]
    );
  }

  async failSync(syncRunId: number, error: unknown): Promise<void> {
    await this.pool.query(
      `
        update product_sync_runs
        set status = 'failed',
            finished_at = now(),
            error_message = $2
        where id = $1
      `,
      [syncRunId, error instanceof Error ? error.message : String(error)]
    );
  }

  async searchProductInventory(
    input: SearchProductInventoryInput
  ): Promise<ProductInventorySearchResult> {
    const terms = toSearchTerms(input.query);

    if (!terms.length) {
      return {
        marketplace: input.marketplace,
        query: input.query,
        results: [],
      };
    }

    const likeTerms = terms.length ? terms.map((term) => `%${term}%`) : ['%'];
    const result = await this.pool.query<SearchRow>(
      `
        select
          l.marketplace,
          l.title,
          coalesce(v.sku, l.sku) as sku,
          l.permalink,
          l.last_synced_at,
          v.title as variant_title,
          v.sku as variant_sku,
          v.color,
          p.currency,
          p.amount as price_amount,
          i.available_quantity
        from product_listings l
        join product_variants v on v.listing_id = l.id
        left join product_prices p on p.listing_id = l.id
          and coalesce(p.variant_id, 0) = coalesce(v.id, 0)
        left join product_inventory i on i.listing_id = l.id
          and coalesce(i.variant_id, 0) = coalesce(v.id, 0)
        where ($1::text is null or l.marketplace = $1)
          and (
            l.normalized_title like all($2::text[])
            or lower(coalesce(l.sku, '')) = any($3::text[])
            or lower(coalesce(v.sku, '')) = any($3::text[])
            or lower(coalesce(v.title, '')) like any($2::text[])
            or lower(coalesce(v.size, '')) = any($3::text[])
            or lower(coalesce(v.color, '')) = any($3::text[])
          )
        order by
          case when lower(coalesce(v.sku, l.sku, '')) = any($3::text[]) then 0 else 1 end,
          case when coalesce(i.available_quantity, 0) > 0 then 0 else 1 end,
          l.last_synced_at desc
        limit $4
      `,
      [
        input.marketplace,
        likeTerms,
        terms,
        Math.max(1, Math.min(input.limit, 5)),
      ]
    );

    return {
      marketplace: input.marketplace,
      query: input.query,
      results: result.rows.map(toSearchItem),
    };
  }

  async upsertMarketplaceSnapshot(
    account: MarketplaceAccountSnapshot,
    products: MarketplaceProductSnapshot[]
  ): Promise<number> {
    const client = await this.pool.connect();

    try {
      await client.query('begin');

      const accountId = await this.upsertAccount(client, account);

      for (const product of products) {
        await this.upsertProductSnapshot(client, accountId, product);
      }

      await client.query(
        `
          update marketplace_accounts
          set last_sync_at = now(),
              updated_at = now()
          where id = $1
        `,
        [accountId]
      );
      await client.query('commit');

      return products.length;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertAccount(
    client: PoolClient,
    account: MarketplaceAccountSnapshot
  ): Promise<number> {
    const result = await client.query<AccountRow>(
      `
        insert into marketplace_accounts (
          marketplace,
          external_account_id,
          display_name
        )
        values ($1, $2, $3)
        on conflict (marketplace, external_account_id) do update
        set display_name = excluded.display_name,
            enabled = true,
            updated_at = now()
        returning id
      `,
      [account.marketplace, account.externalAccountId, account.displayName]
    );

    return Number(result.rows[0].id);
  }

  private async upsertProductSnapshot(
    client: PoolClient,
    accountId: number,
    product: MarketplaceProductSnapshot
  ): Promise<void> {
    const productId = await this.upsertProduct(client, product);
    const listingId = await this.upsertListing(
      client,
      accountId,
      productId,
      product
    );
    const variants = product.variants.length
      ? product.variants
      : [createDefaultVariant(product)];

    for (const variant of variants) {
      const variantId = await this.upsertVariant(client, listingId, variant);

      await this.upsertPrice(client, listingId, variantId, variant);
      await this.upsertInventory(client, listingId, variantId, variant);
    }
  }

  private async upsertProduct(
    client: PoolClient,
    product: MarketplaceProductSnapshot
  ): Promise<number> {
    const result = await client.query<ProductRow>(
      `
        insert into products (
          source_marketplace,
          source_external_id,
          title,
          normalized_title,
          brand,
          category,
          description_summary
        )
        values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (source_marketplace, source_external_id) do update
        set title = excluded.title,
            normalized_title = excluded.normalized_title,
            brand = excluded.brand,
            category = excluded.category,
            description_summary = excluded.description_summary,
            updated_at = now()
        returning id
      `,
      [
        product.marketplace,
        product.externalId,
        product.title,
        normalizeTitle(product.title),
        product.brand,
        product.category,
        product.descriptionSummary,
      ]
    );

    return Number(result.rows[0].id);
  }

  private async upsertListing(
    client: PoolClient,
    accountId: number,
    productId: number,
    product: MarketplaceProductSnapshot
  ): Promise<number> {
    const result = await client.query<ListingRow>(
      `
        insert into product_listings (
          product_id,
          marketplace_account_id,
          marketplace,
          external_id,
          title,
          normalized_title,
          sku,
          permalink,
          status,
          raw_payload,
          last_synced_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now())
        on conflict (marketplace, external_id) do update
        set product_id = excluded.product_id,
            marketplace_account_id = excluded.marketplace_account_id,
            title = excluded.title,
            normalized_title = excluded.normalized_title,
            sku = excluded.sku,
            permalink = excluded.permalink,
            status = excluded.status,
            raw_payload = excluded.raw_payload,
            last_synced_at = now(),
            updated_at = now()
        returning id
      `,
      [
        productId,
        accountId,
        product.marketplace,
        product.externalId,
        product.title,
        normalizeTitle(product.title),
        product.sku,
        product.permalink,
        product.status,
        JSON.stringify(product.rawPayload),
      ]
    );

    return Number(result.rows[0].id);
  }

  private async upsertVariant(
    client: PoolClient,
    listingId: number,
    variant: MarketplaceProductVariantSnapshot
  ): Promise<number> {
    const result = await client.query<VariantRow>(
      `
        insert into product_variants (
          listing_id,
          external_id,
          sku,
          title,
          attributes,
          size,
          color,
          barcode,
          raw_payload
        )
        values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb)
        on conflict (listing_id, external_id) where external_id is not null do update
        set sku = excluded.sku,
            title = excluded.title,
            attributes = excluded.attributes,
            size = excluded.size,
            color = excluded.color,
            barcode = excluded.barcode,
            raw_payload = excluded.raw_payload,
            updated_at = now()
        returning id
      `,
      [
        listingId,
        variant.externalId,
        variant.sku,
        variant.title,
        JSON.stringify(variant.attributes),
        variant.size,
        variant.color,
        variant.barcode,
        JSON.stringify(variant.rawPayload),
      ]
    );

    return Number(result.rows[0].id);
  }

  private async upsertPrice(
    client: PoolClient,
    listingId: number,
    variantId: number,
    variant: MarketplaceProductVariantSnapshot
  ): Promise<void> {
    await client.query(
      `
        insert into product_prices (
          listing_id,
          variant_id,
          currency,
          amount,
          regular_amount,
          sale_amount
        )
        values ($1, $2, $3, $4, $5, $6)
        on conflict (listing_id, (coalesce(variant_id, 0))) do update
        set currency = excluded.currency,
            amount = excluded.amount,
            regular_amount = excluded.regular_amount,
            sale_amount = excluded.sale_amount,
            updated_at = now()
      `,
      [
        listingId,
        variantId,
        variant.currency,
        variant.price,
        variant.regularPrice,
        variant.salePrice,
      ]
    );
  }

  private async upsertInventory(
    client: PoolClient,
    listingId: number,
    variantId: number,
    variant: MarketplaceProductVariantSnapshot
  ): Promise<void> {
    await client.query(
      `
        insert into product_inventory (
          listing_id,
          variant_id,
          available_quantity,
          inventory_policy
        )
        values ($1, $2, $3, $4)
        on conflict (listing_id, (coalesce(variant_id, 0))) do update
        set available_quantity = excluded.available_quantity,
            inventory_policy = excluded.inventory_policy,
            updated_at = now()
      `,
      [listingId, variantId, variant.availableQuantity, variant.inventoryPolicy]
    );
  }
}

function createDefaultVariant(
  product: MarketplaceProductSnapshot
): MarketplaceProductVariantSnapshot {
  const rawPayload = product.rawPayload as {
    available_quantity?: number;
    currency_id?: string;
    price?: number;
  };

  return {
    attributes: {},
    availableQuantity: Number(rawPayload.available_quantity || 0),
    currency: rawPayload.currency_id || 'BRL',
    externalId: product.externalId,
    price: Number(rawPayload.price || 0),
    rawPayload: product.rawPayload,
    sku: product.sku,
    title: product.title,
  };
}

function formatPrice(
  currency: string | null,
  amount: string | null
): string | undefined {
  if (!currency || !amount) {
    return undefined;
  }

  return `${currency} ${Number(amount).toFixed(2)}`;
}

function normalizeTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function toSearchTerms(query: string): string[] {
  const stopWords = new Set([
    'a',
    'as',
    'com',
    'da',
    'de',
    'do',
    'e',
    'em',
    'esse',
    'essa',
    'estoque',
    'o',
    'os',
    'preco',
    'produto',
    'quanto',
    'tem',
    'tamanho',
    'valor',
  ]);

  return normalizeTitle(query)
    .split(' ')
    .filter((term) => term.length > 1 && !stopWords.has(term));
}

function toSearchItem(row: SearchRow): ProductInventorySearchItem {
  return {
    availableQuantity: row.available_quantity || 0,
    color: row.color || undefined,
    lastSyncedAt: row.last_synced_at.toISOString(),
    marketplace: row.marketplace,
    price: formatPrice(row.currency, row.price_amount),
    sku: row.sku || undefined,
    title: row.title,
    url: row.permalink || undefined,
    variant: row.variant_title || undefined,
  };
}
