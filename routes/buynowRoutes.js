const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const Product = require('../models/Product');
const Banner =require('../models/Banner')
const Voucher=require('../models/Voucher')
const { auth } = require("../middleware/auth");
const BuyNow = require("../models/BuyNow");

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({ storage });

router.post("/buy-now", auth, upload.none(), async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;

    const { productId, variantIndex, quantity = 1 } = req.body;

    if (!productId || variantIndex === undefined || variantIndex === null) {
      return res.status(400).json({
        success: false,
        message: "productId and variantIndex are required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid productId",
      });
    }

    const parsedVariantIndex = Number(variantIndex);
    const parsedQuantity = Number(quantity) || 1;

    if (Number.isNaN(parsedVariantIndex) || parsedVariantIndex < 0) {
      return res.status(400).json({
        success: false,
        message: "variantIndex must be a valid non-negative number",
      });
    }

    if (Number.isNaN(parsedQuantity) || parsedQuantity < 1) {
      return res.status(400).json({
        success: false,
        message: "quantity must be at least 1",
      });
    }

    const product = await Product.findOne({
      _id: productId,
      deletedAt: null,
      isActive: true,
    }).lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found or inactive",
      });
    }

    const variant = product.variants?.[parsedVariantIndex];

    if (!variant) {
      return res.status(404).json({
        success: false,
        message: "Variant not found for the given variantIndex",
      });
    }

    const availableQuantity = Number(variant?.stock?.quantity || 0);

    if (availableQuantity < 1) {
      return res.status(400).json({
        success: false,
        message: "Selected variant is out of stock",
      });
    }

    if (parsedQuantity > availableQuantity) {
      return res.status(400).json({
        success: false,
        message: `Only ${availableQuantity} item(s) available in stock`,
      });
    }

    if (!variant?.sku) {
      return res.status(400).json({
        success: false,
        message: "Selected variant SKU is missing",
      });
    }

    const mrp = Number(variant?.price?.mrp || 0);
    const sellingPrice = Number(variant?.price?.sellingPrice || 0);

    if (Number.isNaN(mrp) || Number.isNaN(sellingPrice)) {
      return res.status(400).json({
        success: false,
        message: "Variant price is invalid",
      });
    }

    const image =
      variant?.images?.[0]?.url ||
      product?.images?.[0]?.url ||
      "";

    const buyNowPayload = {
      userId,
      productId: product._id,
      variantIndex: parsedVariantIndex,
      quantity: parsedQuantity,

      // optional snapshot fields if your schema supports them
      sku: variant.sku || "",
      name: product.name || "",
      image,
      category: product.category || "",
      price: {
        mrp,
        sellingPrice,
      },
      attributes: {
        size: variant?.attributes?.size || "",
        shade: variant?.attributes?.shade || "",
        scent: variant?.attributes?.scent || "",
        packOf:
          variant?.attributes?.packOf === undefined ||
          variant?.attributes?.packOf === null
            ? null
            : Number(variant.attributes.packOf),
      },
      stockAvailable: availableQuantity,
      selectedAt: new Date(),
    };

    const buyNow = await BuyNow.findOneAndUpdate(
      { userId },
      { $set: buyNowPayload },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    );

    return res.status(201).json({
      success: true,
      message: "Buy now product stored successfully",
      data: buyNow,
    });
  } catch (error) {
    console.error("Error storing buy now item:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to store buy now product",
    });
  }
});


