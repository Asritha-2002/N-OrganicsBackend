const express = require("express");
const multer = require("multer");
const mongoose = require("mongoose");
const Cart = require("../models/Cart");
const Product = require('../models/Product');
const Banner =require('../models/Banner')
const Voucher=require('../models/Voucher')
const { auth } = require("../middleware/auth");
const { uploadImageToCloudinary } = require("../config/cloudinary");

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({ storage });

router.post("/cart/items", auth, upload.single("image"), async (req, res) => {
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
        message: "Product not found",
      });
    }

    const variant = product.variants?.[parsedVariantIndex];

    if (!variant) {
      return res.status(404).json({
        success: false,
        message: "Variant not found for the given variantIndex",
      });
    }

    let imageUrl =
      variant?.images?.[0]?.url ||
      product?.images?.[0]?.url ||
      "";

    if (req.file) {
      const uploadResult = await uploadImageToCloudinary(req.file.buffer);
      imageUrl = uploadResult.url;
    }

    const cartItem = {
      productId: product._id,
      variantIndex: parsedVariantIndex,
      sku: variant.sku || "",
      name: product.name || "",
      image: imageUrl,
      price: {
        mrp: Number(variant?.price?.mrp || 0),
        sellingPrice: Number(variant?.price?.sellingPrice || 0),
      },
      quantity: parsedQuantity,
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
      category: product.category || "",
      addedAt: new Date(),
    };

    if (!cartItem.sku) {
      return res.status(400).json({
        success: false,
        message: "Selected variant SKU is missing",
      });
    }

    if (
      Number.isNaN(cartItem.price.mrp) ||
      Number.isNaN(cartItem.price.sellingPrice)
    ) {
      return res.status(400).json({
        success: false,
        message: "Variant price is invalid",
      });
    }

    let cart = await Cart.findOne({ userId });

    if (!cart) {
      cart = new Cart({
        userId,
        items: [],
      });
    }

    const existingItem = cart.items.find(
      (item) =>
        item.productId.toString() === product._id.toString() &&
        Number(item.variantIndex) === parsedVariantIndex
    );

    if (existingItem) {
      return res.status(409).json({
        success: false,
        message: "Product already exists in cart",
        alreadyInCart: true,
        data: cart,
      });
    }

    cart.items.push(cartItem);

    if (typeof cart.recalculatePricing === "function") {
      cart.recalculatePricing();
    }

    await cart.save();

    return res.status(201).json({
      success: true,
      message: "Item added to cart successfully",
      alreadyInCart: false,
      data: cart,
    });
  } catch (error) {
    console.error("Error adding cart item:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to add item to cart",
    });
  }
});

