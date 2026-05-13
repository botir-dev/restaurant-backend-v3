const { v4: uuidv4 } = require('uuid');
const pool = require('../../config/database');
const { success, created, error } = require('../../utils/response.utils');

// GET /tables
const getTables = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, 
        (SELECT json_build_object('id', r.id, 'full_name', u.full_name, 'reserved_at', r.reserved_at, 'duration_min', r.duration_min)
         FROM reservations r JOIN users u ON u.id = r.created_by
         WHERE r.table_id = t.id AND r.status = 'active'
         ORDER BY r.reserved_at ASC LIMIT 1) as next_reservation
       FROM tables t
       WHERE t.branch_id = $1 AND t.restaurant_id = $2
       ORDER BY t.table_number`,
      [req.branchId, req.restaurantId]
    );
    return success(res, result.rows);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// POST /tables
const createTable = async (req, res) => {
  const { table_number, capacity } = req.body;
  if (!table_number) return error(res, 'Stol raqami talab qilinadi');

  try {
    const result = await pool.query(
      `INSERT INTO tables (id, restaurant_id, branch_id, table_number, capacity)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [uuidv4(), req.restaurantId, req.branchId, table_number, capacity || 4]
    );
    return created(res, result.rows[0], 'Stol yaratildi');
  } catch (err) {
    if (err.code === '23505') return error(res, 'Bu raqamli stol allaqachon mavjud');
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// PATCH /tables/:id/occupy
const occupyTable = async (req, res) => {
  const { id } = req.params;
  const { guest_count } = req.body;

  try {
    const tableResult = await pool.query(
      `SELECT * FROM tables WHERE id = $1 AND branch_id = $2`,
      [id, req.branchId]
    );
    if (tableResult.rows.length === 0) return error(res, 'Stol topilmadi', 404);
    if (tableResult.rows[0].is_occupied) return error(res, 'Stol allaqachon band');

    const result = await pool.query(
      `UPDATE tables SET is_occupied = TRUE, updated_at = NOW()
       WHERE id = $1 AND branch_id = $2 RETURNING *`,
      [id, req.branchId]
    );
    return success(res, { table: result.rows[0], guest_count }, 'Stol band qilindi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// PATCH /tables/:id/free
const freeTable = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE tables SET is_occupied = FALSE, current_order_id = NULL, updated_at = NOW()
       WHERE id = $1 AND branch_id = $2 RETURNING *`,
      [id, req.branchId]
    );
    if (result.rows.length === 0) return error(res, 'Stol topilmadi', 404);
    return success(res, result.rows[0], 'Stol bo\'shatildi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// ============================================================
// BRONLAR
// ============================================================

// GET /tables/reservations
const getReservations = async (req, res) => {
  const { date, table_id } = req.query;
  try {
    let where = `WHERE r.branch_id = $1`;
    const params = [req.branchId];
    let idx = 2;

    if (date) {
      where += ` AND DATE(r.reserved_at) = $${idx++}`;
      params.push(date);
    }
    if (table_id) {
      where += ` AND r.table_id = $${idx++}`;
      params.push(table_id);
    }

    const result = await pool.query(
      `SELECT r.*, t.table_number, u.full_name as created_by_name
       FROM reservations r
       JOIN tables t ON t.id = r.table_id
       JOIN users u ON u.id = r.created_by
       ${where}
       ORDER BY r.reserved_at ASC`,
      params
    );
    return success(res, result.rows);
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// POST /tables/reservations
const createReservation = async (req, res) => {
  const { table_id, full_name, phone, reserved_at, duration_min, guest_count } = req.body;
  if (!table_id || !full_name || !phone || !reserved_at) {
    return error(res, 'Barcha majburiy maydonlar to\'ldirilishi kerak');
  }

  try {
    const now = new Date();
    const reservedTime = new Date(reserved_at);
    const minAdvance = new Date(now.getTime() + 2 * 60 * 60 * 1000);   // 2 soat oldin
    const maxAdvance = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 kun oldin

    if (reservedTime < minAdvance) return error(res, 'Bron kamida 2 soat oldin amalga oshirilishi kerak');
    if (reservedTime > maxAdvance) return error(res, 'Bron 30 kundan ko\'p oldin amalga oshirib bo\'lmaydi');

    const dur = duration_min || 60;
    if (dur < 60 || dur > 1440) return error(res, 'Bron davomiyligi 1 soatdan 24 soatgacha bo\'lishi kerak');

    // Bir stolda bir vaqtda faqat bitta aktiv bron
    const conflictCheck = await pool.query(
      `SELECT id FROM reservations
       WHERE table_id = $1 AND status = 'active'
         AND reserved_at < $2::timestamp + ($3 || ' minutes')::interval
         AND reserved_at + (duration_min || ' minutes')::interval > $2::timestamp`,
      [table_id, reserved_at, dur]
    );
    if (conflictCheck.rows.length > 0) return error(res, 'Bu stol ushbu vaqtda allaqachon bronlangan');

    const result = await pool.query(
      `INSERT INTO reservations (id, restaurant_id, branch_id, table_id, created_by, full_name, phone, reserved_at, duration_min, guest_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [uuidv4(), req.restaurantId, req.branchId, table_id, req.user.user_id,
       full_name, phone, reserved_at, dur, guest_count || 1]
    );
    return created(res, result.rows[0], 'Bron qilindi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

// DELETE /tables/reservations/:id
const cancelReservation = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE reservations SET status = 'cancelled', cancel_reason = 'manual', updated_at = NOW()
       WHERE id = $1 AND branch_id = $2 AND status = 'active' RETURNING id`,
      [id, req.branchId]
    );
    if (result.rows.length === 0) return error(res, 'Bron topilmadi yoki allaqachon bekor qilingan', 404);
    return success(res, {}, 'Bron bekor qilindi');
  } catch (err) {
    console.error(err);
    return error(res, 'Server xatosi', 500);
  }
};

module.exports = {
  getTables, createTable, occupyTable, freeTable,
  getReservations, createReservation, cancelReservation
};
