const { PAYMENT_PROVIDER } = require('../../../config/providers');
const moyasarProvider = require('./moyasar.provider');
const mockProvider = require('./mock.provider');

const providersByName = {
  moyasar: moyasarProvider,
  mock: mockProvider,
};

// اتحقق منه بالفعل في config/providers.js، لكن fallback إضافي هنا للأمان
module.exports = providersByName[PAYMENT_PROVIDER] || mockProvider;
