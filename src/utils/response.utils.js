const success = (res, data = {}, message = 'OK', statusCode = 200) => {
  return res.status(statusCode).json({ success: true, message, data });
};

const created = (res, data = {}, message = 'Yaratildi') => {
  return res.status(201).json({ success: true, message, data });
};

const error = (res, message = 'Xato', statusCode = 400) => {
  return res.status(statusCode).json({ success: false, message });
};

const paginate = (res, data, total, page, limit, message = 'OK') => {
  return res.status(200).json({
    success: true,
    message,
    data,
    pagination: {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / limit)
    }
  });
};

module.exports = { success, created, error, paginate };
