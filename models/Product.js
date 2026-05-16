const mongoose = require("mongoose");

// ─────────────────────────────────────────────────────────────────────────────
// SUB-SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────

// Each image stored with url + cloudinary public_id for deletion
const imageSchema = new mongoose.Schema(
  {
    url:       { type: String, required: true },
    public_id: { type: String, required: true },
    altText:   { type: String, default: "" },
    isPrimary: { type: Boolean, default: false },
  },
  { _id: false }
);

// Skincare-specific ingredient entry
const ingredientSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      trim: true,
      default: "",
    },

    image: {
      url: {
        type: String,
        default: "",
      },

      public_id: {
        type: String,
        default: "",
      },

      altText: {
        type: String,
        default: "",
      },
    },
  },
  { _id: false }
);

// Each variant = one purchasable SKU
const variantSchema = new mongoose.Schema(
  {
    sku: {
      type:      String,
      required:  true,
      unique:    true,
      trim:      true,
      uppercase: true,
    },

    attributes: {
      size:   { type: String, trim: true },
      shade:  { type: String, trim: true },
      scent:  { type: String, trim: true },
      packOf: { type: Number },
    },

    price: {
      mrp:          { type: Number, required: true, min: 0 },
      sellingPrice: { type: Number, required: true, min: 0 },
    },

    stock: {
      quantity:      { type: Number, default: 0, min: 0 },
      lowStockAlert: { type: Number, default: 10 },
    },

    weight: {
      value: { type: Number },
      unit:  { type: String, enum: ["g", "ml", "kg", "l", "oz", "fl_oz"], default: "ml" },
    },

    // Variant-specific images — overrides product-level images on PDP
    images: {
      type:    [imageSchema],
      default: [],
    },

    barcode:   { type: String, trim: true },
    isDefault: { type: Boolean, default: false },
    isActive:  { type: Boolean, default: true },
    isFeatured:   { type: Boolean, default: false },
    isBestseller: { type: Boolean, default: false },
    isNewArrival: { type: Boolean, default: false },
    isLimited:    { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Skincare-specific details
const skincareDetailsSchema = new mongoose.Schema(
  {
    skinType: {
      type: [String],
      enum: ["all", "dry", "oily", "combination", "sensitive", "normal", "mature"],
      default: ["all"],
    },

    skinConcerns: {
      type: [String],
      enum: [
        "acne", "anti-aging", "brightening", "dark-spots", "dryness",
        "dullness", "hyperpigmentation", "pores", "redness", "sensitivity",
        "uneven-texture", "wrinkles",
      ],
    },

    usage: {
      howToUse:    { type: String },
      frequency:   { type: String },
      whenToApply: { type: String },
      amountToUse: { type: String },
    },

    claims: {
      type: [String],
      enum: [
        "vegan", "cruelty-free", "paraben-free", "sulfate-free",
        "fragrance-free", "alcohol-free", "dermatologist-tested",
        "hypoallergenic", "organic-certified", "natural", "reef-safe",
        "non-comedogenic", "gluten-free",
      ],
    },

    shelfLife: {
      months:    { type: Number },
      paoMonths: { type: Number },
    },

    certifications:  [{ type: String }],
    countryOfOrigin: { type: String, default: "India" },
    madeWithoutList: [{ type: String }],
  },
  { _id: false }
);

// Packaging details for shipping calculations
const packagingSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["bottle", "tube", "jar", "sachet", "pump", "dropper", "spray", "box", "pouch"],
    },
    material:     { type: String },
    isRecyclable: { type: Boolean, default: false },
    dimensions: {
      length: { type: Number },
      width:  { type: Number },
      height: { type: Number },
    },
    shippingWeight: { type: Number },
  },
  { _id: false }
);

// ─────────────────────────────────────────────────────────────────────────────
// NEW: Category image — one representative image per category string
// Used on category listing pages, nav dropdowns, home category sections
// ─────────────────────────────────────────────────────────────────────────────
const categoryImageSchema = new mongoose.Schema(
  {
    category: {
      type:     String,
      required: true,
      trim:     true,
      // Must match one of the product's category values exactly
      // e.g. "Face Serum", "Body Butter", "Eye Cream"
    },
    image: {
      url:       { type: String, required: true },
      public_id: { type: String, required: true },
      altText:   { type: String, default: "" },
    },
  },
  { _id: false }
);

