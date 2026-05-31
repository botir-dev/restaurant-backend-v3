-- ============================================================
-- RESTORAN BOSHQARUV TIZIMI — Ma'lumotlar bazasi sxemasi
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ENUM turlari
CREATE TYPE user_role AS ENUM (
  'super_admin', 'manager', 'waiter', 'cashier',
  'storekeeper', 'cook', 'baker', 'somsa_maker',
  'grill_master', 'turkish_cook', 'bartender',
  'icecream_maker', 'tea_master'
);

CREATE TYPE product_type AS ENUM (
  'food', 'bread', 'somsa', 'grill',
  'turkish', 'drink', 'icecream', 'tea', 'other'
);

CREATE TYPE order_status AS ENUM (
  'pending', 'preparing', 'ready_to_serve', 'payment_pending', 'paid', 'cancelled'
);

CREATE TYPE payment_type AS ENUM ('cash', 'card', 'qr_payment');

-- ============================================================
-- RESTORANLAR
-- ============================================================
CREATE TABLE restaurants (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(200) NOT NULL,
  address     TEXT,
  logo_url    TEXT,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- FILIALLAR
-- ============================================================
CREATE TABLE branches (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name          VARCHAR(200) NOT NULL,
  address       TEXT,
  phone         VARCHAR(20),
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- FOYDALANUVCHILAR (barcha rollar)
-- ============================================================
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id     UUID REFERENCES restaurants(id) ON DELETE CASCADE,
  branch_id         UUID REFERENCES branches(id) ON DELETE CASCADE,
  full_name         VARCHAR(200) NOT NULL,
  username          VARCHAR(100) NOT NULL,
  phone             VARCHAR(20),
  password_hash     TEXT NOT NULL,
  role              user_role NOT NULL,
  extra_permissions product_type[] DEFAULT '{}',
  is_active         BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW(),
  -- Super admin uchun restaurant_id va branch_id NULL bo'lishi mumkin
  UNIQUE (restaurant_id, branch_id, username)
);

-- ============================================================
-- REFRESH TOKENLAR
-- ============================================================
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMP NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- MAHSULOTLAR
-- ============================================================
CREATE TABLE products (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  branch_id     UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name          VARCHAR(200) NOT NULL,
  price         DECIMAL(12, 2) NOT NULL DEFAULT 0,
  type          product_type NOT NULL,
  is_available  BOOLEAN DEFAULT TRUE,
  image_url     TEXT NOT NULL,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- STOLLAR
-- ============================================================
CREATE TABLE tables (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id    UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  branch_id        UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  table_number     INTEGER NOT NULL,
  capacity         INTEGER NOT NULL DEFAULT 4,
  is_occupied      BOOLEAN DEFAULT FALSE,
  current_order_id UUID,
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW(),
  UNIQUE (branch_id, table_number)
);

-- ============================================================
-- BRONLAR (Reservations)
-- ============================================================
CREATE TABLE reservations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  branch_id     UUID NOT NULL REFERENCES branches(id),
  table_id      UUID NOT NULL REFERENCES tables(id),
  created_by    UUID NOT NULL REFERENCES users(id),
  full_name     VARCHAR(200) NOT NULL,
  phone         VARCHAR(20) NOT NULL,
  reserved_at   TIMESTAMP NOT NULL,
  duration_min  INTEGER NOT NULL DEFAULT 60,  -- daqiqada
  guest_count   INTEGER NOT NULL DEFAULT 1,
  status        VARCHAR(20) DEFAULT 'active', -- active, cancelled, completed
  cancel_reason VARCHAR(20),                  -- auto_cancel, manual
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- BUYURTMALAR
-- ============================================================
-- order_type: table (oddiy stol), takeaway (saboy), delivery (dostavka)
CREATE TYPE order_type_enum AS ENUM ('table', 'takeaway', 'delivery');

CREATE TABLE orders (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id       UUID NOT NULL REFERENCES restaurants(id),
  branch_id           UUID NOT NULL REFERENCES branches(id),
  table_id            UUID NOT NULL REFERENCES tables(id),
  waiter_id           UUID NOT NULL REFERENCES users(id),
  guest_count         INTEGER NOT NULL DEFAULT 1,
  status              order_status DEFAULT 'pending',
  is_from_qr          BOOLEAN DEFAULT FALSE,
  order_type          order_type_enum NOT NULL DEFAULT 'table',
  items               JSONB NOT NULL DEFAULT '[]',
  sent_to_kitchen_at  TIMESTAMP,
  paid_at             TIMESTAMP,
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
);
-- items massivining har bir elementi:
-- { product_id, name, price, type, quantity, is_prepared }

-- tables jadvaliga foreign key qo'shish (circular dependency uchun)
ALTER TABLE tables ADD CONSTRAINT fk_current_order
  FOREIGN KEY (current_order_id) REFERENCES orders(id) ON DELETE SET NULL;

-- ============================================================
-- ARXIV (yopilgan buyurtmalar)
-- ============================================================
CREATE TABLE order_archive (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        UUID NOT NULL,
  restaurant_id   UUID NOT NULL,
  branch_id       UUID NOT NULL,
  table_number    INTEGER NOT NULL,
  waiter_id       UUID,
  waiter_name     VARCHAR(200),
  cashier_id      UUID,
  cashier_name    VARCHAR(200),
  guest_count     INTEGER,
  items           JSONB NOT NULL DEFAULT '[]',
  total_amount    DECIMAL(12, 2) NOT NULL DEFAULT 0,
  payment_type    payment_type,
  is_from_qr      BOOLEAN DEFAULT FALSE,
  order_type      order_type_enum NOT NULL DEFAULT 'table',
  service_started TIMESTAMP,
  service_ended   TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- INDEKSLAR
-- ============================================================
CREATE INDEX idx_users_branch     ON users(branch_id);
CREATE INDEX idx_users_restaurant ON users(restaurant_id);
CREATE INDEX idx_products_branch  ON products(branch_id);
CREATE INDEX idx_orders_branch    ON orders(branch_id);
CREATE INDEX idx_orders_status    ON orders(status);
CREATE INDEX idx_orders_waiter    ON orders(waiter_id);
CREATE INDEX idx_archive_branch   ON order_archive(branch_id);
CREATE INDEX idx_archive_created  ON order_archive(created_at);
CREATE INDEX idx_reservations_table ON reservations(table_id, reserved_at);

-- ============================================================
-- OMBORXONA (INVENTORY) - Xom ashyo va ingredientlar
-- ============================================================
CREATE TYPE inventory_unit AS ENUM ('kg', 'L', 'dona', 'g', 'ml', 'custom');

CREATE TABLE inventory_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  branch_id     UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name          VARCHAR(200) NOT NULL,
  unit          inventory_unit NOT NULL DEFAULT 'kg',
  custom_unit   VARCHAR(50),          -- unit='custom' bo'lganda foydalaniladi
  quantity      DECIMAL(15, 4) NOT NULL DEFAULT 0,  -- joriy miqdor
  min_quantity  DECIMAL(15, 4) DEFAULT 0,            -- ogohlantirish chegarasi
  image_url     TEXT,
  cost_price    DECIMAL(15, 2),                      -- 1 birlik tannarxi (so'mda)
  purchased_at  TIMESTAMP DEFAULT NOW(),             -- oxirgi sotib olingan sana
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW(),
  UNIQUE (branch_id, name)
);

-- Mavjud jadvalga ustunlar qo'shish (migration)
-- ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS cost_price DECIMAL(15, 2);
-- ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS purchased_at TIMESTAMP DEFAULT NOW();

CREATE INDEX idx_inventory_branch ON inventory_items(branch_id);

-- ============================================================
-- MENYU MAHSULOTLARI (menu_items) — faqat menyuda ko'rinadigan narsa
-- ============================================================
CREATE TABLE menu_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  branch_id     UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name          VARCHAR(200) NOT NULL,
  price         DECIMAL(12, 2) NOT NULL DEFAULT 0,
  type          TEXT NOT NULL DEFAULT 'food',        -- product_type kabi
  is_available  BOOLEAN DEFAULT TRUE,
  image_url     TEXT,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_menu_items_branch ON menu_items(branch_id);

-- ============================================================
-- RETSEPT (recipe) — menu_item uchun kerakli ingredientlar
-- ============================================================
CREATE TABLE menu_item_recipes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  menu_item_id    UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity        DECIMAL(15, 4) NOT NULL,   -- 1 porsiyaga kerakli miqdor
  created_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE (menu_item_id, inventory_item_id)
);

CREATE INDEX idx_recipe_menu_item ON menu_item_recipes(menu_item_id);
CREATE INDEX idx_recipe_inventory ON menu_item_recipes(inventory_item_id);

-- ============================================================
-- OMBORXONA HARAKATLARI (inventory_logs) — kirish/chiqish logi
-- ============================================================
CREATE TABLE inventory_logs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id         UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  change_amount     DECIMAL(15, 4) NOT NULL,  -- + qo'shildi, - ayirildi
  reason            VARCHAR(200),              -- 'order', 'manual_add', 'adjustment'
  order_id          UUID,                      -- agar buyurtma sababli bo'lsa
  before_quantity   DECIMAL(15, 4),
  after_quantity    DECIMAL(15, 4),
  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_inv_logs_branch ON inventory_logs(branch_id);
CREATE INDEX idx_inv_logs_item   ON inventory_logs(inventory_item_id);
