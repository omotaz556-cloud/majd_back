const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER || 'mock').trim().toLowerCase();

const resendProvider = require('./resend.provider');
const mockProvider = require('./mock.provider');

const providersByName = {
  resend: resendProvider,
  mock: mockProvider,
};

module.exports = providersByName[EMAIL_PROVIDER] || mockProvider;
