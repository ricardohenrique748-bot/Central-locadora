/**
 * Central Locação - Banco de dados (SQLite embutido do Node 24).
 * Valores monetários em centavos (INTEGER) — precisão exata, sem ponto flutuante.
 * Migrações versionadas: cada entrada roda uma única vez, registrada em schema_migrations.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type DB = DatabaseSync;

const NOW = `(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

const MIGRATIONS: { version: number; name: string; sql: string; fkOff?: boolean }[] = [
  {
    version: 1,
    name: 'modulo_orcamentos_inicial',
    sql: `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin','gestor','vendedor','consulta')),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW}
      );

      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX ix_sessions_user ON sessions(user_id);

      CREATE TABLE customers (
        id INTEGER PRIMARY KEY,
        person_type TEXT NOT NULL CHECK (person_type IN ('PF','PJ')),
        name TEXT NOT NULL,
        trade_name TEXT,
        document TEXT CHECK (document IS NULL OR length(document) IN (11,14)),
        state_registration TEXT,
        phone TEXT,
        whatsapp TEXT,
        email TEXT,
        postal_code TEXT,
        street TEXT,
        street_number TEXT,
        complement TEXT,
        neighborhood TEXT,
        city TEXT,
        state TEXT,
        notes TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE UNIQUE INDEX ux_customers_document ON customers(document) WHERE document IS NOT NULL;
      CREATE INDEX ix_customers_name ON customers(name COLLATE NOCASE);
      CREATE INDEX ix_customers_phone ON customers(phone);

      CREATE TABLE catalog_items (
        id INTEGER PRIMARY KEY,
        internal_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
        description TEXT NOT NULL,
        category TEXT,
        item_type TEXT NOT NULL CHECK (item_type IN ('equipamento','produto','peca','acessorio')),
        sale_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sale_enabled IN (0,1)),
        rental_enabled INTEGER NOT NULL DEFAULT 0 CHECK (rental_enabled IN (0,1)),
        brand TEXT,
        model TEXT,
        unit TEXT NOT NULL,
        sale_price INTEGER CHECK (sale_price IS NULL OR sale_price >= 0),
        daily_rental_price INTEGER CHECK (daily_rental_price IS NULL OR daily_rental_price >= 0),
        weekly_rental_price INTEGER CHECK (weekly_rental_price IS NULL OR weekly_rental_price >= 0),
        monthly_rental_price INTEGER CHECK (monthly_rental_price IS NULL OR monthly_rental_price >= 0),
        custom_rental_price INTEGER CHECK (custom_rental_price IS NULL OR custom_rental_price >= 0),
        technical_description TEXT,
        image_data TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW},
        CHECK (sale_enabled = 1 OR rental_enabled = 1)
      );
      CREATE INDEX ix_catalog_description ON catalog_items(description COLLATE NOCASE);
      CREATE INDEX ix_catalog_category ON catalog_items(category);

      CREATE TABLE counters (
        name TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      );

      CREATE TABLE quotations (
        id INTEGER PRIMARY KEY,
        quotation_number TEXT NOT NULL UNIQUE,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        customer_snapshot TEXT NOT NULL,
        quotation_type TEXT NOT NULL CHECK (quotation_type IN ('venda','locacao')),
        status TEXT NOT NULL CHECK (status IN ('rascunho','em_revisao','aguardando_aprovacao','aprovado_interno','enviado','em_negociacao','aprovado_cliente','recusado','expirado','cancelado','convertido')),
        responsible_user_id INTEGER NOT NULL REFERENCES users(id),
        issue_date TEXT NOT NULL,
        expiration_date TEXT NOT NULL,
        client_reference TEXT,
        start_date TEXT,
        end_date TEXT,
        rental_days INTEGER,
        rental_billing_period TEXT CHECK (rental_billing_period IS NULL OR rental_billing_period IN ('diaria','semanal','mensal','personalizado')),
        custom_periods REAL,
        custom_period_label TEXT,
        availability_status TEXT NOT NULL DEFAULT 'nao_verificada' CHECK (availability_status IN ('nao_verificada','confirmada','insuficiente','indisponivel')),
        general_discount_type TEXT NOT NULL DEFAULT 'percent' CHECK (general_discount_type IN ('percent','fixed')),
        general_discount_value REAL NOT NULL DEFAULT 0 CHECK (general_discount_value >= 0),
        reference_total INTEGER NOT NULL DEFAULT 0,
        items_gross_total INTEGER NOT NULL DEFAULT 0,
        item_discount_total INTEGER NOT NULL DEFAULT 0,
        price_reduction_total INTEGER NOT NULL DEFAULT 0,
        subtotal INTEGER NOT NULL DEFAULT 0,
        general_discount INTEGER NOT NULL DEFAULT 0,
        additional_charges INTEGER NOT NULL DEFAULT 0 CHECK (additional_charges >= 0),
        freight_amount INTEGER NOT NULL DEFAULT 0 CHECK (freight_amount >= 0),
        pickup_freight_amount INTEGER NOT NULL DEFAULT 0 CHECK (pickup_freight_amount >= 0),
        installation_amount INTEGER NOT NULL DEFAULT 0 CHECK (installation_amount >= 0),
        other_services_amount INTEGER NOT NULL DEFAULT 0 CHECK (other_services_amount >= 0),
        deposit_amount INTEGER NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
        total_amount INTEGER NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
        effective_discount_percent REAL NOT NULL DEFAULT 0,
        payment_terms TEXT,
        delivery_terms TEXT,
        warranty_terms TEXT,
        pickup_delivery_terms TEXT,
        customer_responsibilities TEXT,
        return_conditions TEXT,
        included_accessories TEXT,
        complementary_description TEXT,
        specific_conditions TEXT,
        commercial_notes TEXT,
        internal_notes TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        row_version INTEGER NOT NULL DEFAULT 1,
        sent_at TEXT,
        refusal_reason TEXT,
        converted_record_type TEXT,
        converted_record_id TEXT,
        created_by INTEGER NOT NULL REFERENCES users(id),
        updated_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW},
        CHECK ((converted_record_type IS NULL) = (converted_record_id IS NULL))
      );
      CREATE UNIQUE INDEX ux_quotations_converted ON quotations(converted_record_type, converted_record_id) WHERE converted_record_id IS NOT NULL;
      CREATE INDEX ix_quotations_status ON quotations(status);
      CREATE INDEX ix_quotations_customer ON quotations(customer_id);
      CREATE INDEX ix_quotations_responsible ON quotations(responsible_user_id);
      CREATE INDEX ix_quotations_created ON quotations(created_at);
      CREATE INDEX ix_quotations_expiration ON quotations(expiration_date);

      CREATE TABLE quotation_items (
        id INTEGER PRIMARY KEY,
        quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        catalog_item_id INTEGER REFERENCES catalog_items(id),
        item_code_snapshot TEXT NOT NULL,
        description_snapshot TEXT NOT NULL,
        item_type_snapshot TEXT NOT NULL,
        unit TEXT NOT NULL,
        quantity REAL NOT NULL CHECK (quantity > 0),
        unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
        reference_price INTEGER,
        billing_period TEXT,
        periods REAL NOT NULL,
        discount_type TEXT NOT NULL CHECK (discount_type IN ('percent','fixed')),
        discount_value REAL NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
        gross_total INTEGER NOT NULL,
        discount_amount INTEGER NOT NULL,
        line_total INTEGER NOT NULL CHECK (line_total >= 0),
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX ix_quotation_items_quotation ON quotation_items(quotation_id, position);

      CREATE TABLE quotation_status_history (
        id INTEGER PRIMARY KEY,
        quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
        previous_status TEXT,
        new_status TEXT NOT NULL,
        changed_by INTEGER REFERENCES users(id),
        change_reason TEXT,
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX ix_status_history_quotation ON quotation_status_history(quotation_id);

      CREATE TABLE quotation_versions (
        id INTEGER PRIMARY KEY,
        quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        snapshot_data TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        UNIQUE (quotation_id, version_number)
      );

      CREATE TABLE quotation_approvals (
        id INTEGER PRIMARY KEY,
        quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
        requested_by INTEGER NOT NULL REFERENCES users(id),
        approved_by INTEGER REFERENCES users(id),
        approval_type TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pendente','aprovado','rejeitado')),
        discount_percent REAL NOT NULL DEFAULT 0,
        comments TEXT,
        requested_at TEXT NOT NULL DEFAULT ${NOW},
        resolved_at TEXT
      );
      CREATE INDEX ix_approvals_quotation ON quotation_approvals(quotation_id);

      CREATE TABLE quotation_activities (
        id INTEGER PRIMARY KEY,
        quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
        activity_type TEXT NOT NULL,
        description TEXT NOT NULL,
        performed_by INTEGER REFERENCES users(id),
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX ix_activities_quotation ON quotation_activities(quotation_id);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT ${NOW}
      );

      CREATE TABLE text_templates (
        id INTEGER PRIMARY KEY,
        field TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        quotation_type TEXT CHECK (quotation_type IS NULL OR quotation_type IN ('venda','locacao')),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW}
      );

      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY,
        entity TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id),
        data TEXT,
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX ix_audit_entity ON audit_log(entity, entity_id);
    `,
  },
  {
    version: 2,
    name: 'modulo_estoque',
    fkOff: true, // reconstrução de tabelas (users, catalog_items) exige FK desligada durante a troca
    sql: `
      -- Perfil "estoquista" (recria users com o novo CHECK)
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin','gestor','vendedor','estoquista','consulta')),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW}
      );
      INSERT INTO users_new SELECT id, name, email, password_hash, role, active, created_at, updated_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;

      CREATE TABLE suppliers (
        id INTEGER PRIMARY KEY,
        person_type TEXT NOT NULL DEFAULT 'PJ' CHECK (person_type IN ('PF','PJ')),
        name TEXT NOT NULL,
        trade_name TEXT,
        document TEXT CHECK (document IS NULL OR length(document) IN (11,14)),
        state_registration TEXT,
        contact_name TEXT,
        phone TEXT,
        email TEXT,
        address TEXT,
        city TEXT,
        state TEXT,
        notes TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE UNIQUE INDEX ux_suppliers_document ON suppliers(document) WHERE document IS NOT NULL;
      CREATE INDEX ix_suppliers_name ON suppliers(name COLLATE NOCASE);

      CREATE TABLE stock_locations (
        id INTEGER PRIMARY KEY,
        code TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        location_type TEXT NOT NULL CHECK (location_type IN ('deposito','filial','patio','oficina','outro')),
        address TEXT,
        responsible TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );

      -- Cadastro único de itens (catálogo dos orçamentos + estoque)
      CREATE TABLE catalog_items_new (
        id INTEGER PRIMARY KEY,
        internal_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
        description TEXT NOT NULL,
        long_description TEXT,
        kind TEXT NOT NULL DEFAULT 'produto_venda' CHECK (kind IN ('produto_venda','equipamento_locacao','venda_locacao','peca','acessorio','consumo')),
        tracking TEXT NOT NULL DEFAULT 'quantidade' CHECK (tracking IN ('quantidade','individual')),
        category TEXT,
        subcategory TEXT,
        item_type TEXT NOT NULL CHECK (item_type IN ('equipamento','produto','peca','acessorio')),
        sale_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sale_enabled IN (0,1)),
        rental_enabled INTEGER NOT NULL DEFAULT 0 CHECK (rental_enabled IN (0,1)),
        brand TEXT,
        model TEXT,
        unit TEXT NOT NULL,
        barcode TEXT,
        notes TEXT,
        acquisition_cost INTEGER CHECK (acquisition_cost IS NULL OR acquisition_cost >= 0),
        average_cost INTEGER CHECK (average_cost IS NULL OR average_cost >= 0),
        sale_price INTEGER CHECK (sale_price IS NULL OR sale_price >= 0),
        daily_rental_price INTEGER CHECK (daily_rental_price IS NULL OR daily_rental_price >= 0),
        weekly_rental_price INTEGER CHECK (weekly_rental_price IS NULL OR weekly_rental_price >= 0),
        monthly_rental_price INTEGER CHECK (monthly_rental_price IS NULL OR monthly_rental_price >= 0),
        custom_rental_price INTEGER CHECK (custom_rental_price IS NULL OR custom_rental_price >= 0),
        main_supplier_id INTEGER REFERENCES suppliers(id),
        supplier_code TEXT,
        last_purchase_date TEXT,
        min_qty REAL CHECK (min_qty IS NULL OR min_qty >= 0),
        max_qty REAL CHECK (max_qty IS NULL OR max_qty >= 0),
        default_location_id INTEGER REFERENCES stock_locations(id),
        allow_negative INTEGER NOT NULL DEFAULT 0 CHECK (allow_negative IN (0,1)),
        technical_description TEXT,
        image_data TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW}
      );
      INSERT INTO catalog_items_new (id, internal_code, description, kind, category, item_type, sale_enabled, rental_enabled, brand, model, unit,
          sale_price, daily_rental_price, weekly_rental_price, monthly_rental_price, custom_rental_price, technical_description, image_data, active, created_at, updated_at)
        SELECT id, internal_code, description,
          CASE
            WHEN item_type = 'peca' THEN 'peca'
            WHEN item_type = 'acessorio' THEN 'acessorio'
            WHEN sale_enabled = 1 AND rental_enabled = 1 THEN 'venda_locacao'
            WHEN rental_enabled = 1 THEN 'equipamento_locacao'
            ELSE 'produto_venda'
          END,
          category, item_type, sale_enabled, rental_enabled, brand, model, unit,
          sale_price, daily_rental_price, weekly_rental_price, monthly_rental_price, custom_rental_price, technical_description, image_data, active, created_at, updated_at
        FROM catalog_items;
      DROP TABLE catalog_items;
      ALTER TABLE catalog_items_new RENAME TO catalog_items;
      CREATE INDEX ix_catalog_description ON catalog_items(description COLLATE NOCASE);
      CREATE INDEX ix_catalog_category ON catalog_items(category);
      CREATE INDEX ix_catalog_barcode ON catalog_items(barcode);

      -- Saldo por item e local (mantido em transação junto com cada movimentação confirmada)
      CREATE TABLE stock_balances (
        item_id INTEGER NOT NULL REFERENCES catalog_items(id),
        location_id INTEGER NOT NULL REFERENCES stock_locations(id),
        quantity REAL NOT NULL DEFAULT 0,
        reserved REAL NOT NULL DEFAULT 0 CHECK (reserved >= 0),
        unavailable REAL NOT NULL DEFAULT 0 CHECK (unavailable >= 0),
        updated_at TEXT NOT NULL DEFAULT ${NOW},
        PRIMARY KEY (item_id, location_id)
      );

      CREATE TABLE stock_assets (
        id INTEGER PRIMARY KEY,
        item_id INTEGER NOT NULL REFERENCES catalog_items(id),
        asset_tag TEXT NOT NULL UNIQUE COLLATE NOCASE,
        serial_number TEXT,
        acquisition_date TEXT,
        supplier_id INTEGER REFERENCES suppliers(id),
        acquisition_cost INTEGER CHECK (acquisition_cost IS NULL OR acquisition_cost >= 0),
        conservation TEXT NOT NULL DEFAULT 'novo' CHECK (conservation IN ('novo','bom','regular','ruim')),
        operation_start_date TEXT,
        warranty_until TEXT,
        location_id INTEGER REFERENCES stock_locations(id),
        operational_status TEXT NOT NULL DEFAULT 'novo' CHECK (operational_status IN ('novo','operacional','aguardando_inspecao','em_manutencao','danificado','baixado')),
        rental_status TEXT NOT NULL DEFAULT 'disponivel' CHECK (rental_status IN ('disponivel','reservado','alugado','em_transito','indisponivel')),
        technical_notes TEXT,
        notes TEXT,
        written_off_at TEXT,
        write_off_reason TEXT,
        row_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE UNIQUE INDEX ux_assets_serial ON stock_assets(item_id, serial_number) WHERE serial_number IS NOT NULL;
      CREATE INDEX ix_assets_item ON stock_assets(item_id);
      CREATE INDEX ix_assets_status ON stock_assets(operational_status, rental_status);

      CREATE TABLE stock_asset_events (
        id INTEGER PRIMARY KEY,
        asset_id INTEGER NOT NULL REFERENCES stock_assets(id),
        event_type TEXT NOT NULL,
        description TEXT NOT NULL,
        performed_by INTEGER REFERENCES users(id),
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX ix_asset_events ON stock_asset_events(asset_id);

      CREATE TABLE stock_asset_files (
        id INTEGER PRIMARY KEY,
        asset_id INTEGER NOT NULL REFERENCES stock_assets(id),
        kind TEXT NOT NULL CHECK (kind IN ('foto','documento')),
        name TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        data TEXT NOT NULL,
        uploaded_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX ix_asset_files ON stock_asset_files(asset_id);

      -- Movimentações: confirmadas são imutáveis; correção por estorno
      CREATE TABLE stock_movements (
        id INTEGER PRIMARY KEY,
        number TEXT NOT NULL UNIQUE,
        movement_type TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('rascunho','confirmado','estornado')),
        item_id INTEGER NOT NULL REFERENCES catalog_items(id),
        asset_id INTEGER REFERENCES stock_assets(id),
        quantity REAL NOT NULL CHECK (quantity > 0),
        qty_delta REAL NOT NULL DEFAULT 0,
        unavailable_delta REAL NOT NULL DEFAULT 0,
        balance_location_id INTEGER REFERENCES stock_locations(id),
        origin_location_id INTEGER REFERENCES stock_locations(id),
        dest_location_id INTEGER REFERENCES stock_locations(id),
        unit_cost INTEGER,
        total_cost INTEGER,
        reference_doc TEXT,
        reason TEXT,
        notes TEXT,
        document_type TEXT,
        document_id INTEGER,
        reversal_of_id INTEGER REFERENCES stock_movements(id),
        created_by INTEGER REFERENCES users(id),
        confirmed_by INTEGER REFERENCES users(id),
        confirmed_at TEXT,
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX ix_movements_item ON stock_movements(item_id, confirmed_at);
      CREATE INDEX ix_movements_created ON stock_movements(created_at);
      CREATE INDEX ix_movements_doc ON stock_movements(document_type, document_id);
      CREATE UNIQUE INDEX ux_movements_reversal ON stock_movements(reversal_of_id) WHERE reversal_of_id IS NOT NULL;

      CREATE TABLE stock_entries (
        id INTEGER PRIMARY KEY,
        number TEXT NOT NULL UNIQUE,
        entry_kind TEXT NOT NULL CHECK (entry_kind IN ('compra','inicial','devolucao_venda','outra')),
        status TEXT NOT NULL CHECK (status IN ('rascunho','confirmada','cancelada')),
        supplier_id INTEGER REFERENCES suppliers(id),
        origin_document TEXT,
        entry_date TEXT NOT NULL,
        location_id INTEGER NOT NULL REFERENCES stock_locations(id),
        received_by TEXT,
        discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
        extra_expenses INTEGER NOT NULL DEFAULT 0 CHECK (extra_expenses >= 0),
        items_total INTEGER NOT NULL DEFAULT 0,
        total INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        confirmed_by INTEGER REFERENCES users(id),
        confirmed_at TEXT,
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE TABLE stock_entry_items (
        id INTEGER PRIMARY KEY,
        entry_id INTEGER NOT NULL REFERENCES stock_entries(id) ON DELETE CASCADE,
        item_id INTEGER NOT NULL REFERENCES catalog_items(id),
        quantity REAL NOT NULL CHECK (quantity > 0),
        unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0),
        line_total INTEGER NOT NULL,
        allocated_unit_cost INTEGER NOT NULL,
        units TEXT
      );

      CREATE TABLE stock_transfers (
        id INTEGER PRIMARY KEY,
        number TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('rascunho','aguardando_envio','em_transito','recebida','cancelada')),
        origin_location_id INTEGER NOT NULL REFERENCES stock_locations(id),
        dest_location_id INTEGER NOT NULL REFERENCES stock_locations(id),
        notes TEXT,
        sent_by INTEGER REFERENCES users(id),
        sent_at TEXT,
        received_by INTEGER REFERENCES users(id),
        received_at TEXT,
        divergence_notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        CHECK (origin_location_id != dest_location_id)
      );
      CREATE TABLE stock_transfer_items (
        id INTEGER PRIMARY KEY,
        transfer_id INTEGER NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
        item_id INTEGER NOT NULL REFERENCES catalog_items(id),
        asset_id INTEGER REFERENCES stock_assets(id),
        quantity REAL NOT NULL CHECK (quantity > 0),
        received_quantity REAL
      );

      CREATE TABLE stock_reservations (
        id INTEGER PRIMARY KEY,
        number TEXT NOT NULL UNIQUE,
        item_id INTEGER NOT NULL REFERENCES catalog_items(id),
        asset_id INTEGER REFERENCES stock_assets(id),
        quantity REAL NOT NULL CHECK (quantity > 0),
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pendente','confirmada','em_uso','concluida','cancelada')),
        customer_id INTEGER REFERENCES customers(id),
        customer_name TEXT,
        quotation_id INTEGER REFERENCES quotations(id),
        contract_ref TEXT,
        location_id INTEGER REFERENCES stock_locations(id),
        delivered_at TEXT,
        returned_at TEXT,
        returned_qty REAL,
        damaged_qty REAL,
        missing_qty REAL,
        notes TEXT,
        cancel_reason TEXT,
        created_by INTEGER REFERENCES users(id),
        confirmed_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW},
        CHECK (end_date >= start_date)
      );
      CREATE INDEX ix_reservations_asset ON stock_reservations(asset_id, status);
      CREATE INDEX ix_reservations_item ON stock_reservations(item_id, status);

      CREATE TABLE stock_inspections (
        id INTEGER PRIMARY KEY,
        asset_id INTEGER REFERENCES stock_assets(id),
        reservation_id INTEGER REFERENCES stock_reservations(id),
        result TEXT NOT NULL CHECK (result IN ('aprovado','manutencao','danificado')),
        checklist TEXT NOT NULL,
        notes TEXT,
        inspected_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );

      CREATE TABLE stock_inventories (
        id INTEGER PRIMARY KEY,
        number TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('em_andamento','aguardando_conferencia','aguardando_aprovacao','finalizado','cancelado')),
        scope TEXT NOT NULL,
        scope_label TEXT NOT NULL,
        location_id INTEGER REFERENCES stock_locations(id),
        snapshot_movement_id INTEGER NOT NULL DEFAULT 0,
        opened_by INTEGER REFERENCES users(id),
        opened_at TEXT NOT NULL DEFAULT ${NOW},
        checked_by INTEGER REFERENCES users(id),
        approved_by INTEGER REFERENCES users(id),
        approved_at TEXT,
        notes TEXT
      );
      CREATE TABLE stock_inventory_lines (
        id INTEGER PRIMARY KEY,
        inventory_id INTEGER NOT NULL REFERENCES stock_inventories(id) ON DELETE CASCADE,
        item_id INTEGER NOT NULL REFERENCES catalog_items(id),
        location_id INTEGER NOT NULL REFERENCES stock_locations(id),
        system_qty REAL NOT NULL,
        counted_qty REAL,
        justification TEXT,
        counted_by INTEGER REFERENCES users(id),
        counted_at TEXT
      );
    `,
  },
  {
    version: 3,
    name: 'modulo_financeiro',
    fkOff: true, // recria users com o perfil "financeiro"
    sql: `
      -- Perfil "financeiro"
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin','gestor','vendedor','estoquista','financeiro','consulta')),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW}
      );
      INSERT INTO users_new SELECT id, name, email, password_hash, role, active, created_at, updated_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;

      CREATE TABLE financial_accounts (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        account_type TEXT NOT NULL CHECK (account_type IN ('caixa','corrente','poupanca','outra')),
        institution_name TEXT,
        account_reference TEXT,
        opening_balance INTEGER NOT NULL DEFAULT 0,
        opening_balance_date TEXT NOT NULL,
        responsible TEXT,
        notes TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW}
      );

      CREATE TABLE financial_categories (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        category_type TEXT NOT NULL CHECK (category_type IN ('receita','despesa')),
        parent_id INTEGER REFERENCES financial_categories(id),
        dre_group TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE UNIQUE INDEX ux_fin_categories ON financial_categories(category_type, COALESCE(parent_id, 0), name COLLATE NOCASE);

      CREATE TABLE cost_centers (
        id INTEGER PRIMARY KEY,
        code TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        description TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );

      CREATE TABLE financial_recurrences (
        id INTEGER PRIMARY KEY,
        entry_type TEXT NOT NULL CHECK (entry_type IN ('pagar','receber')),
        template TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK (amount > 0),
        frequency TEXT NOT NULL CHECK (frequency IN ('semanal','mensal','anual')),
        start_date TEXT NOT NULL,
        end_date TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );

      -- Título (obrigação ou cobrança)
      CREATE TABLE financial_entries (
        id INTEGER PRIMARY KEY,
        entry_number TEXT NOT NULL UNIQUE,
        entry_type TEXT NOT NULL CHECK (entry_type IN ('pagar','receber')),
        status TEXT NOT NULL CHECK (status IN ('rascunho','aguardando_aprovacao','ativo','cancelado')),
        description TEXT NOT NULL,
        party_type TEXT NOT NULL CHECK (party_type IN ('fornecedor','cliente','outro')),
        supplier_id INTEGER REFERENCES suppliers(id),
        customer_id INTEGER REFERENCES customers(id),
        party_name TEXT NOT NULL,
        party_document TEXT,
        category_id INTEGER NOT NULL REFERENCES financial_categories(id),
        origin TEXT,
        source_type TEXT NOT NULL DEFAULT 'manual',
        source_id TEXT,
        source_ref TEXT,
        quotation_id INTEGER REFERENCES quotations(id),
        recurrence_id INTEGER REFERENCES financial_recurrences(id),
        document_ref TEXT,
        issue_date TEXT NOT NULL,
        competence_date TEXT NOT NULL,
        original_amount INTEGER NOT NULL CHECK (original_amount > 0),
        payment_method TEXT,
        planned_account_id INTEGER REFERENCES financial_accounts(id),
        notes TEXT,
        cancel_reason TEXT,
        approved_by INTEGER REFERENCES users(id),
        approved_at TEXT,
        created_by INTEGER REFERENCES users(id),
        row_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW}
      );
      -- integrações nunca geram o mesmo título duas vezes
      CREATE UNIQUE INDEX ux_fin_entries_source ON financial_entries(source_type, source_id) WHERE source_id IS NOT NULL;
      CREATE INDEX ix_fin_entries_type ON financial_entries(entry_type, status);
      CREATE INDEX ix_fin_entries_quotation ON financial_entries(quotation_id);

      CREATE TABLE financial_installments (
        id INTEGER PRIMARY KEY,
        entry_id INTEGER NOT NULL REFERENCES financial_entries(id),
        number INTEGER NOT NULL,
        due_date TEXT NOT NULL,
        original_amount INTEGER NOT NULL CHECK (original_amount > 0),
        discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
        interest INTEGER NOT NULL DEFAULT 0 CHECK (interest >= 0),
        penalty INTEGER NOT NULL DEFAULT 0 CHECK (penalty >= 0),
        additional INTEGER NOT NULL DEFAULT 0 CHECK (additional >= 0),
        settled_amount INTEGER NOT NULL DEFAULT 0 CHECK (settled_amount >= 0),
        status TEXT NOT NULL CHECK (status IN ('aberto','parcial','liquidado','cancelado')),
        row_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW},
        UNIQUE (entry_id, number),
        CHECK (settled_amount <= original_amount - discount + interest + penalty + additional)
      );
      CREATE INDEX ix_fin_inst_due ON financial_installments(due_date, status);

      CREATE TABLE financial_entry_cost_centers (
        id INTEGER PRIMARY KEY,
        entry_id INTEGER NOT NULL REFERENCES financial_entries(id) ON DELETE CASCADE,
        cost_center_id INTEGER NOT NULL REFERENCES cost_centers(id),
        amount INTEGER NOT NULL CHECK (amount > 0),
        UNIQUE (entry_id, cost_center_id)
      );

      -- Movimentação efetiva na conta (saldo = inicial + efetivadas)
      CREATE TABLE financial_transactions (
        id INTEGER PRIMARY KEY,
        transaction_number TEXT NOT NULL UNIQUE,
        account_id INTEGER NOT NULL REFERENCES financial_accounts(id),
        transaction_type TEXT NOT NULL,
        direction INTEGER NOT NULL CHECK (direction IN (1,-1)),
        amount INTEGER NOT NULL CHECK (amount > 0),
        transaction_date TEXT NOT NULL,
        description TEXT NOT NULL,
        method TEXT,
        source_type TEXT,
        source_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('pendente','efetivada')),
        idempotency_key TEXT UNIQUE,
        reversal_of_id INTEGER UNIQUE REFERENCES financial_transactions(id),
        statement_item_id INTEGER UNIQUE,
        performed_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX ix_fin_tx_account ON financial_transactions(account_id, transaction_date);

      CREATE TABLE financial_allocations (
        id INTEGER PRIMARY KEY,
        transaction_id INTEGER NOT NULL REFERENCES financial_transactions(id),
        installment_id INTEGER NOT NULL REFERENCES financial_installments(id),
        amount INTEGER NOT NULL CHECK (amount != 0),
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX ix_fin_alloc_inst ON financial_allocations(installment_id);
      CREATE INDEX ix_fin_alloc_tx ON financial_allocations(transaction_id);

      CREATE TABLE financial_transfers (
        id INTEGER PRIMARY KEY,
        number TEXT NOT NULL UNIQUE,
        source_account_id INTEGER NOT NULL REFERENCES financial_accounts(id),
        destination_account_id INTEGER NOT NULL REFERENCES financial_accounts(id),
        amount INTEGER NOT NULL CHECK (amount > 0),
        transfer_date TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pendente','efetivada','estornada','cancelada')),
        description TEXT,
        reference TEXT,
        idempotency_key TEXT UNIQUE,
        out_tx_id INTEGER REFERENCES financial_transactions(id),
        in_tx_id INTEGER REFERENCES financial_transactions(id),
        performed_by INTEGER REFERENCES users(id),
        confirmed_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        CHECK (source_account_id != destination_account_id)
      );

      CREATE TABLE financial_attachments (
        id INTEGER PRIMARY KEY,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('entry','transaction')),
        entity_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        data TEXT NOT NULL,
        uploaded_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX ix_fin_attach ON financial_attachments(entity_type, entity_id);

      CREATE TABLE cash_sessions (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES financial_accounts(id),
        status TEXT NOT NULL CHECK (status IN ('aberto','fechado')),
        opened_by INTEGER REFERENCES users(id),
        opened_at TEXT NOT NULL DEFAULT ${NOW},
        opening_balance INTEGER NOT NULL,
        opening_tx_id INTEGER NOT NULL DEFAULT 0,
        closing_tx_id INTEGER,
        closed_by INTEGER REFERENCES users(id),
        closed_at TEXT,
        expected_balance INTEGER,
        counted_amount INTEGER,
        difference INTEGER,
        justification TEXT,
        difference_tx_id INTEGER REFERENCES financial_transactions(id)
      );
      CREATE UNIQUE INDEX ux_cash_open ON cash_sessions(account_id) WHERE status = 'aberto';

      CREATE TABLE financial_reconciliations (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES financial_accounts(id),
        file_name TEXT NOT NULL,
        statement_reference TEXT,
        imported_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );

      CREATE TABLE financial_statement_items (
        id INTEGER PRIMARY KEY,
        reconciliation_id INTEGER NOT NULL REFERENCES financial_reconciliations(id),
        account_id INTEGER NOT NULL REFERENCES financial_accounts(id),
        transaction_date TEXT NOT NULL,
        description TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK (amount != 0),
        external_reference TEXT,
        fingerprint TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pendente','conciliado','divergente','ignorado','duplicado')),
        matched_transaction_id INTEGER UNIQUE REFERENCES financial_transactions(id),
        note TEXT,
        matched_by INTEGER REFERENCES users(id),
        matched_at TEXT,
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX ix_fin_stmt_account ON financial_statement_items(account_id, status);
      CREATE INDEX ix_fin_stmt_fp ON financial_statement_items(account_id, fingerprint);
    `,
  },
  {
    version: 4,
    name: 'modulo_contratos',
    sql: `
      CREATE TABLE contracts (
        id INTEGER PRIMARY KEY,
        contract_number TEXT NOT NULL UNIQUE,
        contract_type TEXT NOT NULL CHECK (contract_type IN ('locacao','venda')),
        status TEXT NOT NULL CHECK (status IN ('rascunho','aguardando_aprovacao','aprovado','aguardando_assinatura','agendado','ativo','vencido','pendente_devolucao','encerrado','cancelado')),
        source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','orcamento')),
        quotation_id INTEGER UNIQUE REFERENCES quotations(id),
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        customer_snapshot TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT,
        responsible_user_id INTEGER NOT NULL REFERENCES users(id),
        approver_user_id INTEGER REFERENCES users(id),
        delivery_address TEXT,
        internal_notes TEXT,
        billing_frequency TEXT NOT NULL CHECK (billing_frequency IN ('diaria','semanal','quinzenal','mensal','personalizado','unico')),
        custom_period_days INTEGER CHECK (custom_period_days IS NULL OR custom_period_days BETWEEN 1 AND 365),
        billing_timing TEXT NOT NULL DEFAULT 'antecipado' CHECK (billing_timing IN ('antecipado','postecipado')),
        due_day INTEGER CHECK (due_day IS NULL OR due_day BETWEEN 1 AND 31),
        due_days_after INTEGER NOT NULL DEFAULT 0 CHECK (due_days_after BETWEEN 0 AND 120),
        proportional_last INTEGER NOT NULL DEFAULT 1 CHECK (proportional_last IN (0,1)),
        general_discount INTEGER NOT NULL DEFAULT 0 CHECK (general_discount >= 0),
        freight_delivery INTEGER NOT NULL DEFAULT 0 CHECK (freight_delivery >= 0),
        freight_pickup INTEGER NOT NULL DEFAULT 0 CHECK (freight_pickup >= 0),
        other_fees INTEGER NOT NULL DEFAULT 0 CHECK (other_fees >= 0),
        other_fees_description TEXT,
        deposit_amount INTEGER NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
        late_fee_percent REAL NOT NULL DEFAULT 0 CHECK (late_fee_percent BETWEEN 0 AND 100),
        interest_month_percent REAL NOT NULL DEFAULT 0 CHECK (interest_month_percent BETWEEN 0 AND 100),
        adjustment_index TEXT,
        adjustment_period_months INTEGER,
        responsibilities TEXT NOT NULL DEFAULT '{}',
        payment_terms TEXT,
        special_conditions TEXT,
        installments_count INTEGER NOT NULL DEFAULT 1 CHECK (installments_count BETWEEN 1 AND 60),
        first_due_date TEXT,
        rental_subtotal INTEGER NOT NULL DEFAULT 0,
        period_amount INTEGER NOT NULL DEFAULT 0,
        sale_subtotal INTEGER NOT NULL DEFAULT 0,
        sale_total INTEGER NOT NULL DEFAULT 0,
        one_time_total INTEGER NOT NULL DEFAULT 0,
        estimated_total INTEGER,
        monthly_equivalent INTEGER NOT NULL DEFAULT 0,
        approved_by INTEGER REFERENCES users(id),
        approved_at TEXT,
        signed_at TEXT,
        activated_at TEXT,
        closing_started_at TEXT,
        closed_at TEXT,
        closed_by INTEGER REFERENCES users(id),
        cancelled_at TEXT,
        cancelled_by INTEGER REFERENCES users(id),
        cancellation_reason TEXT,
        row_version INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER NOT NULL REFERENCES users(id),
        updated_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW},
        CHECK (end_date IS NULL OR end_date > start_date),
        CHECK (status != 'cancelado' OR cancellation_reason IS NOT NULL)
      );
      CREATE INDEX ix_contracts_status ON contracts(status);
      CREATE INDEX ix_contracts_customer ON contracts(customer_id);
      CREATE INDEX ix_contracts_end ON contracts(end_date);
      CREATE INDEX ix_contracts_responsible ON contracts(responsible_user_id);

      CREATE TABLE contract_items (
        id INTEGER PRIMARY KEY,
        contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
        position INTEGER NOT NULL,
        item_id INTEGER NOT NULL REFERENCES catalog_items(id),
        asset_id INTEGER REFERENCES stock_assets(id),
        item_code_snapshot TEXT NOT NULL,
        description_snapshot TEXT NOT NULL,
        unit TEXT NOT NULL,
        quantity REAL NOT NULL CHECK (quantity > 0),
        modality TEXT NOT NULL CHECK (modality IN ('locacao','venda')),
        unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
        discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
        line_total INTEGER NOT NULL CHECK (line_total >= 0),
        notes TEXT,
        conditions TEXT,
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX ix_contract_items_contract ON contract_items(contract_id, position);
      CREATE INDEX ix_contract_items_asset ON contract_items(asset_id);

      -- vínculo do estoque com o contrato (as reservas continuam sendo a fonte da disponibilidade)
      ALTER TABLE stock_reservations ADD COLUMN contract_id INTEGER REFERENCES contracts(id);
      ALTER TABLE stock_reservations ADD COLUMN contract_item_id INTEGER REFERENCES contract_items(id);
      CREATE INDEX ix_reservations_contract ON stock_reservations(contract_id, status);

      CREATE TABLE contract_operations (
        id INTEGER PRIMARY KEY,
        contract_id INTEGER NOT NULL REFERENCES contracts(id),
        number TEXT NOT NULL UNIQUE,
        operation_type TEXT NOT NULL CHECK (operation_type IN ('entrega','devolucao')),
        idempotency_key TEXT NOT NULL UNIQUE,
        performed_at TEXT NOT NULL,
        responsible_user_id INTEGER NOT NULL REFERENCES users(id),
        counterpart_name TEXT,
        counterpart_document TEXT,
        accessories TEXT,
        checklist TEXT NOT NULL DEFAULT '{}',
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX ix_contract_ops_contract ON contract_operations(contract_id);

      CREATE TABLE contract_operation_items (
        id INTEGER PRIMARY KEY,
        operation_id INTEGER NOT NULL REFERENCES contract_operations(id),
        contract_item_id INTEGER NOT NULL REFERENCES contract_items(id),
        reservation_id INTEGER REFERENCES stock_reservations(id),
        asset_id INTEGER REFERENCES stock_assets(id),
        quantity REAL NOT NULL CHECK (quantity > 0),
        condition TEXT,
        classification TEXT CHECK (classification IS NULL OR classification IN ('disponivel','aguardando_inspecao','avaria','manutencao')),
        damaged_qty REAL NOT NULL DEFAULT 0,
        maintenance_qty REAL NOT NULL DEFAULT 0,
        missing_qty REAL NOT NULL DEFAULT 0,
        notes TEXT
      );
      CREATE INDEX ix_contract_op_items_op ON contract_operation_items(operation_id);
      CREATE INDEX ix_contract_op_items_item ON contract_operation_items(contract_item_id);

      CREATE TABLE contract_charges (
        id INTEGER PRIMARY KEY,
        contract_id INTEGER NOT NULL REFERENCES contracts(id),
        charge_key TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('periodo','parcela','unico','frete','taxa','venda_item','extra')),
        description TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        due_date TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK (amount > 0),
        status TEXT NOT NULL CHECK (status IN ('gerado','cancelado')),
        financial_entry_id INTEGER UNIQUE REFERENCES financial_entries(id),
        generated_at TEXT NOT NULL DEFAULT ${NOW},
        generated_by INTEGER REFERENCES users(id),
        cancel_reason TEXT,
        cancelled_at TEXT,
        cancelled_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW}
      );
      -- idempotência: o mesmo período/parcela nunca é gerado duas vezes (cancelados não bloqueiam regerar)
      CREATE UNIQUE INDEX ux_contract_charges_key ON contract_charges(contract_id, charge_key) WHERE status != 'cancelado';
      CREATE INDEX ix_contract_charges_contract ON contract_charges(contract_id, due_date);

      CREATE TABLE contract_amendments (
        id INTEGER PRIMARY KEY,
        contract_id INTEGER NOT NULL REFERENCES contracts(id),
        number INTEGER NOT NULL,
        amendment_type TEXT NOT NULL CHECK (amendment_type IN ('prorrogacao','renovacao','reajuste','alteracao')),
        description TEXT NOT NULL,
        reason TEXT NOT NULL,
        previous_end TEXT,
        new_end TEXT,
        previous_amount INTEGER,
        new_amount INTEGER,
        effective_date TEXT,
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        UNIQUE (contract_id, number)
      );

      CREATE TABLE contract_terms (
        id INTEGER PRIMARY KEY,
        contract_id INTEGER NOT NULL REFERENCES contracts(id),
        start_date TEXT NOT NULL,
        end_date TEXT,
        period_amount INTEGER NOT NULL,
        reason TEXT NOT NULL,
        amendment_id INTEGER REFERENCES contract_amendments(id),
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX ix_contract_terms_contract ON contract_terms(contract_id);

      CREATE TABLE contract_documents (
        id INTEGER PRIMARY KEY,
        contract_id INTEGER NOT NULL REFERENCES contracts(id),
        document_type TEXT NOT NULL CHECK (document_type IN ('contrato','aditivo','comprovante_entrega','comprovante_devolucao','anexo')),
        title TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('gerado','enviado','assinado','substituido')),
        snapshot_data TEXT,
        file_name TEXT,
        mime_type TEXT,
        file_data TEXT,
        operation_id INTEGER REFERENCES contract_operations(id),
        amendment_id INTEGER REFERENCES contract_amendments(id),
        issued_at TEXT NOT NULL DEFAULT ${NOW},
        issued_by INTEGER REFERENCES users(id),
        sent_at TEXT,
        sent_channel TEXT,
        signed_at TEXT,
        signed_by_names TEXT,
        signature_method TEXT CHECK (signature_method IS NULL OR signature_method IN ('presencial','digitalizado','plataforma_externa')),
        signature_evidence TEXT,
        signature_provider TEXT,
        external_signature_id TEXT,
        signature_registered_by INTEGER REFERENCES users(id),
        CHECK (status != 'assinado' OR (signed_at IS NOT NULL AND signature_method IS NOT NULL AND signature_evidence IS NOT NULL))
      );
      CREATE INDEX ix_contract_docs_contract ON contract_documents(contract_id, document_type, version);

      CREATE TABLE contract_events (
        id INTEGER PRIMARY KEY,
        contract_id INTEGER NOT NULL REFERENCES contracts(id),
        event_type TEXT NOT NULL,
        previous_status TEXT,
        new_status TEXT,
        description TEXT NOT NULL,
        metadata TEXT,
        performed_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX ix_contract_events_contract ON contract_events(contract_id, id);

      -- histórico não se apaga: contratos com itens, operações, cobranças ou documentos não podem ser excluídos
      CREATE TRIGGER trg_contracts_no_delete BEFORE DELETE ON contracts
      BEGIN SELECT RAISE(ABORT, 'Contratos não são excluídos: use o cancelamento.'); END;
      CREATE TRIGGER trg_contract_events_no_delete BEFORE DELETE ON contract_events
      BEGIN SELECT RAISE(ABORT, 'O histórico do contrato não pode ser apagado.'); END;
      CREATE TRIGGER trg_contract_events_no_update BEFORE UPDATE ON contract_events
      BEGIN SELECT RAISE(ABORT, 'O histórico do contrato não pode ser alterado.'); END;
      CREATE TRIGGER trg_contract_ops_no_delete BEFORE DELETE ON contract_operations
      BEGIN SELECT RAISE(ABORT, 'Entregas e devoluções registradas não são excluídas.'); END;
      CREATE TRIGGER trg_contract_charges_no_delete BEFORE DELETE ON contract_charges
      BEGIN SELECT RAISE(ABORT, 'Cobranças são canceladas, não excluídas.'); END;
      CREATE TRIGGER trg_contract_docs_no_delete BEFORE DELETE ON contract_documents
      BEGIN SELECT RAISE(ABORT, 'Documentos emitidos não são excluídos.'); END;
    `,
  },
  {
    version: 5,
    name: 'modulo_ordens_servico',
    fkOff: true, // recria users com o perfil "tecnico"
    sql: `
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin','gestor','vendedor','estoquista','financeiro','tecnico','consulta')),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW}
      );
      INSERT INTO users_new SELECT id, name, email, password_hash, role, active, created_at, updated_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;

      CREATE TABLE checklist_templates (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT,
        items TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW}
      );

      CREATE TABLE maintenance_plans (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        asset_id INTEGER REFERENCES stock_assets(id),
        category TEXT,
        interval_days INTEGER CHECK (interval_days IS NULL OR interval_days BETWEEN 1 AND 3650),
        interval_hours REAL CHECK (interval_hours IS NULL OR interval_hours > 0),
        interval_cycles REAL CHECK (interval_cycles IS NULL OR interval_cycles > 0),
        checklist_template_id INTEGER REFERENCES checklist_templates(id),
        responsible_user_id INTEGER REFERENCES users(id),
        estimated_minutes INTEGER,
        lead_days INTEGER NOT NULL DEFAULT 7 CHECK (lead_days BETWEEN 0 AND 90),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW},
        CHECK ((asset_id IS NULL) != (category IS NULL)),
        CHECK (interval_days IS NOT NULL OR interval_hours IS NOT NULL OR interval_cycles IS NOT NULL)
      );

      CREATE TABLE maintenance_schedules (
        id INTEGER PRIMARY KEY,
        plan_id INTEGER NOT NULL REFERENCES maintenance_plans(id),
        asset_id INTEGER NOT NULL REFERENCES stock_assets(id),
        last_done_at TEXT,
        last_meter REAL,
        next_due_date TEXT,
        next_due_meter REAL,
        updated_at TEXT NOT NULL DEFAULT ${NOW},
        UNIQUE (plan_id, asset_id)
      );

      CREATE TABLE asset_meter_readings (
        id INTEGER PRIMARY KEY,
        asset_id INTEGER NOT NULL REFERENCES stock_assets(id),
        kind TEXT NOT NULL CHECK (kind IN ('horas','ciclos')),
        reading REAL NOT NULL CHECK (reading >= 0),
        read_at TEXT NOT NULL,
        work_order_id INTEGER,
        recorded_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX ix_meter_asset ON asset_meter_readings(asset_id, kind, id);

      CREATE TABLE work_orders (
        id INTEGER PRIMARY KEY,
        order_number TEXT NOT NULL UNIQUE,
        asset_id INTEGER NOT NULL REFERENCES stock_assets(id),
        asset_snapshot TEXT NOT NULL,
        contract_id INTEGER REFERENCES contracts(id),
        customer_id INTEGER REFERENCES customers(id),
        plan_id INTEGER REFERENCES maintenance_plans(id),
        plan_due_key TEXT,
        order_type TEXT NOT NULL,
        origin TEXT NOT NULL CHECK (origin IN ('interna','cliente','devolucao','preventiva','contrato','outra')),
        requester TEXT,
        responsible_user_id INTEGER REFERENCES users(id),
        priority TEXT NOT NULL CHECK (priority IN ('baixa','media','alta','urgente')),
        status TEXT NOT NULL CHECK (status IN ('aberta','aguardando_avaliacao','aguardando_aprovacao','aguardando_pecas','aguardando_fornecedor','programada','em_execucao','em_testes','concluida','cancelada')),
        status_since TEXT NOT NULL DEFAULT ${NOW},
        title TEXT NOT NULL,
        description TEXT,
        symptoms TEXT,
        defect_category TEXT,
        probable_cause TEXT,
        diagnosis TEXT,
        root_cause TEXT,
        requested_service TEXT,
        procedures TEXT,
        operational_risk TEXT NOT NULL DEFAULT 'baixo' CHECK (operational_risk IN ('nenhum','baixo','medio','alto')),
        blocks_equipment INTEGER NOT NULL DEFAULT 0 CHECK (blocks_equipment IN (0,1)),
        blocked_previous_status TEXT,
        requires_checklist INTEGER NOT NULL DEFAULT 0 CHECK (requires_checklist IN (0,1)),
        due_date TEXT,
        scheduled_at TEXT,
        test_result TEXT,
        safety_notes TEXT,
        recommendations TEXT,
        notes TEXT,
        meter_reading REAL,
        estimated_labor INTEGER NOT NULL DEFAULT 0 CHECK (estimated_labor >= 0),
        estimated_other INTEGER NOT NULL DEFAULT 0 CHECK (estimated_other >= 0),
        actual_other INTEGER NOT NULL DEFAULT 0 CHECK (actual_other >= 0),
        actual_other_description TEXT,
        estimated_cost INTEGER NOT NULL DEFAULT 0,
        actual_cost INTEGER NOT NULL DEFAULT 0,
        cost_approved_by INTEGER REFERENCES users(id),
        cost_approved_at TEXT,
        approved_estimate INTEGER,
        wait_evaluation_min INTEGER NOT NULL DEFAULT 0,
        wait_approval_min INTEGER NOT NULL DEFAULT 0,
        wait_parts_min INTEGER NOT NULL DEFAULT 0,
        wait_supplier_min INTEGER NOT NULL DEFAULT 0,
        execution_min INTEGER NOT NULL DEFAULT 0,
        testing_min INTEGER NOT NULL DEFAULT 0,
        opened_at TEXT NOT NULL DEFAULT ${NOW},
        started_at TEXT,
        completed_at TEXT,
        downtime_start TEXT,
        downtime_end TEXT,
        cancelled_at TEXT,
        cancellation_reason TEXT,
        row_version INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER NOT NULL REFERENCES users(id),
        updated_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW},
        CHECK (status != 'cancelada' OR cancellation_reason IS NOT NULL)
      );
      CREATE INDEX ix_wo_status ON work_orders(status);
      CREATE INDEX ix_wo_asset ON work_orders(asset_id, status);
      CREATE INDEX ix_wo_opened ON work_orders(opened_at);
      -- uma OS por evento de preventiva (plano + equipamento + vencimento)
      CREATE UNIQUE INDEX ux_wo_plan_due ON work_orders(plan_id, asset_id, plan_due_key) WHERE plan_id IS NOT NULL;

      CREATE TABLE work_order_activities (
        id INTEGER PRIMARY KEY,
        work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
        description TEXT NOT NULL,
        technician_user_id INTEGER REFERENCES users(id),
        technician_name TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
        hourly_rate INTEGER NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0),
        labor_cost INTEGER NOT NULL DEFAULT 0 CHECK (labor_cost >= 0),
        notes TEXT,
        voided INTEGER NOT NULL DEFAULT 0 CHECK (voided IN (0,1)),
        void_reason TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        CHECK (ended_at > started_at)
      );
      CREATE INDEX ix_wo_act ON work_order_activities(work_order_id);

      CREATE TABLE work_order_materials (
        id INTEGER PRIMARY KEY,
        work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
        item_id INTEGER NOT NULL REFERENCES catalog_items(id),
        description_snapshot TEXT NOT NULL,
        quantity_requested REAL NOT NULL CHECK (quantity_requested >= 0),
        quantity_reserved REAL NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
        quantity_withdrawn REAL NOT NULL DEFAULT 0 CHECK (quantity_withdrawn >= 0),
        quantity_returned REAL NOT NULL DEFAULT 0 CHECK (quantity_returned >= 0),
        quantity_used REAL NOT NULL DEFAULT 0 CHECK (quantity_used >= 0),
        location_id INTEGER REFERENCES stock_locations(id),
        withdrawn_cost INTEGER NOT NULL DEFAULT 0,
        estimated_unit_cost INTEGER,
        status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','cancelado')),
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW},
        CHECK (quantity_returned + quantity_used <= quantity_withdrawn + 0.0000001)
      );
      CREATE INDEX ix_wo_mat ON work_order_materials(work_order_id);

      CREATE TABLE work_order_material_moves (
        id INTEGER PRIMARY KEY,
        material_id INTEGER NOT NULL REFERENCES work_order_materials(id),
        move_type TEXT NOT NULL CHECK (move_type IN ('reserva','liberacao','retirada','utilizacao','devolucao')),
        quantity REAL NOT NULL CHECK (quantity > 0),
        location_id INTEGER REFERENCES stock_locations(id),
        stock_movement_id INTEGER REFERENCES stock_movements(id),
        idempotency_key TEXT UNIQUE,
        notes TEXT,
        performed_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX ix_wo_mat_moves ON work_order_material_moves(material_id);

      CREATE TABLE work_order_services (
        id INTEGER PRIMARY KEY,
        work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
        description TEXT NOT NULL,
        supplier_document TEXT,
        estimated_cost INTEGER NOT NULL CHECK (estimated_cost >= 0),
        approved_cost INTEGER CHECK (approved_cost IS NULL OR approved_cost >= 0),
        actual_cost INTEGER CHECK (actual_cost IS NULL OR actual_cost >= 0),
        expected_date TEXT,
        completed_date TEXT,
        status TEXT NOT NULL CHECK (status IN ('pendente_aprovacao','aprovado','reprovado','concluido','cancelado')),
        approved_by INTEGER REFERENCES users(id),
        approved_at TEXT,
        financial_entry_id INTEGER UNIQUE REFERENCES financial_entries(id),
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX ix_wo_srv ON work_order_services(work_order_id);

      CREATE TABLE work_order_checklist (
        id INTEGER PRIMARY KEY,
        work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
        position INTEGER NOT NULL,
        label TEXT NOT NULL,
        required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)),
        result TEXT CHECK (result IS NULL OR result IN ('aprovado','reprovado','nao_aplicavel')),
        notes TEXT,
        answered_by INTEGER REFERENCES users(id),
        answered_at TEXT
      );
      CREATE INDEX ix_wo_chk ON work_order_checklist(work_order_id, position);

      CREATE TABLE work_order_attachments (
        id INTEGER PRIMARY KEY,
        work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_data TEXT NOT NULL,
        uploaded_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX ix_wo_att ON work_order_attachments(work_order_id);

      CREATE TABLE work_order_events (
        id INTEGER PRIMARY KEY,
        work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
        event_type TEXT NOT NULL,
        previous_status TEXT,
        new_status TEXT,
        description TEXT NOT NULL,
        metadata TEXT,
        performed_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX ix_wo_events ON work_order_events(work_order_id, id);

      -- histórico operacional preservado: correções por cancelamento/estorno, nunca exclusão
      CREATE TRIGGER trg_wo_no_delete BEFORE DELETE ON work_orders BEGIN SELECT RAISE(ABORT, 'Ordens de serviço não são excluídas: use o cancelamento.'); END;
      CREATE TRIGGER trg_wo_events_no_delete BEFORE DELETE ON work_order_events BEGIN SELECT RAISE(ABORT, 'O histórico da OS não pode ser apagado.'); END;
      CREATE TRIGGER trg_wo_events_no_update BEFORE UPDATE ON work_order_events BEGIN SELECT RAISE(ABORT, 'O histórico da OS não pode ser alterado.'); END;
      CREATE TRIGGER trg_wo_moves_no_delete BEFORE DELETE ON work_order_material_moves BEGIN SELECT RAISE(ABORT, 'Movimentações de material não são excluídas.'); END;
      CREATE TRIGGER trg_wo_act_no_delete BEFORE DELETE ON work_order_activities BEGIN SELECT RAISE(ABORT, 'Atividades são estornadas, não excluídas.'); END;
      CREATE TRIGGER trg_wo_mat_no_delete BEFORE DELETE ON work_order_materials BEGIN SELECT RAISE(ABORT, 'Materiais são cancelados, não excluídos.'); END;
      CREATE TRIGGER trg_wo_srv_no_delete BEFORE DELETE ON work_order_services BEGIN SELECT RAISE(ABORT, 'Serviços são cancelados, não excluídos.'); END;
      CREATE TRIGGER trg_wo_att_no_delete BEFORE DELETE ON work_order_attachments BEGIN SELECT RAISE(ABORT, 'Anexos não são excluídos.'); END;
      CREATE TRIGGER trg_wo_closed_lock BEFORE UPDATE ON work_orders
        WHEN OLD.status IN ('concluida','cancelada') AND (NEW.status != OLD.status OR NEW.diagnosis IS NOT OLD.diagnosis OR NEW.actual_cost != OLD.actual_cost OR NEW.asset_snapshot != OLD.asset_snapshot)
      BEGIN SELECT RAISE(ABORT, 'OS encerrada não é alterada.'); END;
    `,
  },
  {
    version: 6,
    name: 'modulo_entregas_devolucoes',
    sql: `
      CREATE TABLE logistics_drivers (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        document TEXT,
        phone TEXT,
        user_id INTEGER REFERENCES users(id),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );

      CREATE TABLE logistics_vehicles (
        id INTEGER PRIMARY KEY,
        plate TEXT NOT NULL UNIQUE COLLATE NOCASE,
        description TEXT NOT NULL,
        capacity TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );

      CREATE TABLE logistics_orders (
        id INTEGER PRIMARY KEY,
        number TEXT NOT NULL UNIQUE,
        op_type TEXT NOT NULL CHECK (op_type IN ('entrega','retirada','devolucao')),
        status TEXT NOT NULL CHECK (status IN ('rascunho','programada','em_separacao','pronta','em_transporte','entregue_parcialmente','entregue','em_andamento','recebida_parcialmente','recebida','aguardando_inspecao','em_conferencia','concluida','cancelada')),
        reason TEXT CHECK (reason IS NULL OR reason IN ('fim_contrato','antecipada','substituicao','manutencao','outra')),
        contract_id INTEGER NOT NULL REFERENCES contracts(id),
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        scheduled_at TEXT NOT NULL,
        address TEXT,
        contact_name TEXT,
        contact_phone TEXT,
        access_instructions TEXT,
        special_equipment TEXT,
        transport_type TEXT NOT NULL DEFAULT 'proprio' CHECK (transport_type IN ('proprio','terceiro','cliente')),
        driver_id INTEGER REFERENCES logistics_drivers(id),
        vehicle_id INTEGER REFERENCES logistics_vehicles(id),
        carrier_supplier_id INTEGER REFERENCES suppliers(id),
        responsible_user_id INTEGER REFERENCES users(id),
        origin_address TEXT,
        return_location_id INTEGER REFERENCES stock_locations(id),
        separated_by INTEGER REFERENCES users(id),
        separated_at TEXT,
        separation_checklist TEXT NOT NULL DEFAULT '{}',
        accessories TEXT,
        departed_at TEXT,
        arrived_at TEXT,
        completed_at TEXT,
        receiver_name TEXT,
        receiver_document TEXT,
        transport_notes TEXT,
        transport_cost_estimated INTEGER CHECK (transport_cost_estimated IS NULL OR transport_cost_estimated >= 0),
        transport_cost_actual INTEGER CHECK (transport_cost_actual IS NULL OR transport_cost_actual >= 0),
        transport_entry_id INTEGER UNIQUE REFERENCES financial_entries(id),
        contract_operation_id INTEGER UNIQUE REFERENCES contract_operations(id),
        notes TEXT,
        cancel_reason TEXT,
        cancelled_at TEXT,
        row_version INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER NOT NULL REFERENCES users(id),
        updated_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW},
        CHECK (status != 'cancelada' OR cancel_reason IS NOT NULL),
        CHECK (op_type = 'entrega' OR reason IS NOT NULL)
      );
      CREATE INDEX ix_log_orders_status ON logistics_orders(op_type, status);
      CREATE INDEX ix_log_orders_contract ON logistics_orders(contract_id);
      CREATE INDEX ix_log_orders_scheduled ON logistics_orders(scheduled_at);

      CREATE TABLE logistics_order_items (
        id INTEGER PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES logistics_orders(id),
        contract_item_id INTEGER NOT NULL REFERENCES contract_items(id),
        asset_id INTEGER REFERENCES stock_assets(id),
        quantity_original REAL NOT NULL CHECK (quantity_original > 0),
        quantity_planned REAL NOT NULL CHECK (quantity_planned >= 0),
        quantity_separated REAL NOT NULL DEFAULT 0 CHECK (quantity_separated >= 0),
        quantity_processed REAL NOT NULL DEFAULT 0 CHECK (quantity_processed >= 0),
        quantity_missing REAL NOT NULL DEFAULT 0 CHECK (quantity_missing >= 0),
        quantity_inspected REAL NOT NULL DEFAULT 0 CHECK (quantity_inspected >= 0),
        condition_before TEXT,
        condition_after TEXT,
        adjust_reason TEXT,
        notes TEXT,
        UNIQUE (order_id, contract_item_id)
      );

      CREATE TABLE logistics_inspections (
        id INTEGER PRIMARY KEY,
        order_item_id INTEGER NOT NULL REFERENCES logistics_order_items(id),
        asset_id INTEGER REFERENCES stock_assets(id),
        quantity REAL NOT NULL CHECK (quantity > 0),
        result TEXT NOT NULL CHECK (result IN ('aprovado','aguardando_inspecao','avaria','incompleto','manutencao','bloqueado')),
        checklist TEXT NOT NULL DEFAULT '{}',
        condition TEXT,
        damage_detected INTEGER NOT NULL DEFAULT 0 CHECK (damage_detected IN (0,1)),
        notes TEXT,
        work_order_id INTEGER REFERENCES work_orders(id),
        inspected_by INTEGER NOT NULL REFERENCES users(id),
        inspected_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX ix_log_insp_item ON logistics_inspections(order_item_id);

      CREATE TABLE logistics_occurrences (
        id INTEGER PRIMARY KEY,
        number TEXT NOT NULL UNIQUE,
        order_id INTEGER REFERENCES logistics_orders(id),
        order_item_id INTEGER REFERENCES logistics_order_items(id),
        contract_id INTEGER NOT NULL REFERENCES contracts(id),
        asset_id INTEGER REFERENCES stock_assets(id),
        item_id INTEGER REFERENCES catalog_items(id),
        occurrence_type TEXT NOT NULL CHECK (occurrence_type IN ('avaria','perda','acessorio_faltante','incompleto','divergencia','transporte','outro')),
        description TEXT NOT NULL,
        estimated_cost INTEGER CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
        approved_cost INTEGER CHECK (approved_cost IS NULL OR approved_cost >= 0),
        responsibility TEXT NOT NULL DEFAULT 'indefinida' CHECK (responsibility IN ('indefinida','cliente','empresa','terceiro')),
        status TEXT NOT NULL CHECK (status IN ('registrada','em_analise','aguardando_orcamento','aguardando_aprovacao','aprovada_cobranca','nao_cobravel','encaminhada_manutencao','resolvida')),
        analysis_notes TEXT,
        resolution_notes TEXT,
        work_order_id INTEGER REFERENCES work_orders(id),
        contract_charge_id INTEGER UNIQUE REFERENCES contract_charges(id),
        registered_by INTEGER NOT NULL REFERENCES users(id),
        approved_by INTEGER REFERENCES users(id),
        approved_at TEXT,
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW},
        CHECK (status != 'aprovada_cobranca' OR (approved_cost IS NOT NULL AND responsibility = 'cliente'))
      );
      CREATE INDEX ix_log_occ_status ON logistics_occurrences(status);
      CREATE INDEX ix_log_occ_contract ON logistics_occurrences(contract_id);

      CREATE TABLE logistics_attachments (
        id INTEGER PRIMARY KEY,
        order_id INTEGER REFERENCES logistics_orders(id),
        occurrence_id INTEGER REFERENCES logistics_occurrences(id),
        phase TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'foto',
        title TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_data TEXT NOT NULL,
        uploaded_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        CHECK (order_id IS NOT NULL OR occurrence_id IS NOT NULL)
      );
      CREATE INDEX ix_log_att_order ON logistics_attachments(order_id);
      CREATE INDEX ix_log_att_occ ON logistics_attachments(occurrence_id);

      CREATE TABLE logistics_events (
        id INTEGER PRIMARY KEY,
        order_id INTEGER REFERENCES logistics_orders(id),
        occurrence_id INTEGER REFERENCES logistics_occurrences(id),
        event_type TEXT NOT NULL,
        previous_status TEXT,
        new_status TEXT,
        description TEXT NOT NULL,
        performed_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX ix_log_events_order ON logistics_events(order_id, id);
      CREATE INDEX ix_log_events_occ ON logistics_events(occurrence_id, id);

      CREATE TRIGGER trg_log_orders_no_delete BEFORE DELETE ON logistics_orders BEGIN SELECT RAISE(ABORT, 'Operações não são excluídas: use o cancelamento.'); END;
      CREATE TRIGGER trg_log_items_no_delete BEFORE DELETE ON logistics_order_items BEGIN SELECT RAISE(ABORT, 'Itens da operação não são excluídos.'); END;
      CREATE TRIGGER trg_log_insp_no_delete BEFORE DELETE ON logistics_inspections BEGIN SELECT RAISE(ABORT, 'Inspeções registradas não são excluídas.'); END;
      CREATE TRIGGER trg_log_occ_no_delete BEFORE DELETE ON logistics_occurrences BEGIN SELECT RAISE(ABORT, 'Ocorrências não são excluídas.'); END;
      CREATE TRIGGER trg_log_att_no_delete BEFORE DELETE ON logistics_attachments BEGIN SELECT RAISE(ABORT, 'Anexos não são excluídos.'); END;
      CREATE TRIGGER trg_log_events_no_delete BEFORE DELETE ON logistics_events BEGIN SELECT RAISE(ABORT, 'O histórico não pode ser apagado.'); END;
      CREATE TRIGGER trg_log_events_no_update BEFORE UPDATE ON logistics_events BEGIN SELECT RAISE(ABORT, 'O histórico não pode ser alterado.'); END;
      CREATE TRIGGER trg_log_done_lock BEFORE UPDATE OF status ON logistics_orders
        WHEN OLD.status IN ('entregue','entregue_parcialmente','concluida','cancelada') AND NEW.status != OLD.status
      BEGIN SELECT RAISE(ABORT, 'Operação encerrada não muda de status. Correções por nova operação.'); END;
    `,
  },
  {
    version: 7,
    name: 'modulo_notificacoes',
    sql: `
      CREATE TABLE notifications (
        id INTEGER PRIMARY KEY,
        event_type TEXT NOT NULL,
        event_key TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL CHECK (category IN ('contratos','financeiro','estoque','manutencao','logistica','orcamentos','sistema')),
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        priority TEXT NOT NULL CHECK (priority IN ('baixa','media','alta','critica')),
        source_module TEXT NOT NULL,
        source_type TEXT,
        source_id INTEGER,
        link TEXT,
        stateful INTEGER NOT NULL DEFAULT 1 CHECK (stateful IN (0,1)),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        resolved_at TEXT,
        expires_at TEXT
      );
      CREATE INDEX ix_notif_type ON notifications(event_type, resolved_at);
      CREATE INDEX ix_notif_created ON notifications(created_at);

      CREATE TABLE notification_recipients (
        id INTEGER PRIMARY KEY,
        notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        read_at TEXT,
        delivery_status TEXT NOT NULL DEFAULT 'central' CHECK (delivery_status IN ('central','pendente','enviado','falhou')),
        delivered_at TEXT NOT NULL DEFAULT ${NOW},
        UNIQUE (notification_id, user_id)
      );
      CREATE INDEX ix_notif_rec_user ON notification_recipients(user_id, read_at);

      CREATE TABLE notification_settings (
        event_type TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
        leads TEXT,
        inactivity_days INTEGER CHECK (inactivity_days IS NULL OR inactivity_days BETWEEN 0 AND 365),
        roles TEXT NOT NULL DEFAULT '[]',
        notify_responsible INTEGER NOT NULL DEFAULT 1 CHECK (notify_responsible IN (0,1)),
        channels TEXT NOT NULL DEFAULT '["central"]',
        updated_by INTEGER REFERENCES users(id),
        updated_at TEXT NOT NULL DEFAULT ${NOW}
      );

      CREATE TABLE notification_user_prefs (
        user_id INTEGER NOT NULL REFERENCES users(id),
        category TEXT NOT NULL,
        muted INTEGER NOT NULL DEFAULT 1 CHECK (muted IN (0,1)),
        PRIMARY KEY (user_id, category)
      );

      CREATE TABLE notification_processing_logs (
        id INTEGER PRIMARY KEY,
        job_type TEXT NOT NULL,
        trigger TEXT NOT NULL CHECK (trigger IN ('agendado','manual','evento','inicializacao')),
        started_at TEXT NOT NULL DEFAULT ${NOW},
        finished_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('executando','sucesso','parcial','erro')),
        created_count INTEGER NOT NULL DEFAULT 0,
        delivered_count INTEGER NOT NULL DEFAULT 0,
        resolved_count INTEGER NOT NULL DEFAULT 0,
        error_summary TEXT,
        triggered_by INTEGER REFERENCES users(id)
      );
      CREATE INDEX ix_notif_logs ON notification_processing_logs(started_at);
    `,
  },
  {
    version: 8,
    name: 'contrato_rascunho_excluivel',
    // só contratos nunca formalizados (rascunho / aguardando aprovação) podem ser excluídos;
    // operações, cobranças e documentos continuam sem exclusão nenhuma
    sql: `
      DROP TRIGGER trg_contracts_no_delete;
      CREATE TRIGGER trg_contracts_no_delete BEFORE DELETE ON contracts
      WHEN OLD.status NOT IN ('rascunho','aguardando_aprovacao')
      BEGIN SELECT RAISE(ABORT, 'Contratos formalizados não são excluídos: use o cancelamento.'); END;
      DROP TRIGGER trg_contract_events_no_delete;
      CREATE TRIGGER trg_contract_events_no_delete BEFORE DELETE ON contract_events
      WHEN COALESCE((SELECT status FROM contracts WHERE id = OLD.contract_id), '') NOT IN ('rascunho','aguardando_aprovacao')
      BEGIN SELECT RAISE(ABORT, 'O histórico do contrato não pode ser apagado.'); END;
    `,
  },
  {
    version: 9,
    name: 'contrato_exclusao_admin',
    // o admin pode excluir contrato formalizado sem movimentação: a exclusão marca o contrato em
    // contract_purges dentro da transação e só então as travas liberam; fora disso, tudo segue protegido
    sql: `
      CREATE TABLE contract_purges (contract_id INTEGER PRIMARY KEY);
      DROP TRIGGER trg_contracts_no_delete;
      CREATE TRIGGER trg_contracts_no_delete BEFORE DELETE ON contracts
      WHEN OLD.status NOT IN ('rascunho','aguardando_aprovacao') AND NOT EXISTS (SELECT 1 FROM contract_purges WHERE contract_id = OLD.id)
      BEGIN SELECT RAISE(ABORT, 'Contratos formalizados não são excluídos: use o cancelamento.'); END;
      DROP TRIGGER trg_contract_events_no_delete;
      CREATE TRIGGER trg_contract_events_no_delete BEFORE DELETE ON contract_events
      WHEN COALESCE((SELECT status FROM contracts WHERE id = OLD.contract_id), '') NOT IN ('rascunho','aguardando_aprovacao') AND NOT EXISTS (SELECT 1 FROM contract_purges WHERE contract_id = OLD.contract_id)
      BEGIN SELECT RAISE(ABORT, 'O histórico do contrato não pode ser apagado.'); END;
      DROP TRIGGER trg_contract_charges_no_delete;
      CREATE TRIGGER trg_contract_charges_no_delete BEFORE DELETE ON contract_charges
      WHEN NOT EXISTS (SELECT 1 FROM contract_purges WHERE contract_id = OLD.contract_id)
      BEGIN SELECT RAISE(ABORT, 'Cobranças são canceladas, não excluídas.'); END;
      DROP TRIGGER trg_contract_docs_no_delete;
      CREATE TRIGGER trg_contract_docs_no_delete BEFORE DELETE ON contract_documents
      WHEN NOT EXISTS (SELECT 1 FROM contract_purges WHERE contract_id = OLD.contract_id)
      BEGIN SELECT RAISE(ABORT, 'Documentos emitidos não são excluídos.'); END;
    `,
  },
  {
    version: 10,
    name: 'contrato_documento_excluivel',
    // exclusão de um documento avulso (anexo, versão não assinada, comprovante): o serviço marca o
    // documento em contract_document_purges dentro da transação; documento assinado nunca sai
    sql: `
      CREATE TABLE contract_document_purges (document_id INTEGER PRIMARY KEY);
      DROP TRIGGER trg_contract_docs_no_delete;
      CREATE TRIGGER trg_contract_docs_no_delete BEFORE DELETE ON contract_documents
      WHEN NOT EXISTS (SELECT 1 FROM contract_purges WHERE contract_id = OLD.contract_id)
        AND (OLD.status = 'assinado' OR NOT EXISTS (SELECT 1 FROM contract_document_purges WHERE document_id = OLD.id))
      BEGIN SELECT RAISE(ABORT, 'Documentos emitidos não são excluídos.'); END;
    `,
  },
  {
    version: 11,
    name: 'orcamento_manutencao',
    // orçamento de manutenção = venda de serviço (peças + mão de obra) com os dados do equipamento do cliente
    sql: `
      ALTER TABLE quotations ADD COLUMN category TEXT NOT NULL DEFAULT 'comercial' CHECK (category IN ('comercial','manutencao'));
      ALTER TABLE quotations ADD COLUMN equipment_info TEXT;
      CREATE INDEX ix_quotations_category ON quotations(category);
    `,
  },
  {
    version: 12,
    name: 'usuario_abas',
    // abas que o usuário acessa (JSON); NULL = todas as que o perfil permite
    sql: `ALTER TABLE users ADD COLUMN modules TEXT;`,
  },
  {
    version: 13,
    name: 'contrato_cobranca_unica',
    // locação com término: 1 = todo o valor da vigência numa única cobrança no início
    sql: `ALTER TABLE contracts ADD COLUMN single_charge INTEGER NOT NULL DEFAULT 0 CHECK (single_charge IN (0,1));`,
  },
  {
    version: 14,
    name: 'contrato_cobranca_unica_sempre',
    // locação com término passa a ser sempre cobrança única; contratos com cobranças por período ativas ficam como estão
    sql: `UPDATE contracts SET single_charge = 1
          WHERE contract_type = 'locacao' AND end_date IS NOT NULL AND billing_frequency != 'unico' AND single_charge = 0
            AND NOT EXISTS (SELECT 1 FROM contract_charges cc WHERE cc.contract_id = contracts.id AND cc.kind = 'periodo' AND cc.status != 'cancelado');`,
  },
];

export function openDatabase(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function migrate(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT ${NOW})`);
  const applied = new Set((db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    // PRAGMA foreign_keys só muda fora de transação; a integridade é conferida antes do COMMIT
    if (m.fkOff) db.exec('PRAGMA foreign_keys = OFF');
    try {
      transaction(db, () => {
        db.exec(m.sql);
        if (m.fkOff) {
          const broken = db.prepare('PRAGMA foreign_key_check').all();
          if (broken.length) throw new Error(`Migração ${m.version}: ${broken.length} referência(s) inválida(s).`);
        }
        db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
      });
    } finally {
      if (m.fkOff) db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

/** Executa fn em transação exclusiva de escrita (BEGIN IMMEDIATE); desfaz tudo em caso de erro. */
export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Próximo valor de um contador, dentro da transação corrente (sem duplicidade). */
export function nextCounter(db: DB, name: string): number {
  const row = db.prepare('UPDATE counters SET value = value + 1 WHERE name = ? RETURNING value').get(name) as { value: number } | undefined;
  if (row) return row.value;
  db.prepare('INSERT INTO counters (name, value) VALUES (?, 1)').run(name);
  return 1;
}

export function audit(db: DB, entity: string, entityId: string | number, action: string, userId: number | null, data?: unknown) {
  db.prepare('INSERT INTO audit_log (entity, entity_id, action, user_id, data) VALUES (?, ?, ?, ?, ?)').run(
    entity,
    String(entityId),
    action,
    userId,
    data === undefined ? null : JSON.stringify(data)
  );
}
