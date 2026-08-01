const walletService = require('./wallet.service');

async function getMyWallet(req, res) {
  try {
    const wallet = await walletService.getWalletByUserId(req.user._id);
    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found' });
    }
    return res.json({ wallet });
  } catch (err) {
    console.error('[Wallet] getMyWallet error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch wallet' });
  }
}

async function getMyTransactions(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const skip = parseInt(req.query.skip) || 0;

    const transactions = await walletService.getTransactionHistory(req.user._id, {
      limit,
      skip,
    });

    return res.json({ transactions });
  } catch (err) {
    console.error('[Wallet] getMyTransactions error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch transactions' });
  }
}

module.exports = { getMyWallet, getMyTransactions };