router.get("/buynow", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    // ── 1. Fetch BuyNow record ─────────────────────────────────────────────
    const buyNow = await BuyNow.findOne({ userId }).lean();

    if (!buyNow) {
      return res.status(404).json({
        success: false,
        message: "No Buy Now item found",
      });
    }

    // ── 2. Fetch latest product data ───────────────────────────────────────
    const product = await Product.findOne({
      _id:       buyNow.productId,
      deletedAt: null,
    }).lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product no longer available",
      });
    }

    const variant = product.variants?.[buyNow.variantIndex];

    if (!variant) {
      return res.status(404).json({
        success: false,
        message: "Selected variant no longer available",
      });
    }

    // ── 3. Validate stock ──────────────────────────────────────────────────
    const stockQty        = variant.stock?.quantity || 0;
    let   stockStatus     = "in_stock";
    let   isAvailable     = true;
    let   unavailableReason = null;

    if (stockQty === 0) {
      stockStatus       = "out_of_stock";
      isAvailable       = false;
      unavailableReason = "Out of stock";
    } else if (stockQty < buyNow.quantity) {
      stockStatus       = "insufficient_stock";
      unavailableReason = `Only ${stockQty} left in stock`;
    } else if (stockQty <= (variant.stock?.lowStockAlert || 10)) {
      stockStatus = "low_stock";
    }

    const latestMRP          = variant.price?.mrp;
    const latestSellingPrice = variant.price?.sellingPrice;

    // ── 4. Build the single hydrated item ──────────────────────────────────
    const hydratedItem = {
      _id:          buyNow._id,
      productId:    buyNow.productId,
      variantIndex: buyNow.variantIndex,
      sku:          variant.sku,
      name:         product.name,
      image:        variant.images?.[0]?.url || product.images?.[0]?.url || "",
      price: {
        mrp:          latestMRP,
        sellingPrice: latestSellingPrice,
      },
      quantity:           buyNow.quantity,
      attributes:         variant.attributes,
      category:           product.category,
      stockQty,
      stockStatus,
      isAvailable,
      unavailableReason,
      maxAllowedQuantity: Math.min(stockQty, 10),
    };

    // Subtotals — only if available
    let subtotal  = 0;
    let totalMRP  = 0;
    let totalItems = 0;

    if (isAvailable) {
      subtotal   = Math.round(latestSellingPrice * buyNow.quantity);
      totalMRP   = Math.round(latestMRP          * buyNow.quantity);
      totalItems = buyNow.quantity;
    }

    const mrpSavings = Math.round(totalMRP - subtotal);

    // ── 5. Banner Calculation ──────────────────────────────────────────────
    const now = new Date();
    const normalize = (val) => String(val || "").trim().toLowerCase();

    const activeBanners = await Banner.find({
      isActive:  true,
      deletedAt: null,
      startDate: { $lte: now },
      endDate:   { $gte: now },
    }).lean();

    const bannerCandidates = activeBanners
      .map((banner) => {
        // Gate: global usage cap
        if (banner.maxUses != null && banner.usedCount >= banner.maxUses) return null;

        // Check if banner applies to this item
        let applies = false;
        if (banner.appliesTo === "all") {
          applies = true;
        } else if (banner.appliesTo === "product" || banner.appliesTo === "products") {
          applies = (banner.productIds || []).map(String).includes(String(buyNow.productId));
        } else if (banner.appliesTo === "category") {
          applies = (banner.categoryIds || [])
            .map(normalize)
            .includes(normalize(product.category));
        }

        if (!applies || !isAvailable) return null;

        // Apply up to perUserLimit units
        const perOrderLimit   = banner.perUserLimit ?? null;
        const unitsToDiscount = perOrderLimit != null
          ? Math.min(buyNow.quantity, perOrderLimit)
          : buyNow.quantity;

        const eligibleLineTotal = latestSellingPrice * unitsToDiscount;

        let discountAmount =
          banner.discountType === "percentage"
            ? (eligibleLineTotal * banner.discount) / 100
            : banner.discount * unitsToDiscount;

        discountAmount = Math.min(discountAmount, eligibleLineTotal);
        discountAmount = Math.round(discountAmount);

        if (discountAmount === 0) return null;

        return {
          bannerId:       banner._id,
          title:          banner.title,
          description:    banner.description || "",
          discount:       banner.discount,
          discountType:   banner.discountType,
          appliesTo:      banner.appliesTo,
          image:          banner.image || null,
          endDate:        banner.endDate,
          perOrderLimit,
          discountAmount,
          unitsAffected:  unitsToDiscount,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.discountAmount - a.discountAmount);

    const bestBanner    = bannerCandidates[0] || null;
    const bannerDiscount = bestBanner?.discountAmount || 0;

    // ── 6. Available Vouchers ──────────────────────────────────────────────
    const allVouchers = await Voucher.find({
      isActive:  true,
      deletedAt: null,
      startDate: { $lte: now },
      endDate:   { $gte: now },
    }).lean();

    const User        = require("../models/User");
    const currentUser = await User.findById(userId).select("createdAt").lean();

    const availableVouchers = [];

    for (const voucher of allVouchers) {
      // Gate 1: Global cap
      if (voucher.maxUses != null && voucher.usedCount >= voucher.maxUses) continue;

      // Gate 2: Per-user limit
      const userUsageCount = (voucher.usageLog || []).filter(
        (log) => String(log.userId) === String(userId)
      ).length;
      if (userUsageCount >= (voucher.perUserLimit || 1)) continue;

      // Gate 3: Eligibility
      if (voucher.eligibility === "new_users" || voucher.eligibility === "existing_users") {
        if (!currentUser) continue;
        const isNewUser = new Date(currentUser.createdAt) >= new Date(voucher.createdAt);
        if (voucher.eligibility === "new_users"      && !isNewUser) continue;
        if (voucher.eligibility === "existing_users" &&  isNewUser) continue;
      }

      // Gate 4: appliesTo scope — check against single item
      let itemEligible = false;
      if (voucher.appliesTo === "all") {
        itemEligible = true;
      } else if (voucher.appliesTo === "product") {
        itemEligible = (voucher.applicableProductIds || [])
          .map(String)
          .includes(String(buyNow.productId));
      } else if (voucher.appliesTo === "category") {
        itemEligible = (voucher.applicableCategories || [])
          .map(normalize)
          .includes(normalize(product.category));
      }

      if (!itemEligible || !isAvailable) continue;

      const eligibleTotal = latestSellingPrice * buyNow.quantity;
      const minOrderValue = voucher.minOrderValue || 0;
      const isEligible    = eligibleTotal >= minOrderValue;

      let potentialDiscount =
        voucher.discountType === "percentage"
          ? (eligibleTotal * voucher.discount) / 100
          : voucher.discount;

      if (voucher.maxDiscountAmount != null) {
        potentialDiscount = Math.min(potentialDiscount, voucher.maxDiscountAmount);
      }

      potentialDiscount = Math.min(potentialDiscount, eligibleTotal);
      potentialDiscount = Math.round(potentialDiscount);

      availableVouchers.push({
        voucherId:            voucher._id,
        code:                 voucher.code,
        title:                voucher.title,
        description:          voucher.description || "",
        discountType:         voucher.discountType,
        discount:             voucher.discount,
        maxDiscountAmount:    voucher.maxDiscountAmount || null,
        minOrderValue,
        appliesTo:            voucher.appliesTo,
        eligibility:          voucher.eligibility,
        endDate:              voucher.endDate,
        applicableCategories: voucher.appliesTo === "category"
          ? (voucher.applicableCategories || [])
          : [],
        isEligible,
        amountNeeded:      isEligible ? 0 : Math.round(minOrderValue - eligibleTotal),
        potentialDiscount: isEligible ? potentialDiscount : 0,
        eligibleTotal:     Math.round(eligibleTotal),
      });
    }

    availableVouchers.sort((a, b) => {
      if (a.isEligible !== b.isEligible) return b.isEligible - a.isEligible;
      return b.potentialDiscount - a.potentialDiscount;
    });

    // ── 7. Pricing ─────────────────────────────────────────────────────────
    // Note: voucher is NOT pre-applied for BuyNow — user picks at checkout
    // Frontend passes selected voucher code separately when placing order
    let appliedVoucher  = buyNow.appliedVoucher || null;
let voucherDiscount = 0;

if (appliedVoucher) {
  // Check if it's still in the available list and still eligible
  const stillValid = availableVouchers.find(
    (v) => String(v.voucherId) === String(appliedVoucher.voucherId) && v.isEligible
  );

  if (!stillValid) {
    // Voucher no longer valid — clear it from DB and response
    appliedVoucher  = null;
    voucherDiscount = 0;
    await BuyNow.findOneAndUpdate({ userId }, { appliedVoucher: null });
  } else {
    voucherDiscount = appliedVoucher.discountAmount || 0;
  }
}
const totalDiscount = bannerDiscount + voucherDiscount;
const total         = Math.max(0, Math.round(subtotal - totalDiscount));
    const pricing = {
      subtotal,
      totalMRP,
      mrpSavings,
      bannerDiscount,
      voucherDiscount: 0,   // applied at checkout when user picks a voucher
      totalDiscount,
      total,
      totalItems,
    };

    // ── 8. Response ────────────────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      data: {
        buyNowId:   buyNow._id,
        item:       hydratedItem,     // single item (not array)
        pricing,
        bestBanner,
        allApplicableBanners: bannerCandidates,
        availableVouchers,
        appliedVoucher: null,         // always null here — applied at checkout
        appliedVoucher,
      },
    });

  } catch (error) {
    console.error("Error fetching buy now:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch buy now details",
    });
  }
});

