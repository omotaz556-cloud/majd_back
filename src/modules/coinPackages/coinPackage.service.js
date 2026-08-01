const CoinPackage = require('./coinPackage.model');

/**
 * ====== قائمة الباقات النشطة (للاعبين - صفحة الشحن) ======
 */
async function listActivePackages() {
  return CoinPackage.find({ is_active: true }).sort({ sort_order: 1, price: 1 });
}

/**
 * ====== قائمة كل الباقات (للأدمن - نشطة وغير نشطة) ======
 */
async function listAllPackages() {
  return CoinPackage.find({}).sort({ sort_order: 1, price: 1 });
}

async function getPackageById(packageId) {
  const pkg = await CoinPackage.findById(packageId);
  if (!pkg) {
    throw new Error('Coin package not found');
  }
  return pkg;
}

async function createPackage(data) {
  const { name, coins_amount, price } = data;

  if (!name || !coins_amount || price === undefined || price === null) {
    throw new Error('name, coins_amount, and price are required');
  }

  if (coins_amount <= 0) {
    throw new Error('coins_amount must be greater than zero');
  }

  if (price < 0) {
    throw new Error('price cannot be negative');
  }

  return CoinPackage.create({
    name,
    coins_amount,
    bonus_coins: data.bonus_coins || 0,
    price,
    currency: data.currency || 'SAR',
    badge: data.badge || null,
    is_active: data.is_active !== undefined ? data.is_active : true,
    sort_order: data.sort_order || 0,
  });
}

async function updatePackage(packageId, updates) {
  const allowedFields = [
    'name',
    'coins_amount',
    'bonus_coins',
    'price',
    'currency',
    'badge',
    'is_active',
    'sort_order',
  ];

  const pkg = await getPackageById(packageId);

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      pkg[field] = updates[field];
    }
  }

  if (pkg.coins_amount <= 0) {
    throw new Error('coins_amount must be greater than zero');
  }
  if (pkg.price < 0) {
    throw new Error('price cannot be negative');
  }

  await pkg.save();
  return pkg;
}

async function deletePackage(packageId) {
  const pkg = await CoinPackage.findByIdAndDelete(packageId);
  if (!pkg) {
    throw new Error('Coin package not found');
  }
  return pkg;
}

module.exports = {
  listActivePackages,
  listAllPackages,
  getPackageById,
  createPackage,
  updatePackage,
  deletePackage,
};