router.get("/cart", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    // ── 1. Fetch Cart ──────────────────────────────────────────────────────
    const cart = await Cart.findOne({ userId }).lean();

    if (!cart || cart.items.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          items:            [],
          appliedVoucher:   null,
          appliedBanner:    null,
          pricing: {
            subtotal:        0,
            totalMRP:        0,
            voucherDiscount: 0,
            bannerDiscount:  0,
            totalDiscount:   0,
            total:           0,
            totalItems:      0,
          },
          availableVouchers: [],
          bestBanner:        null,
        },
      });
    }

    // ── 2. Hydrate: fetch latest product data for all cart items ───────────
    const productIds = [...new Set(cart.items.map((i) => i.productId))];

    const products = await Product.find({
      _id:       { $in: productIds },
      deletedAt: null,
    }).lean();

    const productMap = {};
    products.forEach((p) => {
      productMap[String(p._id)] = p;
    });

    // ── 3. Build hydrated + validated items ────────────────────────────────
    let subtotal   = 0;
    let totalMRP   = 0;
    let totalItems = 0;

    const hydratedItems = cart.items.map((item) => {
      const product = productMap[String(item.productId)];

      if (!product) {
        return {
          ...item,
          isAvailable:       false,
          unavailableReason: "Product no longer available",
          stockStatus:       "unavailable",
        };
      }

      const variant = product.variants?.[item.variantIndex];

      if (!variant) {
        return {
          ...item,
          isAvailable:       false,
          unavailableReason: "Variant no longer available",
          stockStatus:       "unavailable",
        };
      }

      const stockQty        = variant.stock?.quantity || 0;
      let stockStatus       = "in_stock";
      let isAvailable       = true;
      let unavailableReason = null;

      if (stockQty === 0) {
        stockStatus       = "out_of_stock";
        isAvailable       = false;
        unavailableReason = "Out of stock";
      } else if (stockQty < item.quantity) {
        stockStatus       = "insufficient_stock";
        unavailableReason = `Only ${stockQty} left in stock`;
      } else if (stockQty <= variant.stock?.lowStockAlert) {
        stockStatus = "low_stock";
      }

      const latestMRP          = variant.price?.mrp          || item.price.mrp;
      const latestSellingPrice = variant.price?.sellingPrice || item.price.sellingPrice;
      const priceChanged       = latestSellingPrice !== item.price.sellingPrice;

      if (isAvailable) {
        subtotal   += latestSellingPrice * item.quantity;
        totalMRP   += latestMRP          * item.quantity;
        totalItems += item.quantity;
      }

      return {
        ...item,
        name:  product.name,
        image: variant.images?.[0]?.url || product.images?.[0]?.url || item.image,
        price: {
          mrp:          latestMRP,
          sellingPrice: latestSellingPrice,
        },
        category:           product.category,
        stockQty,
        stockStatus,
        isAvailable,
        unavailableReason,
        priceChanged,
        oldPrice:           priceChanged ? item.price.sellingPrice : null,
        maxAllowedQuantity: Math.min(stockQty, 10),
      };
    });

    subtotal         = Math.round(subtotal);
    totalMRP         = Math.round(totalMRP);
    const mrpSavings = Math.round(totalMRP - subtotal);

    // ── 4. Banner Calculation — Per-Item with perUserLimit unit cap ────────
    // perUserLimit on a banner = max units across the entire order that
    // can receive the discount. Units are consumed in cart-item order.
    // Only eligible items (by appliesTo / productIds / categoryIds) consume
    // from the limit — ineligible items are skipped entirely.

// ── 4. Banner Calculation — Pick ONE best banner, max discount for customer ──
// Strategy:
//   1. For each active banner, find eligible items and sort them by unit price
//      descending so the discount hits the most expensive units first (best
//      for the customer).
//   2. Apply the banner to at most perUserLimit units (or all if not set).
//   3. The banner that produces the highest total discount wins — that single
//      banner becomes bestBanner. No stacking.

const now = new Date();

const activeBanners = await Banner.find({
  isActive:  true,
  deletedAt: null,
  startDate: { $lte: now },
  endDate:   { $gte: now },
}).lean();

const normalize = (val) => String(val || "").trim().toLowerCase();

