const mongoose = require("mongoose");

// ─── Cart Item Sub-Schema ─────────────────────────────────────────────────────
const cartItemSchema = new mongoose.Schema(
  {
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

    sku: {
      type: String,
      required: true,
      trim: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    image: {
      type: String,
      default: "",
      trim: true,
    },

    price: {
      mrp: { type: Number, required: true, min: 0 },
      sellingPrice: { type: Number, required: true, min: 0 },
    },

    quantity: {
      type: Number,
      required: true,
      min: [1, "Quantity must be at least 1"],
      default: 1,
    },

    attributes: {
      size: { type: String, default: "" },
      shade: { type: String, default: "" },
      scent: { type: String, default: "" },
      packOf: { type: Number, default: null },
    },

    category: {
      type: String,
      default: "",
      trim: true,
    },

    addedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

// ─── Applied Voucher Sub-Schema ───────────────────────────────────────────────
const appliedVoucherSchema = new mongoose.Schema(
  {
    voucherId: { type: mongoose.Schema.Types.ObjectId, ref: "Voucher" },
    code: { type: String, trim: true },
    discountType: { type: String, enum: ["percentage", "flat"] },
    discount: { type: Number },
    discountAmount: { type: Number },
    appliedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// ─── Applied Banner Sub-Schema (NEW - EXACTLY LIKE VOUCHER) ───────────────────
const appliedBannerSchema = new mongoose.Schema(
  {
    bannerId: { type: mongoose.Schema.Types.ObjectId, ref: "Banner" },
    title: { type: String, trim: true }, // banner.title instead of code
    discountType: { type: String, enum: ["percentage", "flat"] },
    discount: { type: Number },
    discountAmount: { type: Number },
    appliedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// ─── Cart Schema ──────────────────────────────────────────────────────────────
const cartSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    items: {
      type: [cartItemSchema],
      default: [],
      validate: {
        validator: (arr) => arr.length <= 50,
        message: "Cart cannot have more than 50 items",
      },
    },

    appliedVoucher: {
      type: appliedVoucherSchema,
      default: null,
    },

    // ─── NEW: Applied Banner ─────────────────────────────────────────────────
    appliedBanner: {
      type: appliedBannerSchema,
      default: null,
    },

    pricing: {
      subtotal: { type: Number, default: 0 },
      totalMRP: { type: Number, default: 0 },
      voucherDiscount: { type: Number, default: 0 },
      bannerDiscount: { type: Number, default: 0 }, // NEW
      totalDiscount: { type: Number, default: 0 },  // NEW: voucher + banner
      total: { type: Number, default: 0 },
      totalItems: { type: Number, default: 0 },
    },

    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
cartSchema.index({ "items.productId": 1 });
cartSchema.index({ "items.variantIndex": 1 });
cartSchema.index({ appliedBanner: 1 }); // NEW

// ─── Virtuals ─────────────────────────────────────────────────────────────────
cartSchema.virtual("isEmpty").get(function () {
  return this.items.length === 0;
});

cartSchema.virtual("itemCount").get(function () {
  return this.items.reduce((sum, item) => sum + item.quantity, 0);
});

// ─── Methods ──────────────────────────────────────────────────────────────────
cartSchema.methods.recalculatePricing = function () {
  const subtotal = this.items.reduce(
    (sum, item) => sum + item.price.sellingPrice * item.quantity,
    0
  );

  const totalMRP = this.items.reduce(
    (sum, item) => sum + item.price.mrp * item.quantity,
    0
  );

  const totalItems = this.items.reduce((sum, item) => sum + item.quantity, 0);

  // ─── UPDATED: Separate voucher & banner discounts ────────────────────────
  const voucherDiscount = this.appliedVoucher?.discountAmount || 0;
  const bannerDiscount = this.appliedBanner?.discountAmount || 0;
  const totalDiscount = voucherDiscount + bannerDiscount;
  const total = Math.max(0, subtotal - totalDiscount);

  this.pricing = {
    subtotal: Math.round(subtotal),
    totalMRP: Math.round(totalMRP),
    voucherDiscount: Math.round(voucherDiscount),
    bannerDiscount: Math.round(bannerDiscount),
    totalDiscount: Math.round(totalDiscount),
    total: Math.round(total),
    totalItems,
  };
};

// ─── NEW: Apply Banner Method ─────────────────────────────────────────────────
cartSchema.methods.applyBanner = function (banner, discountAmount) {
  this.appliedBanner = {
    bannerId: banner._id,
    title: banner.title, // Use title instead of code
    discountType: banner.discountType,
    discount: banner.discount,
    discountAmount,
  };

  // Clear voucher when banner is applied (or keep both as per business logic)
  // this.appliedVoucher = null; // Uncomment if mutually exclusive

  this.recalculatePricing();
};

// ─── UPDATED: Existing Methods ────────────────────────────────────────────────
cartSchema.methods.addItem = function (itemData) {
  const existing = this.items.find(
    (i) =>
      i.productId.toString() === itemData.productId.toString() &&
      Number(i.variantIndex) === Number(itemData.variantIndex)
  );

  if (existing) {
    existing.quantity += Number(itemData.quantity) || 1;
    existing.sku = itemData.sku || existing.sku;
    existing.name = itemData.name || existing.name;
    existing.image = itemData.image || existing.image;

    existing.price = {
      mrp: Number(itemData.price?.mrp ?? existing.price?.mrp ?? 0),
      sellingPrice: Number(
        itemData.price?.sellingPrice ?? existing.price?.sellingPrice ?? 0
      ),
    };

    existing.attributes = {
      size: itemData.attributes?.size ?? existing.attributes?.size ?? "",
      shade: itemData.attributes?.shade ?? existing.attributes?.shade ?? "",
      scent: itemData.attributes?.scent ?? existing.attributes?.scent ?? "",
      packOf: itemData.attributes?.packOf ?? existing.attributes?.packOf ?? null,
    };

    existing.category = itemData.category ?? existing.category ?? "";
  } else {
    this.items.push({
      ...itemData,
      variantIndex: Number(itemData.variantIndex),
      quantity: Number(itemData.quantity) || 1,
    });
  }

  // Clear offers when new item added
  this.appliedVoucher = null;
  this.appliedBanner = null;

  this.recalculatePricing();
};

cartSchema.methods.removeItem = function (cartItemId) {
  this.items = this.items.filter(
    (i) => i._id.toString() !== cartItemId.toString()
  );

  // Keep offers if other items remain
  if (this.items.length === 0) {
    this.appliedVoucher = null;
    this.appliedBanner = null;
  }

  this.recalculatePricing();
};

cartSchema.methods.updateQuantity = function (cartItemId, newQuantity) {
  const item = this.items.find(
    (i) => i._id.toString() === cartItemId.toString()
  );

  if (!item) throw new Error("Item not found in cart");
  if (newQuantity < 1) throw new Error("Quantity must be at least 1");

  item.quantity = Number(newQuantity);

  // Revalidate offers
  this.appliedVoucher = null;
  this.appliedBanner = null;

  this.recalculatePricing();
};

cartSchema.methods.applyVoucher = function (voucher, discountAmount) {
  this.appliedVoucher = {
    voucherId: voucher._id,
    code: voucher.code,
    discountType: voucher.discountType,
    discount: voucher.discount,
    discountAmount,
  };

  this.recalculatePricing();
};

cartSchema.methods.removeVoucher = function () {
  this.appliedVoucher = null;
  this.recalculatePricing();
};

// ─── NEW: Remove Banner Method ───────────────────────────────────────────────
cartSchema.methods.removeBanner = function () {
  this.appliedBanner = null;
  this.recalculatePricing();
};

cartSchema.methods.clearCart = function () {
  this.items = [];
  this.appliedVoucher = null;
  this.appliedBanner = null;
  this.recalculatePricing();
  this.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
};

// ─── Pre-save Hook ─────────────────────────────────────────────────────────────
cartSchema.pre("save", function (next) {
  this.recalculatePricing();
  this.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

});

const Cart = mongoose.model("Cart", cartSchema);
module.exports = Cart;