// ─────────────────────────────────────────────────────────────────────────────
// NEW: Tag image — one representative image per fixed tag badge
// Used on tag-filtered pages, promotional sections ("New Arrivals" banner etc.)
// ─────────────────────────────────────────────────────────────────────────────
const tagImageSchema = new mongoose.Schema(
  {
    tag: {
      type:     String,
      required: true,
      enum:     {
        values:  ["bestseller", "new", "combo", "limited"],
        message: "Tag must be one of: bestseller, new, combo, limited",
      },
    },
    image: {
      url:       { type: String, required: true },
      public_id: { type: String, required: true },
      altText:   { type: String, default: "" },
    },
  },
  { _id: false }
);

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PRODUCT SCHEMA
// ─────────────────────────────────────────────────────────────────────────────

const productSchema = new mongoose.Schema(
  {
    // ── Identity ─────────────────────────────────────────────────────────────
    name: {
      type:      String,
      required:  [true, "Product name is required"],
      trim:      true,
      maxlength: [200, "Name cannot exceed 200 characters"],
    },

    slug: {
      type:      String,
      unique:    true,
      lowercase: true,
      trim:      true,
    },

    brand: {
      type:    String,
      trim:    true,
      default: "Aurora Botanicals",
    },

    // ── Categorisation ────────────────────────────────────────────────────────
    category: {
      type:     String,
      required: [true, "Category is required"],
      trim:     true,
    },

    subCategory: {
      type: String,
      trim: true,
    },

    // Single fixed label badge shown on product card
    tag: {
      type: String,
      enum: {
        values:  ["bestseller", "new", "combo", "limited"],
        message: "Tag must be one of: bestseller, new, combo, limited",
      },
      default: null,
    },

    // ── NEW: Category image ───────────────────────────────────────────────────
    // Representative image for this product's category.
    // Shown on: category listing pages, nav dropdowns, homepage category grid.
    // One per product — the admin picks which image represents this category.
    // Tip: only one product per category needs this set; your frontend query
    //      can pick the first product in each category that has this populated.
    categoryImage: {
      type:    categoryImageSchema,
      default: null,
    },

    // ── NEW: Tag image — one image for the tag this product carries ───────────
    // Shown on: "Bestsellers" section banner, "New Arrivals" hero strip, etc.
    tagImage: {
      type: tagImageSchema,
      default: null,
    },

    // ── Descriptions ─────────────────────────────────────────────────────────
    shortDescription: {
      type:      String,
      trim:      true,
      maxlength: 300,
    },

    description: {
      type: String,
      trim: true,
    },

    highlights: [{ type: String, trim: true }],

    // ── Media ────────────────────────────────────────────────────────────────
    images: {
      type:     [imageSchema],
      validate: {
        validator: (arr) => arr.length > 0,
        message:   "At least one product image is required",
      },
    },

    videos: [
      {
        url:       { type: String, required: true },
        public_id: { type: String, required: true },
        title:     { type: String, trim: true },
        isPrimary: { type: Boolean, default: false },
        _id:       false,
      },
    ],

    // ── Variants (SKUs) ───────────────────────────────────────────────────────
    variants: {
      type:     [variantSchema],
      validate: {
        validator: (arr) => arr.length > 0,
        message:   "At least one variant is required",
      },
    },

    // ── Skincare-specific ─────────────────────────────────────────────────────
    skincareDetails: skincareDetailsSchema,

    // ── Ingredients ──────────────────────────────────────────────────────────
    ingredients: [ingredientSchema],

    // ── Packaging & Shipping ─────────────────────────────────────────────────
    packaging: packagingSchema,

    isFreeShipping: { type: Boolean, default: false },
    hsn:            { type: String, trim: true },
    taxRate:        { type: Number, default: 18, enum: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28] },

    // ── Ratings ───────────────────────────────────────────────────────────────
    ratings: {
      average: { type: Number, default: 0, min: 0, max: 5 },
      count:   { type: Number, default: 0, min: 0 },
      breakdown: {
        five:  { type: Number, default: 0 },
        four:  { type: Number, default: 0 },
        three: { type: Number, default: 0 },
        two:   { type: Number, default: 0 },
        one:   { type: Number, default: 0 },
      },
    },

    // ── Visibility & Status ───────────────────────────────────────────────────
    status: {
      type:    String,
      enum:    ["draft", "active", "archived", "out_of_stock"],
      default: "draft",
    },

    isActive:     { type: Boolean, default: true  },
    isFeatured:   { type: Boolean, default: false },
    isBestseller: { type: Boolean, default: false },
    isNewArrival: { type: Boolean, default: false },
    isLimited: { type: Boolean, default: false },

    publishedAt: { type: Date, default: null },

    // ── Related products ─────────────────────────────────────────────────────
    relatedProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],

    // ── Soft delete ───────────────────────────────────────────────────────────
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON:     { virtuals: true },
    toObject:   { virtuals: true },
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// INDEXES
// ─────────────────────────────────────────────────────────────────────────────

