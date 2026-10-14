function createRateLimit({ limit, windowMs, message }) {
  const clients = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const current = clients.get(key);
    if (!current || current.resetAt <= now) {
      clients.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (current.count >= limit) {
      res.set("Retry-After", String(Math.ceil((current.resetAt - now) / 1000)));
      return res.status(429).json({ success: false, error: message });
    }
    current.count += 1;
    return next();
  };
}

module.exports = { createRateLimit };