router.patch("/buynow/quantity", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { quantity } = req.body;

    // ── 1. Basic validation ────────────────────────────────────────────────
    if (!quantity || Number(quantity) < 1) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be at least 1",
      });
    }

    const newQty = Number(quantity);

    // ── 2. Find BuyNow record by logged-in user ───────────────────────────
    const buyNow = await BuyNow.findOne({ userId });

    if (!buyNow) {
      return res.status(404).json({
        success: false,
        message: "No Buy Now item found",
      });
    }

    // ── 3. Fetch latest product ────────────────────────────────────────────
    const product = await Product.findOne({
      _id: buyNow.productId,
      deletedAt: null,
      isActive: true,
    }).lean();

    if (!product) {
      return res.status(400).json({
        success: false,
        message: "Selected product is no longer available",
      });
    }

    const variant = product.variants?.[buyNow.variantIndex];

    if (!variant) {
      return res.status(400).json({
        success: false,
        message: "Selected variant is no longer available",
      });
    }

    if (variant.isActive === false) {
      return res.status(400).json({
        success: false,
        message: "Selected variant is currently inactive",
      });
    }

    const availableStock = Number(variant?.stock?.quantity || 0);

    // ── 4. Stock validation ────────────────────────────────────────────────
    if (availableStock === 0) {
      return res.status(400).json({
        success: false,
        message: `"${product.name}" is out of stock`,
        stockStatus: "out_of_stock",
        available: 0,
      });
    }

    if (newQty > availableStock) {
      return res.status(400).json({
        success: false,
        message: `Only ${availableStock} unit${availableStock > 1 ? "s" : ""} of "${product.name}" available. You can add up to ${availableStock}.`,
        stockStatus: "insufficient_stock",
        available: availableStock,
        maxAllowed: availableStock,
      });
    }

    const isLowStock = availableStock <= (variant.stock?.lowStockAlert || 10);

    // ── 5. Update quantity only ────────────────────────────────────────────
    buyNow.quantity = newQty;
    await buyNow.save();

    // ── 6. Latest pricing based on updated quantity ────────────────────────
    const latestMRP = Number(variant?.price?.mrp || 0);
    const latestSellingPrice = Number(variant?.price?.sellingPrice || 0);

    const subtotal = Math.round(latestSellingPrice * newQty);
    const totalMRP = Math.round(latestMRP * newQty);
    const mrpSavings = Math.max(0, totalMRP - subtotal);

    return res.status(200).json({
      success: true,
      message: "Buy Now quantity updated successfully",
      warning: isLowStock
        ? `Only ${availableStock} unit${availableStock > 1 ? "s" : ""} left in stock`
        : null,
      data: {
        buyNowId: buyNow._id,
        quantity: newQty,
        available: availableStock,
        stockStatus: isLowStock ? "low_stock" : "in_stock",
        pricing: {
          subtotal,
          totalMRP,
          mrpSavings,
          totalDiscount: 0,
          total: subtotal,
          totalItems: newQty,
        },
      },
    });
  } catch (error) {
    console.error("Update Buy Now Quantity Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update buy now quantity",
    });
  }
});


