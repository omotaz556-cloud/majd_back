const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true, // محفظة واحدة لكل مستخدم
    },
    balance: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      default: () => mongoose.Types.Decimal128.fromString('0.00'),
    },
    currency: {
      type: String,
      required: true,
      default: 'SAR',
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// الرصيد نفسه لا يتعدل مباشرة من أي مكان في الكود إلا عن طريق wallet.service.js
// اللي بيتأكد إن كل تغيير في الرصيد مرتبط بسجل في wallet_transactions

module.exports = mongoose.model('Wallet', walletSchema);