productSchema.index({ category: 1, status: 1 });
productSchema.index({ subCategory: 1 });
productSchema.index({ status: 1, isActive: 1 });
productSchema.index({ isFeatured: 1 });
productSchema.index({ isBestseller: 1 });
productSchema.index({ isNewArrival: 1 });
productSchema.index({ isLimited: 1 });
productSchema.index({ tag: 1 });
productSchema.index({ "categoryImage.category": 1 });
productSchema.index({ "tagImage.tag": 1 });
productSchema.index({ "skincareDetails.skinType": 1 });
productSchema.index({ "skincareDetails.skinConcerns": 1 });
productSchema.index({ "skincareDetails.claims": 1 });
productSchema.index({ "ratings.average": -1 });
productSchema.index({ createdAt: -1 });

productSchema.index(
  { name: "text", shortDescription: "text", tag: "text" },
  { weights: { name: 10, tag: 5, shortDescription: 3 } }
);

// ─────────────────────────────────────────────────────────────────────────────
// VIRTUALS
// ─────────────────────────────────────────────────────────────────────────────

productSchema.virtual("totalStock").get(function () {
  if (!Array.isArray(this.variants) || this.variants.length === 0) return 0;
  return this.variants.reduce((sum, v) => sum + (v.stock?.quantity || 0), 0);
});

productSchema.virtual("inStock").get(function () {
  if (!Array.isArray(this.variants) || this.variants.length === 0) return false;
  return this.variants.some((v) => v.isActive && v.stock?.quantity > 0);
});

productSchema.virtual("defaultVariant").get(function () {
  if (!Array.isArray(this.variants) || this.variants.length === 0) return null;
  return this.variants.find((v) => v.isDefault && v.isActive) || this.variants[0];
});

productSchema.virtual("priceRange").get(function () {
  if (!Array.isArray(this.variants) || this.variants.length === 0) return "";
  const prices = this.variants.map((v) => v.price.sellingPrice).filter((p) => p != null);
  if (prices.length === 0) return "";
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? `₹${min}` : `₹${min} – ₹${max}`;
});

productSchema.virtual("keyIngredients").get(function () {
  if (!Array.isArray(this.ingredients)) return [];

  return this.ingredients
    .slice(0, 4)
    .map((i) => i.name);
});

// ─────────────────────────────────────────────────────────────────────────────
// HOOKS
// ─────────────────────────────────────────────────────────────────────────────