router.post("/buynow/voucher/apply", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { code } = req.body;

    // ── 1. Validate Code ───────────────────────────────────────────────────
    if (!code?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Voucher code is required",
      });
    }

    // ── 2. Find Voucher ────────────────────────────────────────────────────
    const voucher = await Voucher.findOne({
      code: code.trim().toUpperCase(),
      isActive: true,
      deletedAt: null,
    }).lean();

    if (!voucher) {
      return res.status(400).json({
        success: false,
        message: "Invalid voucher code",
      });
    }

    // ── 3. Date Validation ─────────────────────────────────────────────────
    const now = new Date();

    if (now < new Date(voucher.startDate)) {
      return res.status(400).json({
        success: false,
        message: "This voucher is not active yet",
      });
    }

    if (now > new Date(voucher.endDate)) {
      return res.status(400).json({
        success: false,
        message: "This voucher has expired",
      });
    }

    // ── 4. Global Usage Limit ──────────────────────────────────────────────
    if (
      voucher.maxUses != null &&
      voucher.usedCount >= voucher.maxUses
    ) {
      return res.status(400).json({
        success: false,
        message: "This voucher has reached its usage limit",
      });
    }

    // ── 5. Per User Limit ──────────────────────────────────────────────────
    const userUsageCount = (voucher.usageLog || []).filter(
      (log) => String(log.userId) === String(userId)
    ).length;

    if (userUsageCount >= (voucher.perUserLimit || 1)) {
      return res.status(400).json({
        success: false,
        message: "You have already used this voucher",
      });
    }

    // ── 6. User Eligibility Check ──────────────────────────────────────────
    if (
      voucher.eligibility === "new_users" ||
      voucher.eligibility === "existing_users"
    ) {
      const User = require("../models/User");

      const user = await User.findById(userId)
        .select("createdAt")
        .lean();

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const isNewUser =
        new Date(user.createdAt) >= new Date(voucher.createdAt);

      if (voucher.eligibility === "new_users" && !isNewUser) {
        return res.status(400).json({
          success: false,
          message: "This voucher is only for new users",
        });
      }

      if (voucher.eligibility === "existing_users" && isNewUser) {
        return res.status(400).json({
          success: false,
          message: "This voucher is only for existing users",
        });
      }
    }

    // ── 7. Fetch BuyNow ────────────────────────────────────────────────────
    const buyNow = await BuyNow.findOne({ userId });

    if (!buyNow) {
      return res.status(400).json({
        success: false,
        message: "Buy now item not found",
      });
    }

    // ── 8. Fetch Product ───────────────────────────────────────────────────
    const product = await Product.findOne({
      _id: buyNow.productId,
      deletedAt: null,
    }).lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // ── 9. Validate Variant ────────────────────────────────────────────────
    const variant = product.variants?.[buyNow.variantIndex];

    if (!variant) {
      return res.status(400).json({
        success: false,
        message: "Product variant not found",
      });
    }

    if (variant.stock?.quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: "Product is out of stock",
      });
    }

    // ── 10. Eligibility Based On AppliesTo ─────────────────────────────────
    const normalize = (val) =>
      String(val || "").trim().toLowerCase();

    let isEligible = false;

    if (voucher.appliesTo === "all") {
      isEligible = true;
    }

    if (voucher.appliesTo === "product") {
      isEligible = (voucher.applicableProductIds || [])
        .map(String)
        .includes(String(product._id));
    }

    if (voucher.appliesTo === "category") {
      isEligible = (voucher.applicableCategories || [])
        .map(normalize)
        .includes(normalize(product.category));
    }

    if (!isEligible) {
      return res.status(400).json({
        success: false,
        message:
          voucher.appliesTo === "category"
            ? `This voucher is only valid for: ${(voucher.applicableCategories || []).join(", ")}`
            : "This product is not eligible for this voucher",
      });
    }

    // ── 11. Calculate Eligible Total ───────────────────────────────────────
    const eligibleTotal =
      (variant.price?.sellingPrice || 0) * buyNow.quantity;

    // ── 12. Minimum Order Value ────────────────────────────────────────────
    const minOrderValue = voucher.minOrderValue || 0;

    if (eligibleTotal < minOrderValue) {
      return res.status(400).json({
        success: false,
        message: `Add ₹${Math.round(
          minOrderValue - eligibleTotal
        )} more to use this voucher`,
      });
    }

    // ── 13. Calculate Discount ─────────────────────────────────────────────
    let discountAmount =
      voucher.discountType === "percentage"
        ? (eligibleTotal * voucher.discount) / 100
        : voucher.discount;

    if (voucher.maxDiscountAmount != null) {
      discountAmount = Math.min(
        discountAmount,
        voucher.maxDiscountAmount
      );
    }

    discountAmount = Math.min(discountAmount, eligibleTotal);

    discountAmount = Math.round(discountAmount);

    // ── 14. Apply Voucher ──────────────────────────────────────────────────
    buyNow.appliedVoucher = {
      voucherId: voucher._id,
      code: voucher.code,
      discountType: voucher.discountType,
      discount: voucher.discount,
      discountAmount,
    };

    // ── 15. Recalculate Pricing ────────────────────────────────────────────
    await buyNow.recalculatePricing();

    await buyNow.save();

    // ── 16. Response ───────────────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      message: `Voucher applied! You're saving ₹${discountAmount}`,
      data: {
        code: voucher.code,
        title: voucher.title,
        discountType: voucher.discountType,
        discount: voucher.discount,
        discountAmount,
        eligibleTotal: Math.round(eligibleTotal),
        pricing: buyNow.pricing,
      },
    });

  } catch (error) {
    console.error("Error applying voucher on buy now:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to apply voucher",
    });
  }
});


router.delete("/buynow/voucher/remove", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    // ── 1. Find BuyNow ─────────────────────────────────────────────────────
    const buyNow = await BuyNow.findOne({ userId });

    if (!buyNow) {
      return res.status(404).json({
        success: false,
        message: "Buy now item not found",
      });
    }

    // ── 2. Check Applied Voucher ───────────────────────────────────────────
    if (!buyNow.appliedVoucher) {
      return res.status(400).json({
        success: false,
        message: "No voucher applied to remove",
      });
    }

    // ── 3. Remove Voucher ──────────────────────────────────────────────────
    buyNow.appliedVoucher = null;

    // ── 4. Recalculate Pricing ─────────────────────────────────────────────
    await buyNow.recalculatePricing();

    // ── 5. Save ────────────────────────────────────────────────────────────
    await buyNow.save();

    // ── 6. Response ────────────────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      message: "Voucher removed successfully",
      data: {
        pricing: buyNow.pricing,
      },
    });

  } catch (error) {
    console.error("Error removing buy now voucher:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to remove voucher",
    });
  }
});

module.exports = router;