const bannerCandidates = activeBanners
  .map((banner) => {
    // ── Gate: global usage cap ─────────────────────────────────────────
    if (banner.maxUses != null && banner.usedCount >= banner.maxUses) {
      return null;
    }

    // ── Step 1: Filter only eligible items for this banner ─────────────
    const eligibleItems = hydratedItems.filter((item) => {
      if (!item.isAvailable) return false;

      if (banner.appliesTo === "all") return true;

      if (banner.appliesTo === "product" || banner.appliesTo === "products") {
        return (banner.productIds || [])
          .map(String)
          .includes(String(item.productId));
      }

      if (banner.appliesTo === "category") {
        return (banner.categoryIds || [])
          .map(normalize)
          .includes(normalize(item.category));
      }

      return false;
    });

    // No eligible items in cart — this banner gives nothing
    if (eligibleItems.length === 0) return null;

    // ── Step 2: Sort eligible items by unit sellingPrice DESC ──────────
    // This ensures the discount is applied to the most expensive units
    // first, maximising savings for the customer within the unit cap.
    const sortedEligible = [...eligibleItems].sort(
      (a, b) => b.price.sellingPrice - a.price.sellingPrice
    );

    // ── Step 3: Apply discount up to perUserLimit units ────────────────
    // perUserLimit = max units this banner can discount per order.
    // null / undefined = no cap (all eligible units qualify).
    const perOrderLimit = banner.perUserLimit ?? null; // null means unlimited

    let unitsRemaining      = perOrderLimit ?? Infinity;
    let totalBannerDiscount = 0;
    let unitsDiscounted     = 0;
    const itemBreakdown     = [];

    for (const item of sortedEligible) {
      if (unitsRemaining <= 0) break;

      // How many units of this item can we still discount?
      const unitsToDiscount = perOrderLimit != null
        ? Math.min(item.quantity, unitsRemaining)
        : item.quantity; // no cap — take all units

      if (unitsToDiscount <= 0) continue;

      const eligibleLineTotal = item.price.sellingPrice * unitsToDiscount;

      let itemDiscount =
        banner.discountType === "percentage"
          ? (eligibleLineTotal * banner.discount) / 100
          : banner.discount * unitsToDiscount; // flat = per unit

      itemDiscount = Math.min(itemDiscount, eligibleLineTotal); // safety cap
      itemDiscount = Math.round(itemDiscount);

      totalBannerDiscount += itemDiscount;
      unitsDiscounted     += unitsToDiscount;
      unitsRemaining      -= unitsToDiscount;

      itemBreakdown.push({
        cartItemId:      String(item._id),
        productId:       String(item.productId),
        name:            item.name,
        unitsDiscounted: unitsToDiscount,
        unitPrice:       item.price.sellingPrice,
        eligibleLineTotal,
        itemDiscount,
      });
    }

    if (totalBannerDiscount === 0) return null;

    return {
      bannerId:      banner._id,
      title:         banner.title,
      description:   banner.description || "",
      discount:      banner.discount,
      discountType:  banner.discountType,
      appliesTo:     banner.appliesTo,
      productIds:    banner.productIds  || [],
      categoryIds:   banner.categoryIds || [],
      image:         banner.image       || null,
      endDate:       banner.endDate,
      perOrderLimit: perOrderLimit,     // null = unlimited
      discountAmount: totalBannerDiscount,
      unitsAffected:  unitsDiscounted,
      itemBreakdown,
    };
  })
  .filter(Boolean)
  .sort((a, b) => b.discountAmount - a.discountAmount); // highest discount first

// ── ONE best banner wins — no stacking ────────────────────────────────────
const bestBanner    = bannerCandidates[0] || null;
const bannerDiscount = bestBanner?.discountAmount || 0;

    // ── 5. Available Vouchers for this user + cart ─────────────────────────
   // ── 5. Available Vouchers for this user + cart ─────────────────────────
const allVouchers = await Voucher.find({
  isActive:  true,
  deletedAt: null,
  startDate: { $lte: now },
  endDate:   { $gte: now },
}).lean();

// ── Fetch user ONCE outside loop for eligibility checks ───────────────
const User = require("../models/User");
const currentUser = await User.findById(userId).select("createdAt").lean();

const availableVouchers = [];

