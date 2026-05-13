# Restoran Boshqaruv Tizimi — Backend

Node.js + PostgreSQL asosidagi restoran boshqaruv tizimi backend API.

## Texnologiyalar

- **Node.js** + **Express**
- **PostgreSQL** (pg)
- **JWT** (Access 60min + Refresh 7kun, rotatsiya bilan)
- **bcryptjs** — parol hashlash
- **SSE** (Server-Sent Events) — real-time bildirishnomalar

---

## O'rnatish

```bash
# Paketlarni o'rnatish
npm install

# .env faylini yaratish
cp .env.example .env
# .env ichida DB va JWT sozlamalarini to'ldiring

# DBni yaratish va sxemani qo'llash
psql -U postgres -c "CREATE DATABASE restaurant_db;"
psql -U postgres -d restaurant_db -f src/config/schema.sql

# Serverni ishga tushirish
npm start
# yoki development rejimida
npm run dev
```

---

## Arxitektura

```
Super Admin
  └── Restaurant (restoran)
        └── Branch (filial)
              ├── Manager
              ├── Waiter (ofitsiant)
              ├── Cashier (kassir)
              ├── Storekeeper (omborchi)
              └── Cook / Baker / Somsa / Grill / Turkish / Bartender / Icecream / Tea
```

**Izolyatsiya:** JWT tokeniga `restaurant_id` va `branch_id` kiritiladi. Middleware har bir so'rovga avtomatik filter qo'shadi — hodim boshqa filial ma'lumotlarini hech qachon ko'ra olmaydi.

---

## API Endpointlar

### Auth
| Method | Endpoint | Kimlar |
|--------|----------|--------|
| POST | `/auth/login` | Hammasi |
| POST | `/auth/refresh` | Hammasi |
| POST | `/auth/logout` | Hammasi |
| PUT | `/auth/change-password` | Hammasi |

### Super Admin (`/admin/...`)
| Method | Endpoint | |
|--------|----------|-|
| GET/POST | `/admin/restaurants` | Restoranlar ro'yxati / Yaratish |
| PUT | `/admin/restaurants/:id` | Yangilash |
| DELETE | `/admin/restaurants/:id` | O'chirish |
| GET/POST | `/admin/branches` | Filiallar |
| PUT | `/admin/branches/:id` | Filial yangilash |
| GET/POST | `/admin/managers` | Menejerlar |
| PUT/DELETE | `/admin/managers/:id` | Menejer tahrirlash |

### Mahsulotlar
| Method | Endpoint | Query params |
|--------|----------|-------------|
| GET | `/products` | `type`, `is_available`, `page`, `limit` |
| POST | `/products` | — |
| PUT | `/products/:id` | — |
| DELETE | `/products/:id` | — |
| PATCH | `/products/:id/availability` | — |

### Stollar
| Method | Endpoint | |
|--------|----------|-|
| GET | `/tables` | Barcha stollar + keyingi bron |
| POST | `/tables` | Yangi stol (manager) |
| PATCH | `/tables/:id/occupy` | Band qilish (waiter) |
| PATCH | `/tables/:id/free` | Bo'shatish (waiter, manager) |
| GET | `/tables/reservations` | Bronlar |
| POST | `/tables/reservations` | Yangi bron |
| DELETE | `/tables/reservations/:id` | Bekor qilish |

### Buyurtmalar
| Method | Endpoint | |
|--------|----------|-|
| GET | `/orders` | `status` filter |
| POST | `/orders` | Yaratish |
| PUT | `/orders/:id` | Itemlarni tahrirlash |
| PATCH | `/orders/:id/send` | Oshxonaga yuborish |
| PATCH | `/orders/:id/complete` | Yakunlash (payment_pending) |
| PATCH | `/orders/:id/items/:itemId/prepare` | Item tayyor |
| DELETE | `/orders/:id` | Bekor qilish |

### To'lov
| Method | Endpoint | |
|--------|----------|-|
| POST | `/payments/:orderId` | To'lovni qabul qilish |
| GET | `/payments/:orderId/check` | Chek (print format, .txt) |

### Arxiv va Daromad
| Method | Endpoint | Query params |
|--------|----------|-------------|
| GET | `/archive` | `period`, `from`, `to`, `waiter`, `cashier`, `table_number`, `page`, `limit` |
| GET | `/archive/revenue` | `period`, `from`, `to` |

### Dashboard
| Method | Endpoint | |
|--------|----------|-|
| GET | `/dashboard` | Top mahsulotlar, stollar, ofitsiantlar, grafik |

### SSE (Real-time)
| Method | Endpoint | |
|--------|----------|-|
| GET | `/sse/connect` | SSE ulanish (Bearer token) |

**SSE hodisalar:**
- `qr_order` — Ofitsiantga: mijoz QR orqali buyurtma berdi
- `new_order` — Tayyorlovchiga: yangi buyurtma keldi (faqat o'z turi)
- `order_ready` — Ofitsiantga: barcha mahsulotlar tayyor

### Ommaviy (Autentifikatsiyasiz)
| Method | Endpoint | |
|--------|----------|-|
| GET | `/public/menu/:branch_id` | Menyu (`type`, `page`, `limit`) |
| GET | `/public/waiters/:branch_id` | Ofitsiantlar ro'yxati |
| POST | `/public/orders` | QR orqali buyurtma |

---

## QR Buyurtma Oqimi

```
1. Mijoz QR kodni skanerlaydi
2. GET /public/waiters/:branch_id → ofitsiantlar ro'yxati
3. Mijoz ofitsiantni tanlaydi
4. GET /public/menu/:branch_id → menyu
5. POST /public/orders → buyurtma yuboriladi
6. Tanlangan ofitsiantga SSE orqali darhol xabar boradi
   (ofitsiant band bo'lsa ham — buyurtma unga biriktiriladi)
```

---

## Pagination formati

```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "total": 150,
    "page": 2,
    "limit": 20,
    "totalPages": 8
  }
}
```

---

## Bron cheklovlari

- Minimum: 2 soat oldin
- Maksimum: 30 kun oldin
- Davomiyligi: 1–24 soat
- Muddati o'tsa: cron job (har 5 daqiqa) avtomatik bekor qiladi

---

## Kelajak (Keyingi versiyalar)

| Versiya | Xususiyat |
|---------|-----------|
| v1.1 | WebSocket (SSE o'rnini bosadi) |
| v1.2 | Ingredient tizimi |
| v1.3 | Ombor hisobi |
| v1.4 | Chegirma / Promo-kod |
| v1.5 | Smena tizimi |
| v2.0 | Ko'p til (i18n) |
