const { ACCOUNT_PROVIDER } = require('../../../config/providers');
const localProvider = require('./local.provider');
const majdPlatformProvider = require('./majdPlatform.provider');

const providersByName = {
  local: localProvider,
  majd_platform: majdPlatformProvider,
};

// اتحقق منه بالفعل في config/providers.js، لكن fallback إضافي هنا للأمان
module.exports = providersByName[ACCOUNT_PROVIDER] || localProvider;