for (const voucher of allVouchers) {

  // ── Gate 1: Global usage cap ─────────────────────────────────────────
  if (voucher.maxUses != null && voucher.usedCount >= voucher.maxUses) continue;

  // ── Gate 2: Per-user limit ────────────────────────────────────────────
  const userUsageCount = (voucher.usageLog || []).filter(
    (log) => String(log.userId) === String(userId)
  ).length;
  if (userUsageCount >= (voucher.perUserLimit || 1)) continue;

  // ── Gate 3: Eligibility — new_users vs existing_users ────────────────
  // new_users      → user registered ON or AFTER voucher.createdAt
  // existing_users → user registered BEFORE voucher.createdAt
  if (voucher.eligibility === "new_users" || voucher.eligibility === "existing_users") {
    if (!currentUser) continue; // safety — user not found

    const userRegisteredAt  = new Date(currentUser.createdAt);
    const voucherCreatedAt  = new Date(voucher.createdAt);
    const isNewUser         = userRegisteredAt >= voucherCreatedAt;

    if (voucher.eligibility === "new_users"      && !isNewUser) continue;
    if (voucher.eligibility === "existing_users" &&  isNewUser) continue;
  }
  // eligibility === "all" → no check needed, everyone passes

  // ── Gate 4: Find eligible items based on appliesTo ────────────────────
  const eligibleItems = hydratedItems.filter((item) => {
    if (!item.isAvailable) return false;

    if (voucher.appliesTo === "all") return true;

    if (voucher.appliesTo === "product") {
      return (voucher.applicableProductIds || [])
        .map(String)
        .includes(String(item.productId));
    }

    if (voucher.appliesTo === "category") {
      return (voucher.applicableCategories || [])
        .map(normalize)
        .includes(normalize(item.category));
    }

    return false;
  });

  // No matching items in cart for this voucher scope
  if (eligibleItems.length === 0) continue;

  // ── Gate 5: Minimum order value check on eligible items only ─────────
  const eligibleTotal = eligibleItems.reduce(
    (sum, item) => sum + item.price.sellingPrice * item.quantity, 0
  );

  const minOrderValue = voucher.minOrderValue || 0;
  const isEligible    = eligibleTotal >= minOrderValue;

  // ── Calculate potential discount ──────────────────────────────────────
  let potentialDiscount =
    voucher.discountType === "percentage"
      ? (eligibleTotal * voucher.discount) / 100
      : voucher.discount;

  // Apply maxDiscountAmount cap for percentage vouchers
  if (voucher.maxDiscountAmount != null) {
    potentialDiscount = Math.min(potentialDiscount, voucher.maxDiscountAmount);
  }

  // Discount can never exceed eligible total
  potentialDiscount = Math.min(potentialDiscount, eligibleTotal);
  potentialDiscount = Math.round(potentialDiscount);

  availableVouchers.push({
    voucherId:         voucher._id,
    code:              voucher.code,
    title:             voucher.title,
    description:       voucher.description || "",
    discountType:      voucher.discountType,
    discount:          voucher.discount,
    maxDiscountAmount: voucher.maxDiscountAmount || null,
    minOrderValue,
    appliesTo:         voucher.appliesTo,
    eligibility:       voucher.eligibility,
    endDate:           voucher.endDate,

    applicableCategories: voucher.appliesTo === "category"
    ? (voucher.applicableCategories || [])
    : [],
    // Whether cart currently meets the minimum order value
    isEligible,
    // If not eligible — how much more they need to add
    amountNeeded:      isEligible ? 0 : Math.round(minOrderValue - eligibleTotal),
    // What they'd save if applied right now
    potentialDiscount: isEligible ? potentialDiscount : 0,
    eligibleTotal:     Math.round(eligibleTotal),
  });
}

// Sort: eligible first → then by highest potential discount
availableVouchers.sort((a, b) => {
  if (a.isEligible !== b.isEligible) return b.isEligible - a.isEligible;
  return b.potentialDiscount - a.potentialDiscount;
});
    // ── 6. Re-validate previously applied voucher ──────────────────────────
    let appliedVoucher  = cart.appliedVoucher || null;
    let appliedBanner   = cart.appliedBanner  || null;
    let voucherDiscount = 0;

    if (appliedVoucher) {
      const stillValid = availableVouchers.find(
        (v) => String(v.voucherId) === String(appliedVoucher.voucherId) && v.isEligible
      );

      if (!stillValid) {
        appliedVoucher  = null;
        voucherDiscount = 0;
        await Cart.findOneAndUpdate({ userId }, { appliedVoucher: null });
      } else {
        voucherDiscount = appliedVoucher.discountAmount || 0;
      }
    }

    // ── 7. Final pricing ───────────────────────────────────────────────────
    const totalDiscount = Math.round(voucherDiscount + bannerDiscount);
    const total         = Math.max(0, Math.round(subtotal - totalDiscount));

    const pricing = {
      subtotal,
      totalMRP,
      mrpSavings,
      bannerDiscount,
      voucherDiscount,
      totalDiscount,
      total,
      totalItems,
    };

    // ── 8. Response ────────────────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      data: {
        _id:    cart._id,
        items:  hydratedItems,
        appliedVoucher,
        appliedBanner: bestBanner
          ? {
              bannerId:       bestBanner.bannerId,
              title:          bestBanner.title,
              discountType:   bestBanner.discountType,
              discount:       bestBanner.discount,
              discountAmount: bestBanner.discountAmount,
            }
          : appliedBanner,
        pricing,
        availableVouchers,
        bestBanner,
        allApplicableBanners: bannerCandidates,
      },
    });

  } catch (error) {
    console.error("Error fetching cart:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch cart",
    });
  }
});


