const mongoose = require("mongoose");

// ─── Usage Log Sub-Schema ─────────────────────────────────────────────────────
const voucherUsageSchema = new mongoose.Schema(
  {
    userId:         { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    orderId:        { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    discountAmount: { type: Number, required: true },
    usedAt:         { type: Date, default: Date.now },
  },
  { _id: false }
);

// ─── Voucher Schema ───────────────────────────────────────────────────────────
const voucherSchema = new mongoose.Schema(
  {
    // ── Code ────────────────────────────────────────────────────────────────
    code: {
      type:      String,
      required:  [true, "Voucher code is required"],
      unique:    true,
      uppercase: true,
      trim:      true,
      minlength: [3,  "Minimum 3 characters"],
      maxlength: [20, "Maximum 20 characters"],
      match:     [/^[A-Z0-9_-]+$/, "Only letters, numbers, hyphens and underscores allowed"],
      // e.g. WELCOME10, SKIN20, GLOW50
    },

    title:       { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },

    // ── Discount ─────────────────────────────────────────────────────────────
    discountType: {
      type:     String,
      enum:     ["percentage", "flat"],
      required: true,
    },

    discount: {
      type:     Number,
      required: true,
      min:      [1, "Discount must be at least 1"],
      validate: {
        validator(val) {
          if (this.discountType === "percentage") return val <= 100;
          return true;
        },
        message: "Percentage discount cannot exceed 100",
      },
    },

    // Max ₹ cap — only for percentage type
    // e.g. "20% off but max ₹200" — prevents huge savings on large orders
    maxDiscountAmount: {
      type:    Number,
      default: null,  // null = no cap
      min:     0,
    },

    // Minimum cart value required to apply this voucher
    minOrderValue: {
      type:    Number,
      default: 0,
      min:     0,
    },

    // ── Who Can Use ───────────────────────────────────────────────────────────
    eligibility: {
      type:    String,
      enum:    ["all", "new_users", "existing_users"],
      default: "all",
      // all            → everyone
      // new_users      → only users who registered after the voucher was created
      // existing_users → only users who registered before the voucher was created
    },

    // ── Applies To ────────────────────────────────────────────────────────────
    appliesTo: {
      type:    String,
      enum:    ["all", "product", "category"],
      default: "all",
    },

    // Used when appliesTo === "product"
    applicableProductIds: {
      type:    [mongoose.Schema.Types.ObjectId],
      ref:     "Product",
      default: [],
    },

    // Used when appliesTo === "category"
    applicableCategories: {
      type:    [String],
      default: [],
      // e.g. ["Face Serum", "Body Care"]
    },

    // ── Usage Limits ──────────────────────────────────────────────────────────
    maxUses: {
      type:    Number,
      default: null,  // null = unlimited
      min:     1,
    },

    perUserLimit: {
      type:    Number,
      default: 1,     // most vouchers are single-use per user
      min:     1,
    },

    usedCount: {
      type:    Number,
      default: 0,
    },

    usageLog: {
      type:    [voucherUsageSchema],
      default: [],
    },

    // ── Validity ──────────────────────────────────────────────────────────────
    startDate: {
      type:     Date,
      required: [true, "Start date is required"],
    },

    endDate: {
  type: Date,
  required: [true, "End date is required"],
},

    // ── Status ────────────────────────────────────────────────────────────────
    isActive:  { type: Boolean, default: true },
    deletedAt: { type: Date,    default: null  },  // soft delete
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

voucherSchema.index({ isActive:  1, startDate: 1, endDate: 1 });
voucherSchema.index({ eligibility: 1 });
voucherSchema.index({ deletedAt: 1 });
voucherSchema.index({ "usageLog.userId": 1 });

// ─── Virtuals ─────────────────────────────────────────────────────────────────
voucherSchema.virtual("isValid").get(function () {
  const now = new Date();
  return (
    this.isActive     &&
    !this.deletedAt   &&
    now >= this.startDate &&
    now <= this.endDate   &&
    (this.maxUses === null || this.usedCount < this.maxUses)
  );
});

voucherSchema.virtual("remainingUses").get(function () {
  if (this.maxUses === null) return null;
  return Math.max(0, this.maxUses - this.usedCount);
});

// ─── Methods ──────────────────────────────────────────────────────────────────

// Check if a specific user can use this voucher
voucherSchema.methods.canBeUsedBy = async function (userId) {
  // 1. Is the voucher valid at all?
  if (!this.isValid) {
    return { allowed: false, reason: "Voucher is expired or inactive" };
  }

  // 2. Global usage cap
  if (this.maxUses !== null && this.usedCount >= this.maxUses) {
    return { allowed: false, reason: "Voucher usage limit has been reached" };
  }

  // 3. Per-user limit
  const userUsageCount = this.usageLog.filter(
    (log) => log.userId.toString() === userId.toString()
  ).length;

  if (userUsageCount >= this.perUserLimit) {
    return { allowed: false, reason: "You have already used this voucher" };
  }

  // 4. Eligibility check
  if (this.eligibility === "new_users" || this.eligibility === "existing_users") {
    const User = mongoose.model("User");
    const user = await User.findById(userId).select("createdAt").lean();
    if (!user) return { allowed: false, reason: "User not found" };

    // "new" = registered on or after voucher creation date
    const isNewUser = user.createdAt >= this.createdAt;

    if (this.eligibility === "new_users" && !isNewUser) {
      return { allowed: false, reason: "This voucher is only for new users" };
    }
    if (this.eligibility === "existing_users" && isNewUser) {
      return { allowed: false, reason: "This voucher is only for existing users" };
    }
  }

  return { allowed: true, reason: null };
};

// Calculate the actual discount for a given cart
voucherSchema.methods.calculateDiscount = function (cartItems) {
  // cartItems: [{ productId, category, sellingPrice, quantity }]

  // Filter to only eligible items
  const eligibleItems = cartItems.filter((item) => {
    if (this.appliesTo === "all") return true;

    if (this.appliesTo === "product") {
      return this.applicableProductIds.some(
        (pid) => pid.toString() === item.productId.toString()
      );
    }

    if (this.appliesTo === "category") {
      return this.applicableCategories.some(
        (cat) => cat.toLowerCase() === (item.category || "").toLowerCase()
      );
    }

    return false;
  });

  if (eligibleItems.length === 0) {
    return {
      discountAmount: 0,
      eligibleTotal:  0,
      reason: "No eligible items in cart for this voucher",
    };
  }

  const eligibleTotal = eligibleItems.reduce(
    (sum, item) => sum + item.sellingPrice * item.quantity, 0
  );

  // Check minimum order value
  if (eligibleTotal < this.minOrderValue) {
    return {
      discountAmount: 0,
      eligibleTotal,
      reason: `Minimum order value of ₹${this.minOrderValue} required. Add ₹${this.minOrderValue - eligibleTotal} more.`,
    };
  }

  // Calculate raw discount
  let discountAmount =
    this.discountType === "percentage"
      ? (eligibleTotal * this.discount) / 100
      : this.discount;

  // Apply maxDiscountAmount cap (for percentage vouchers)
  if (this.maxDiscountAmount !== null) {
    discountAmount = Math.min(discountAmount, this.maxDiscountAmount);
  }

  // Discount can never exceed what the user is paying
  discountAmount = Math.min(discountAmount, eligibleTotal);

  return {
    discountAmount: Math.round(discountAmount),
    eligibleTotal:  Math.round(eligibleTotal),
    reason:         null,
  };
};

// Record usage after a successful order
voucherSchema.methods.recordUsage = async function (userId, orderId, discountAmount) {
  this.usageLog.push({ userId, orderId, discountAmount });
  this.usedCount += 1;
  await this.save();
};

// ─── Statics ──────────────────────────────────────────────────────────────────

// Find + validate a voucher by code for a specific user — single call at checkout
voucherSchema.statics.findAndValidate = async function (code, userId) {
  const voucher = await this.findOne({
    code:      code.toUpperCase().trim(),
    deletedAt: null,
  });

  if (!voucher) return { voucher: null, error: "Invalid voucher code" };

  const { allowed, reason } = await voucher.canBeUsedBy(userId);
  if (!allowed) return { voucher: null, error: reason };

  return { voucher, error: null };
};

// Get all currently active vouchers (for admin dashboard listing)
voucherSchema.statics.getActive = function () {
  const now = new Date();
  return this.find({
    isActive:  true,
    deletedAt: null,
    startDate: { $lte: now },
    endDate:   { $gte: now },
  }).select("-usageLog");
};

// ─── Pre-save Hook ────────────────────────────────────────────────────────────
voucherSchema.pre("save", function (next) {
  // Auto-deactivate if global usage cap is hit
  if (this.maxUses !== null && this.usedCount >= this.maxUses) {
    this.isActive = false;
  }
});


const Voucher = mongoose.model("Voucher", voucherSchema);
module.exports = Voucher;