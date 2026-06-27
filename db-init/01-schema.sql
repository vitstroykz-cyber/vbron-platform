-- ============================================================
-- VBRON: базовая схема БД
-- Мульти-тенантная архитектура: tenant_id во всех таблицах
-- ============================================================

-- Включаем расширение для UUID (опционально, можно и без него)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TENANTS: клиенты (зоны отдыха, сауны и т.д.)
-- ============================================================
CREATE TABLE tenants (
    id              SERIAL PRIMARY KEY,
    slug            VARCHAR(50) UNIQUE NOT NULL,  -- поддомен, например 'aquapark'
    name            VARCHAR(200) NOT NULL,
    owner_name      VARCHAR(200),
    owner_phone     VARCHAR(50),
    owner_email     VARCHAR(200),
    plan            VARCHAR(20) DEFAULT 'start',  -- start | bron | premium
    telegram_chat_id VARCHAR(100),                -- куда слать уведомления
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_tenants_active ON tenants(is_active);

-- ============================================================
-- USERS: пользователи админ-панели
-- ============================================================
CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email           VARCHAR(200) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    full_name       VARCHAR(200),
    role            VARCHAR(20) DEFAULT 'admin',  -- owner | admin
    is_active       BOOLEAN DEFAULT TRUE,
    last_login_at   TIMESTAMP,
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_email ON users(email);

-- ============================================================
-- ROOMS: номера / домики / зоны / сауны
-- ============================================================
CREATE TABLE rooms (
    id              SERIAL PRIMARY KEY,
    tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            VARCHAR(200) NOT NULL,
    type            VARCHAR(50),                  -- room | cottage | sauna | gazebo
    capacity        INTEGER DEFAULT 2,
    price_per_day   DECIMAL(10, 2) NOT NULL,
    description     TEXT,
    photos          JSONB DEFAULT '[]'::jsonb,    -- массив URL'ов фото
    amenities       JSONB DEFAULT '[]'::jsonb,    -- ["wifi", "bbq", "pool"]
    display_order   INTEGER DEFAULT 0,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_rooms_tenant ON rooms(tenant_id);
CREATE INDEX idx_rooms_active ON rooms(tenant_id, is_active);

-- ============================================================
-- BOOKINGS: брони
-- ============================================================
CREATE TABLE bookings (
    id              SERIAL PRIMARY KEY,
    tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    room_id         INTEGER NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
    guest_name      VARCHAR(200) NOT NULL,
    guest_phone     VARCHAR(50) NOT NULL,
    guest_email     VARCHAR(200),
    check_in        DATE NOT NULL,
    check_out       DATE NOT NULL,
    guests_count    INTEGER DEFAULT 1,
    status          VARCHAR(20) DEFAULT 'new',
        -- new | confirmed | paid | cancelled | completed | no_show
    payment_status  VARCHAR(20) DEFAULT 'unpaid',
        -- unpaid | prepaid | paid | refunded
    total_price     DECIMAL(10, 2),
    prepayment      DECIMAL(10, 2) DEFAULT 0,
    source          VARCHAR(30) DEFAULT 'site',
        -- site | whatsapp | phone | walkin | manual
    notes           TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),

    CONSTRAINT check_dates CHECK (check_out > check_in)
);

CREATE INDEX idx_bookings_tenant ON bookings(tenant_id);
CREATE INDEX idx_bookings_room_dates ON bookings(room_id, check_in, check_out);
CREATE INDEX idx_bookings_status ON bookings(tenant_id, status);
CREATE INDEX idx_bookings_created ON bookings(created_at DESC);

-- ============================================================
-- REVIEWS: отзывы с AI-модерацией
-- ============================================================
CREATE TABLE reviews (
    id              SERIAL PRIMARY KEY,
    tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    booking_id      INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
    guest_name      VARCHAR(200),
    rating          INTEGER CHECK (rating BETWEEN 1 AND 5),
    text            TEXT,
    is_published    BOOLEAN DEFAULT FALSE,
        -- false по умолчанию: модерация AI + владелец
    ai_sentiment    VARCHAR(20),   -- positive | neutral | negative
    needs_attention BOOLEAN DEFAULT FALSE,  -- плохой отзыв → владельцу в TG
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_reviews_tenant ON reviews(tenant_id);
CREATE INDEX idx_reviews_published ON reviews(tenant_id, is_published);

-- ============================================================
-- SETTINGS: гибкие настройки клиента (key-value)
-- ============================================================
CREATE TABLE settings (
    id              SERIAL PRIMARY KEY,
    tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key             VARCHAR(100) NOT NULL,
    value           TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),

    UNIQUE(tenant_id, key)
);

CREATE INDEX idx_settings_tenant ON settings(tenant_id);

-- ============================================================
-- Функция и триггер для авто-обновления updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_rooms_updated_at BEFORE UPDATE ON rooms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_bookings_updated_at BEFORE UPDATE ON bookings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