router.delete("/cart/item", auth, async (req, res) => {
  try {
    const userId = req.user.id; // From auth middleware
    const { productId, variantIndex } = req.body;

    // 1. Find the user's cart
    const cart = await Cart.findOne({ userId });

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    // 2. Filter out the specific item
    // We match both productId and variantIndex to ensure we delete the right variant
    const initialItemCount = cart.items.length;
    
    cart.items = cart.items.filter(
      (item) =>
        !(
          item.productId.toString() === productId.toString() &&
          item.variantIndex === Number(variantIndex)
        )
    );

    // 3. Check if an item was actually removed
    if (cart.items.length === initialItemCount) {
      return res.status(404).json({
        success: false,
        message: "Item not found in cart",
      });
    }

    // 4. Reset offers & Recalculate Pricing
    // Usually, when an item is removed, the old voucher/banner might not be valid
    cart.appliedVoucher = null;
    cart.appliedBanner = null;
    
    // Use your schema method to update subtotal, total, etc.
    cart.recalculatePricing();

    // 5. Save the updated cart
    await cart.save();

    return res.status(200).json({
      success: true,
      message: "Item removed from cart",
      data: cart,
    });
  } catch (error) {
    console.error("Delete Cart Item Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
});


router.patch("/cart/quantity/:cartItemId", auth, async (req, res) => {
  try {
    const userId      = req.user.id;
    const { cartItemId } = req.params;
    const { quantity }   = req.body;

    // ── 1. Basic validation ────────────────────────────────────────────────
    if (!quantity || Number(quantity) < 1) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be at least 1",
      });
    }

    const newQty = Number(quantity);

    // ── 2. Find cart ───────────────────────────────────────────────────────
    const cart = await Cart.findOne({ userId });

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    // ── 3. Find cart item ──────────────────────────────────────────────────
    const itemIndex = cart.items.findIndex(
      (item) => item._id.toString() === cartItemId
    );

    if (itemIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Cart item not found",
      });
    }

    const cartItem = cart.items[itemIndex];

    // ── 4. Fetch latest product + variant stock from DB ────────────────────
    const product = await Product.findOne({
      _id:       cartItem.productId,
      deletedAt: null,
    }).lean();

    if (!product) {
      return res.status(400).json({
        success: false,
        message: `"${cartItem.name}" is no longer available`,
      });
    }

    const variant = product.variants?.[cartItem.variantIndex];

    if (!variant) {
      return res.status(400).json({
        success: false,
        message: `The selected variant of "${cartItem.name}" is no longer available`,
      });
    }

    if (!variant.isActive) {
      return res.status(400).json({
        success: false,
        message: `The selected variant of "${cartItem.name}" is currently inactive`,
      });
    }

    const availableStock = variant.stock?.quantity || 0;

    // ── 5. Stock availability checks ───────────────────────────────────────
    if (availableStock === 0) {
      return res.status(400).json({
        success:     false,
        message:     `"${cartItem.name}" is out of stock`,
        stockStatus: "out_of_stock",
        available:   0,
      });
    }

    if (newQty > availableStock) {
      return res.status(400).json({
        success:     false,
        // friendly message — tell exactly how many they CAN add
        message:     `Only ${availableStock} unit${availableStock > 1 ? "s" : ""} of "${cartItem.name}" available. You can add up to ${availableStock}.`,
        stockStatus: "insufficient_stock",
        available:   availableStock,
        // Let frontend clamp the stepper to this value automatically
        maxAllowed:  availableStock,
      });
    }

    // Warn if stock is low but quantity is still valid
    const isLowStock = availableStock <= (variant.stock?.lowStockAlert || 10);

    // ── 6. Update quantity ─────────────────────────────────────────────────
    cart.items[itemIndex].quantity = newQty;

    // Reset offers — totals changed so voucher/banner need revalidation
    cart.appliedVoucher = null;
    cart.appliedBanner  = null;

    // ── 7. Recalculate + save ──────────────────────────────────────────────
    cart.recalculatePricing();
    await cart.save();

    return res.status(200).json({
      success: true,
      message: "Quantity updated successfully",
      // Warn frontend if stock is running low
      warning: isLowStock
        ? `Only ${availableStock} unit${availableStock > 1 ? "s" : ""} left in stock`
        : null,
      data: {
        cartItemId,
        quantity:    newQty,
        available:   availableStock,
        stockStatus: isLowStock ? "low_stock" : "in_stock",
        pricing:     cart.pricing,
      },
    });

  } catch (error) {
    console.error("Update Quantity Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update quantity",
    });
  }
});


