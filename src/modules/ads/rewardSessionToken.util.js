const crypto = require('crypto');
const { REWARD_SESSION_SECRET } = require('./ads.config');

/**
 * ====== Reward Session Token (HMAC) ======
 * لأن Google Ad Manager للويب (GPT rewarded ads) مفهوش آلية Server-Side
 * Verification موقّعة زي AdMob SSV (اللي بيبعتها جوجل مباشرة للسيرفر)،
 * الحماية هنا بتتم بالكامل جوه سيرفرنا: بنولّد sessionId + توقيع HMAC وقت
 * /reward/start، وبنتحقق من نفس التوقيع وقت /reward/complete. ده بيمنع
 * أي طلب مزوّر يدّعي إن إعلان اتشاف من غير ما يعدي بمرحلة /start الأولانية.
 */
function signSession(sessionId, userId) {
  return crypto
    .createHmac('sha256', REWARD_SESSION_SECRET)
    .update(`${sessionId}:${userId}`)
    .digest('hex');
}

function verifySessionToken(sessionId, userId, token) {
  if (!token) return false;
  const expected = signSession(sessionId, userId);
  const expectedBuf = Buffer.from(expected, 'hex');
  const givenBuf = Buffer.from(String(token), 'hex');
  if (expectedBuf.length !== givenBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, givenBuf);
}

module.exports = { signSession, verifySessionToken };
