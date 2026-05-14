const mongoose = require("mongoose");

// ─── Applied Voucher Sub-Schema ─────────────────────────────────────────────
const appliedVoucherSchema = new mongoose.Schema(
  {
    voucherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Voucher",
    },

    code: {
      type: String,
      trim: true,
    },

    discountType: {
      type: String,
      enum: ["percentage", "flat"],
    },

    discount: {
      type: Number,
    },

    discountAmount: {
      type: Number,
    },

    appliedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

// ─── Buy Now Schema ─────────────────────────────────────────────────────────
const buyNowSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    variantIndex: {
      type: Number,
      required: true,
      min: 0,
    },

    quantity: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },

    // ─── Applied Voucher ───────────────────────────────────────────────────
    appliedVoucher: {
      type: appliedVoucherSchema,
      default: null,
    },

    // ─── Pricing Summary ───────────────────────────────────────────────────
    pricing: {
      subtotal: {
        type: Number,
        default: 0,
      },

      totalMRP: {
        type: Number,
        default: 0,
      },

      voucherDiscount: {
        type: Number,
        default: 0,
      },

      total: {
        type: Number,
        default: 0,
      },
    },
  },
  {
    timestamps: true,
  }
);

// ─── Method: Recalculate Pricing ───────────────────────────────────────────
buyNowSchema.methods.recalculatePricing = async function () {
  const Product = mongoose.model("Product");

  const product = await Product.findById(this.productId).lean();

  if (!product) {
    this.pricing = {
      subtotal: 0,
      totalMRP: 0,
      voucherDiscount: 0,
      total: 0,
    };

    return;
  }

  const variant = product.variants?.[this.variantIndex];

  if (!variant) {
    this.pricing = {
      subtotal: 0,
      totalMRP: 0,
      voucherDiscount: 0,
      total: 0,
    };

    return;
  }

  const subtotal =
    (variant.price?.sellingPrice || 0) * this.quantity;

  const totalMRP =
    (variant.price?.mrp || 0) * this.quantity;

  const voucherDiscount =
    this.appliedVoucher?.discountAmount || 0;

  const total = Math.max(0, subtotal - voucherDiscount);

  this.pricing = {
    subtotal: Math.round(subtotal),
    totalMRP: Math.round(totalMRP),
    voucherDiscount: Math.round(voucherDiscount),
    total: Math.round(total),
  };
};

// ─── Remove Voucher Method ─────────────────────────────────────────────────
buyNowSchema.methods.removeVoucher = function () {
  this.appliedVoucher = null;
};

// ─── Pre Save Hook ─────────────────────────────────────────────────────────
buyNowSchema.pre("save", async function (next) {
  await this.recalculatePricing();
});

const BuyNow = mongoose.model("BuyNow", buyNowSchema);

module.exports = BuyNow;