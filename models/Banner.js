const mongoose = require("mongoose");

const bannerSchema = new mongoose.Schema(
  {
    // ─── Frontend display ───────────────────────────────────────────
    title: {
      type: String,
      required: [true, "Banner title is required"],
      trim: true,
      maxlength: [100, "Title cannot exceed 100 characters"],
    },

    description: {
      type: String,
      trim: true,
      maxlength: [500, "Description cannot exceed 500 characters"],
    },

    buttonText: {
      type: String,
      trim: true,
      default: "Shop Now",
      maxlength: [50, "Button text cannot exceed 50 characters"],
    },

    image: {
      url: { type: String, required: [true, "Banner image URL is required"] },
      altText: { type: String, default: "" },
    },

    // ─── Discount ───────────────────────────────────────────────────
    discount: {
      type: Number,
      required: [true, "Discount value is required"],
      min: [0, "Discount cannot be negative"],
    },

    discountType: {
      type: String,
      enum: {
        values: ["percentage", "flat"],
        message: "discountType must be 'percentage' or 'flat'",
      },
      required: [true, "Discount type is required"],
    },

    // ─── Product targeting ──────────────────────────────────────────
    appliesTo: {
      type: String,
      enum: {
        values: ["all", "products", "category"],
        message: "appliesTo must be 'all', 'products', or 'category'",
      },
      default: "all",
    },

    productIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],

    categoryIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
      },
    ],

    // ─── Validity ───────────────────────────────────────────────────
    startDate: {
      type: Date,
      required: [true, "Start date is required"],
    },

    endDate: {
      type: Date,
      required: [true, "End date is required"],
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    // ─── Usage limits ───────────────────────────────────────────────
    maxUses: {
      type: Number,
      default: null, // null = unlimited
      min: [1, "maxUses must be at least 1 if set"],
    },

    usedCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    perUserLimit: {
      type: Number,
      default: 1, // 1 use per user by default
      min: [1, "perUserLimit must be at least 1"],
    },

    // ─── Display order & priority ───────────────────────────────────
    priority: {
      type: Number,
      default: 0, // higher number = shown first
    },

    // ─── Soft delete ────────────────────────────────────────────────
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

// ─── Indexes ─────────────────────────────────────────────────────────
bannerSchema.index({ isActive: 1, startDate: 1, endDate: 1 });
bannerSchema.index({ appliesTo: 1 });
bannerSchema.index({ productIds: 1 });
bannerSchema.index({ categoryIds: 1 });

// ─── Virtual: is this banner currently live? ──────────────────────────
bannerSchema.virtual("isLive").get(function () {
  const now = new Date();
  return (
    this.isActive &&
    !this.deletedAt &&
    now >= this.startDate &&
    now <= this.endDate &&
    (this.maxUses === null || this.usedCount < this.maxUses)
  );
});

// ─── Validation: endDate must be after startDate ──────────────────────
bannerSchema.pre("save", function (next) {
  if (this.endDate <= this.startDate) {
    return next(new Error("endDate must be after startDate"));
  }

  // percentage discount must be 0–100
  if (this.discountType === "percentage" && this.discount > 100) {
    return next(new Error("Percentage discount cannot exceed 100"));
  }

  // if appliesTo = 'products', productIds must not be empty
  if (this.appliesTo === "products" && this.productIds.length === 0) {
    return next(
      new Error("productIds cannot be empty when appliesTo is 'products'")
    );
  }

  // if appliesTo = 'category', categoryIds must not be empty
  if (this.appliesTo === "category" && this.categoryIds.length === 0) {
    return next(
      new Error("categoryIds cannot be empty when appliesTo is 'category'")
    );
  }

 
});

// ─── Static: fetch all currently live banners ─────────────────────────
bannerSchema.statics.getLiveBanners = function () {
  const now = new Date();
  return this.find({
    isActive: true,
    deletedAt: null,
    startDate: { $lte: now },
    endDate: { $gte: now },
    $or: [{ maxUses: null }, { $expr: { $lt: ["$usedCount", "$maxUses"] } }],
  }).sort({ priority: -1 });
};

// ─── Method: safely increment usedCount ──────────────────────────────
bannerSchema.methods.incrementUsage = async function () {
  if (this.maxUses !== null && this.usedCount >= this.maxUses) {
    throw new Error("Banner has reached its maximum usage limit");
  }
  this.usedCount += 1;
  return this.save();
};

const Banner = mongoose.model("Banner", bannerSchema);

module.exports = Banner;