const { ADS_DEBUG } = require('./ads.config');

/**
 * ====== Ads Logger ======
 * لوجات مبنيّة (structured) بادئة بـ [Ads] عشان تتفلتر بسهولة في أي نظام
 * تجميع لوجات (Railway, Datadog, ...). رسائل الـ debug بس بتظهر لو
 * ADS_DEBUG=true - عشان منغرقش الـ production logs بتفاصيل مش لازمة.
 */
function info(event, meta = {}) {
  console.log(`[Ads] ${event}`, meta);
}

function debug(event, meta = {}) {
  if (!ADS_DEBUG) return;
  console.log(`[Ads:debug] ${event}`, meta);
}

function warn(event, meta = {}) {
  console.warn(`[Ads] ${event}`, meta);
}

function error(event, meta = {}) {
  console.error(`[Ads] ${event}`, meta);
}

module.exports = { info, debug, warn, error };
