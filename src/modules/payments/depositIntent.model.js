const mongoose = require('mongoose');

/**
 * ====== DepositIntent ======
 * بيتبع دفعة إيداع من لحظة ما اللاعب يبدأها لحد ما تتأكد.
 * مقصود إنه يكون Model منفصل عن WalletTransaction (اللي append-only بتصميمه)
 * عشان محتاجين نعدل الـ status هنا (pending -> paid/failed) وده مش المفروض
 * يحصل على سجل الـ ledger النهائي نفسه.
 *
 * moyasar_payment_id = نفس الـ given_id اللي بعتناه وقت الإنشاء (Moyasar بتخليه
 * الـ ID بتاع الـ payment نفسه لو اتبعت، وده اللي بيربطنا بالـ webhook لاحقاً)
 */
const depositIntentSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    moyasar_payment_id: {
      type: String,
      required: true,
      unique: true,
    },
    amount: {
      type: Number, // المبلغ الحقيقي اللي المفروض يتدفع (SAR)، مش بالهللة
      required: true,
    },
    currency: {
      type: String,
      default: 'SAR',
    },
    // الباقة اللي اللاعب اختارها وقت البدء (null لو مبلغ مخصص من غير باقة)
    coin_package_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CoinPackage',
      default: null,
    },
    // عدد الكوين اللي المفروض يتحط في المحفظة لما الدفع ده يتأكد - ده اللي
    // بيتحدد وقت initiateDeposit (من الباقة أو من amount مباشرة لو مفيش باقة)
    // ومينفعش يتغير بعد كده، عشان يفضل مطابق تمامًا لأي حاجة اتقفلت وقت
    // الشحن حتى لو الأدمن غيّر سعر/محتوى الباقة بعدين.
    coins_to_credit: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed'],
      default: 'pending',
    },
    // بيتسجل بعد ما الويب هوك يتحقق منه ونعمل الـ WalletTransaction الفعلية
    wallet_transaction_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },
    failure_reason: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

module.exports = mongoose.model('DepositIntent', depositIntentSchema);
