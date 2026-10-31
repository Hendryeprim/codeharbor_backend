// High-speed in-memory cache with TTL (Time-To-Live)
const memoryCache = new Map();

export const getCache = (key) => {
  const item = memoryCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return item.value;
};

export const setCache = (key, value, ttlSeconds = 30) => {
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
};

export const clearCachePattern = (prefix) => {
  for (const key of memoryCache.keys()) {
    if (!prefix || key.startsWith(prefix)) {
      memoryCache.delete(key);
    }
  }
};