router.get("/cart/count", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const cart = await Cart.findOne({ userId })
      .select("items")
      .lean();

    // const count = cart?.items?.quantity || 0;
    // console.log(cart?.items)
    const count =
  cart?.items?.reduce((acc, item) => acc + item.quantity, 0) || 0;
//console.log("Total quantity:", count);

    return res.status(200).json({
      success: true,
      count,
    });
  } catch (error) {
    console.error("Cart Count Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get cart count",
    });
  }
});


router.post("/cart/voucher/apply", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { code } = req.body;

    if (!code?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Voucher code is required",
      });
    }

    // ── 1. Find voucher ────────────────────────────────────────────────────
    const voucher = await Voucher.findOne({
      code:      code.trim().toUpperCase(),
      isActive:  true,
      deletedAt: null,
    }).lean();

    if (!voucher) {
      return res.status(400).json({
        success: false,
        message: "Invalid voucher code",
      });
    }

    // ── 2. Date validity ───────────────────────────────────────────────────
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

    // ── 3. Global usage cap ────────────────────────────────────────────────
    if (voucher.maxUses != null && voucher.usedCount >= voucher.maxUses) {
      return res.status(400).json({
        success: false,
        message: "This voucher has reached its usage limit",
      });
    }

    // ── 4. Per-user limit ──────────────────────────────────────────────────
    const userUsageCount = (voucher.usageLog || []).filter(
      (log) => String(log.userId) === String(userId)
    ).length;

    if (userUsageCount >= (voucher.perUserLimit || 1)) {
      return res.status(400).json({
        success: false,
        message: "You have already used this voucher",
      });
    }

    // ── 5. Eligibility check ───────────────────────────────────────────────
    if (
      voucher.eligibility === "new_users" ||
      voucher.eligibility === "existing_users"
    ) {
      const User = require("../models/User");
      const user = await User.findById(userId).select("createdAt").lean();

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

    // ── 6. Fetch cart ──────────────────────────────────────────────────────
    const cart = await Cart.findOne({ userId });

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Your cart is empty",
      });
    }

    // ── 7. Hydrate cart items to get latest prices + categories ───────────
    const productIds = [...new Set(cart.items.map((i) => i.productId))];
    const products   = await Product.find({
      _id:       { $in: productIds },
      deletedAt: null,
    }).lean();

    const productMap = {};
    products.forEach((p) => { productMap[String(p._id)] = p; });

    const normalize = (val) => String(val || "").trim().toLowerCase();

    // Build hydrated items (only available ones matter for discount)
    const hydratedItems = cart.items
      .map((item) => {
        const product = productMap[String(item.productId)];
        if (!product) return null;

        const variant = product.variants?.[item.variantIndex];
        if (!variant || variant.stock?.quantity === 0) return null;

        return {
          ...item.toObject(),
          price: {
            mrp:          variant.price?.mrp          || item.price.mrp,
            sellingPrice: variant.price?.sellingPrice || item.price.sellingPrice,
          },
          category: product.category,
        };
      })
      .filter(Boolean);

    if (hydratedItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No available items in cart to apply voucher",
      });
    }

    // ── 8. Filter eligible items based on appliesTo ────────────────────────
    const eligibleItems = hydratedItems.filter((item) => {
      if (voucher.appliesTo === "all") return true;

      if (voucher.appliesTo === "product") {
        return (voucher.applicableProductIds || [])
          .map(String)
          .includes(String(item.productId));
      }

      if (voucher.appliesTo === "category") {
        return (voucher.applicableCategories || [])
          .map(normalize)
          .includes(normalize(item.category));
      }

      return false;
    });

    if (eligibleItems.length === 0) {
      const scopeMsg =
        voucher.appliesTo === "category"
          ? `This voucher is only valid for: ${(voucher.applicableCategories || []).join(", ")}`
          : "No eligible items in your cart for this voucher";

      return res.status(400).json({
        success: false,
        message: scopeMsg,
      });
    }

    // ── 9. Minimum order value check ───────────────────────────────────────
    const eligibleTotal = eligibleItems.reduce(
      (sum, item) => sum + item.price.sellingPrice * item.quantity,
      0
    );

    const minOrderValue = voucher.minOrderValue || 0;

    if (eligibleTotal < minOrderValue) {
      return res.status(400).json({
        success: false,
        message: `Add ${
          voucher.appliesTo === "category"
            ? `₹${Math.round(minOrderValue - eligibleTotal)} more from ${(voucher.applicableCategories || []).join(", ")}`
            : `₹${Math.round(minOrderValue - eligibleTotal)} more`
        } to use this voucher`,
      });
    }

    // ── 10. Calculate discount ─────────────────────────────────────────────
    let discountAmount =
      voucher.discountType === "percentage"
        ? (eligibleTotal * voucher.discount) / 100
        : voucher.discount;

    if (voucher.maxDiscountAmount != null) {
      discountAmount = Math.min(discountAmount, voucher.maxDiscountAmount);
    }

    discountAmount = Math.min(discountAmount, eligibleTotal);
    discountAmount = Math.round(discountAmount);

    // ── 11. Save applied voucher to cart ───────────────────────────────────
    cart.appliedVoucher = {
      voucherId:      voucher._id,
      code:           voucher.code,
      discountType:   voucher.discountType,
      discount:       voucher.discount,
      discountAmount,
    };

    cart.recalculatePricing();
    await cart.save();

    return res.status(200).json({
      success: true,
      message: `Voucher applied! You're saving ₹${discountAmount}`,
      data: {
        code:           voucher.code,
        title:          voucher.title,
        discountType:   voucher.discountType,
        discount:       voucher.discount,
        discountAmount,
        eligibleTotal:  Math.round(eligibleTotal),
      },
    });

  } catch (error) {
    console.error("Error applying voucher:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to apply voucher",
    });
  }
});

router.delete("/cart/voucher/remove", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const cart = await Cart.findOne({ userId });

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    if (!cart.appliedVoucher) {
      return res.status(400).json({
        success: false,
        message: "No voucher applied to remove",
      });
    }

    cart.appliedVoucher = null;
    cart.recalculatePricing();
    await cart.save();

    return res.status(200).json({
      success: true,
      message: "Voucher removed successfully",
      data: {
        pricing: cart.pricing,
      },
    });

  } catch (error) {
    console.error("Error removing voucher:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to remove voucher",
    });
  }
});

module.exports = router;