productSchema.pre("save", function (next) {
  // Auto-generate slug
  if (this.isModified("name") || !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
  }

  // Enforce single default variant
  const defaults = this.variants.filter((v) => v.isDefault);
  if (defaults.length === 0 && this.variants.length > 0) {
    this.variants[0].isDefault = true;
  } else if (defaults.length > 1) {
    this.variants.forEach((v, i) => { v.isDefault = i === 0; });
  }

  // Enforce single primary image
  const primaries = this.images.filter((img) => img.isPrimary);
  if (primaries.length === 0 && this.images.length > 0) {
    this.images[0].isPrimary = true;
  }

  // Sync categoryImage.category to match the product's category field
  if (this.categoryImage && this.categoryImage.image?.url) {
    this.categoryImage.category = this.category;
  }

  // Sync tagImage.tag to match the product's tag field
  // If tag is cleared, remove the tagImage too
  if (!this.tag && this.tagImage) {
    this.tagImage = null;
  }
  if (this.tagImage && this.tag) {
    this.tagImage.tag = this.tag;
  }

});

productSchema.pre("save", function (next) {
  if (this.status === "active") {
    const hasStock = this.variants.some(
      (v) => v.isActive && v.stock.quantity > 0
    );
    if (!hasStock) this.status = "out_of_stock";
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// STATICS
// ─────────────────────────────────────────────────────────────────────────────

productSchema.statics.getActive = function () {
  return this.find({ isActive: true, status: "active", deletedAt: null });
};

productSchema.statics.getBySkinType = function (skinType) {
  return this.find({
    isActive: true, status: "active", deletedAt: null,
    "skincareDetails.skinType": { $in: [skinType, "all"] },
  });
};

productSchema.statics.getByConcern = function (concern) {
  return this.find({
    isActive: true, status: "active", deletedAt: null,
    "skincareDetails.skinConcerns": concern,
  });
};

// NEW: Get one representative image per category
// Returns: [{ category: "Face Serum", image: { url, altText } }, ...]
productSchema.statics.getCategoryImages = async function () {
  return this.aggregate([
    { $match: { isActive: true, deletedAt: null, "categoryImage.image.url": { $exists: true, $ne: "" } } },
    { $group: { _id: "$categoryImage.category", image: { $first: "$categoryImage.image" } } },
    { $project: { _id: 0, category: "$_id", image: 1 } },
  ]);
};

// NEW: Get one representative image per tag across all products
// Returns: [{ tag: "bestseller", image: { url, altText } }, ...]
productSchema.statics.getTagImages = async function () {
  return this.aggregate([
    { $match: { isActive: true, deletedAt: null, "tagImage.image.url": { $exists: true, $ne: "" } } },
    { $group: { _id: "$tagImage.tag", image: { $first: "$tagImage.image" } } },
    { $project: { _id: 0, tag: "$_id", image: 1 } },
  ]);
};

// ─────────────────────────────────────────────────────────────────────────────
// METHODS
// ─────────────────────────────────────────────────────────────────────────────

productSchema.methods.getVariantBySku = function (sku) {
  return this.variants.find((v) => v.sku === sku.toUpperCase());
};

productSchema.methods.isLowStock = function (sku) {
  const variant = this.getVariantBySku(sku);
  if (!variant) return false;
  return variant.stock.quantity <= variant.stock.lowStockAlert;
};

productSchema.methods.recalculateRatings = function (newRating, oldRating = null) {
  const b = this.ratings.breakdown;
  if (oldRating) {
    const key = ["one","two","three","four","five"][oldRating - 1];
    b[key] = Math.max(0, b[key] - 1);
    this.ratings.count = Math.max(0, this.ratings.count - 1);
  }
  const key = ["one","two","three","four","five"][newRating - 1];
  b[key] += 1;
  this.ratings.count += 1;
  const total = b.one*1 + b.two*2 + b.three*3 + b.four*4 + b.five*5;
  this.ratings.average = +(total / this.ratings.count).toFixed(1);
};

// NEW: Set or update the category image for this product
productSchema.methods.setCategoryImage = function ({ url, public_id, altText = "" }) {
  this.categoryImage = {
    category: this.category,
    image: { url, public_id, altText },
  };
};

// NEW: Set or update the tag image for this product
productSchema.methods.setTagImage = function (tag, { url, public_id, altText = "" }) {
  this.tagImage = { tag, image: { url, public_id, altText } };
};

// NEW: Remove the tag image
productSchema.methods.removeTagImage = function () {
  this.tagImage = null;
};

const Product = mongoose.model("Product", productSchema);

module.exports = Product;