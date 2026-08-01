const coinPackageService = require('./coinPackage.service');

async function listActive(req, res) {
  try {
    const packages = await coinPackageService.listActivePackages();
    return res.json({ packages });
  } catch (err) {
    console.error('[CoinPackages] listActive error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch coin packages' });
  }
}

module.exports = { listActive };
