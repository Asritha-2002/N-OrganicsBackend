const express = require('express');
const multer = require('multer');
const Product = require('../models/Product');
const Banner =require('../models/Banner')
const { auth, adminAuth } = require('../middleware/auth');
const { cloudinary, uploadImageToCloudinary } = require('../config/cloudinary');
const mongoose=require('mongoose')
const router = express.Router();
const User = require("../models/User");
const Cart =require('../models/Cart')

// ─────────────────────────────────────────────────────────────
// Multer Memory Storage
// ─────────────────────────────────────────────────────────────
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});
// CREATE PRODUCT
router.post(
  "/admin/products",
  auth,
  adminAuth,
  upload.fields([
    { name: "images",        maxCount: 10 },
    { name: "videos",        maxCount: 5  },
    { name: "categoryImage", maxCount: 1  }, // ← NEW
    { name: "tagImage",      maxCount: 1  }, // ← NEW
     ...Array.from({ length: 10 }, (_, i) => ({ name: `variantImage_${i}`, maxCount: 10 })),
  ]),
  async (req, res) => {
    try {
      const data = { ...req.body };

      // ── Parse JSON Fields ──────────────────────────────────────────────────
      const jsonFields = [
        "tags", "highlights", "ingredients", "variants",
        "skincareDetails", "packaging", "relatedProducts", "seo",
      ];
      jsonFields.forEach((field) => {
        if (data[field] && typeof data[field] === "string") {
          try { data[field] = JSON.parse(data[field]); }
          catch (err) { console.log(`Failed to parse ${field}`); }
        }
      });

      // ── Boolean Fields ─────────────────────────────────────────────────────
      const booleanFields = [
        "isActive", "isFeatured", "isBestseller", "isNewArrival", "isLimited",
      ];
      booleanFields.forEach((field) => {
        if (data[field] !== undefined) {
          data[field] = data[field] === true || data[field] === "true";
        }
      });

      if (data.packaging?.isRecyclable !== undefined) {
        data.packaging.isRecyclable =
          data.packaging.isRecyclable === true || data.packaging.isRecyclable === "true";
      }

      // ── Parse Variant Nested Fields ────────────────────────────────────────
      if (Array.isArray(data.variants)) {
        data.variants = data.variants.map((variant) => ({
          ...variant,
          price:      typeof variant.price      === "string" ? JSON.parse(variant.price)      : variant.price,
          stock:      typeof variant.stock      === "string" ? JSON.parse(variant.stock)      : variant.stock,
          weight:     typeof variant.weight     === "string" ? JSON.parse(variant.weight)     : variant.weight,
          attributes: typeof variant.attributes === "string" ? JSON.parse(variant.attributes) : variant.attributes,
          isActive:     variant.isActive     === true || variant.isActive     === "true",
    isDefault:    variant.isDefault    === true || variant.isDefault    === "true",
    isFeatured:   variant.isFeatured   === true || variant.isFeatured   === "true",
    isBestseller: variant.isBestseller === true || variant.isBestseller === "true",
    isNewArrival: variant.isNewArrival === true || variant.isNewArrival === "true",
    isLimited:    variant.isLimited    === true || variant.isLimited    === "true",
        }));
      }

      // ── Upload Main Product Images ─────────────────────────────────────────
      data.images = [];
      if (req.files?.images?.length) {
        for (const file of req.files.images) {
          const uploadResult = await uploadImageToCloudinary(file.buffer, {
            folder: `products/${data.slug || "new-product"}/main`,
          });
          data.images.push({
            url:       uploadResult.url,
            public_id: uploadResult.public_id,
            altText:   data[`imageAlt_${file.originalname}`] || "",
            isPrimary: false,
          });
        }
        if (data.images.length > 0) data.images[0].isPrimary = true;
      }

      // ── Upload Category Image ──────────────────────────────────────────────
      if (req.files?.categoryImage?.length) {
  const file = req.files.categoryImage[0];
  const uploadResult = await uploadImageToCloudinary(file.buffer, {
    folder: `products/categories/${data.category || "uncategorized"}`,
  });
  data.categoryImage = {
    category: data.category || "",          // ← schema requires this
    image: {
      url:       uploadResult.url,
      public_id: uploadResult.public_id,
      altText:   data.categoryImageAlt || "",
    },
  };
}
delete data.categoryImageAlt;

      // ── Upload Tag Image ───────────────────────────────────────────────────
     if (req.files?.tagImage?.length && data.tag) {
  const file = req.files.tagImage[0];
  const uploadResult = await uploadImageToCloudinary(file.buffer, {
    folder: `products/tags/${data.tag}`,
  });
  data.tagImage = {
    tag: data.tag,                          // ← schema requires this (enum validated)
    image: {
      url:       uploadResult.url,
      public_id: uploadResult.public_id,
      altText:   data.tagImageAlt || "",
    },
  };
}
delete data.tagImageTag; // cleanup temp field
delete data.tagImageAlt;

      // ── Upload Variant Images ──────────────────────────────────────────────
      // REPLACE the "Upload Variant Images" block with:
if (Array.isArray(data.variants)) {
  for (let variantIndex = 0; variantIndex < data.variants.length; variantIndex++) {
    const variantFiles = req.files?.[`variantImage_${variantIndex}`] || [];

    if (variantFiles.length > 0) {
      data.variants[variantIndex].images = [];

      for (const file of variantFiles) {
        const uploadResult = await uploadImageToCloudinary(file.buffer, {
          folder: `products/${data.slug || "new-product"}/variants/${data.variants[variantIndex].sku || variantIndex}`,
        });

        data.variants[variantIndex].images.push({
          url:       uploadResult.url,
          public_id: uploadResult.public_id,
          altText:   data[`variantImageAlt_${variantIndex}_${file.originalname}`] || "",
          isPrimary: false,
        });
      }

      // First image = primary
      if (data.variants[variantIndex].images.length > 0) {
        data.variants[variantIndex].images[0].isPrimary = true;
      }
    }
  }
}

      // ── Upload Videos ──────────────────────────────────────────────────────
      data.videos = [];
      if (req.files?.videos?.length) {
        for (const file of req.files.videos) {
          const isVideo = (mimetype) => mimetype?.startsWith("video/");
          if (!isVideo(file.mimetype)) {
            return res.status(400).json({
              success: false,
              message: `Invalid video file: ${file.originalname}`,
            });
          }
          const uploadResult = await uploadImageToCloudinary(file.buffer, {
            resource_type: "video",
            folder: `products/${data.slug || "new-product"}/videos`,
          });
          data.videos.push({
            url:       uploadResult.url,
            public_id: uploadResult.public_id,
            title:     data[`videoTitle_${file.originalname}`] || "Product Video",
            isPrimary: false,
          });
        }
        if (data.videos.length > 0) data.videos[0].isPrimary = true;
      }

      // ── Cleanup All Temporary Alt/Title Fields ─────────────────────────────
      Object.keys(data).forEach((key) => {
        if (
          key.startsWith("imageAlt_") ||
          key.startsWith("variantImageAlt_") ||
          key.startsWith("videoTitle_")
        ) {
          delete data[key];
        }
      });

      // ── Handle empty packaging.type ────────────────────────────────────────
      if (data.packaging) {
        if (!data.packaging.type || data.packaging.type === "") {
          data.packaging.type = null;
        }
      }

      // ── Create Product ─────────────────────────────────────────────────────
      const product = new Product(data);
      await product.save();

      return res.status(201).json({
        success: true,
        message: "Product created successfully",
        product,
      });

    } catch (error) {
      console.error("Error creating product:", error);

     if (error.name === "ValidationError") {

  const fieldMessages = Object.values(error.errors).map((err) => ({
    field: err.path,
    message: err.message,
  }));

  return res.status(400).json({
    success: false,

    // combined readable message
    message: fieldMessages
      .map((err) => `${err.field}: ${err.message}`)
      .join(", "),

    details: fieldMessages,
  });
}

      if (error.code === 11000) {
        const field = Object.keys(error.keyValue)[0];
        return res.status(400).json({
          success: false,
          message: `This ${field} already exists and must be unique.`,
        });
      }

      return res.status(400).json({
        success: false,
        message: error.message || "Error creating product. Please check your data and try again.",
        details: [],
      });
    }
  }
);

// UPDATE PRODUCT
router.put(
  "/admin/products/:id",
  auth,
  adminAuth,
  upload.fields([
    { name: "images",        maxCount: 10 },
    { name: "videos",        maxCount: 5  },
    { name: "categoryImage", maxCount: 1  },
    { name: "tagImage",      maxCount: 1  },
    ...Array.from({ length: 10 }, (_, i) => ({ name: `variantImage_${i}`, maxCount: 10 })),
  ]),
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid product id" });
      }

      const product = await Product.findById(id);
      if (!product) {
        return res.status(404).json({ success: false, message: "Product not found" });
      }

      const data = { ...req.body };

      // ── Parse JSON fields ────────────────────────────────────────────────
      ["highlights", "ingredients", "variants", "skincareDetails", "packaging", "relatedProducts"]
        .forEach((field) => {
          if (data[field] && typeof data[field] === "string") {
            try { data[field] = JSON.parse(data[field]); }
            catch (err) { console.log(`Failed to parse ${field}`); }
          }
        });

      // ── Boolean fields ───────────────────────────────────────────────────
      ["isActive", "isFeatured", "isBestseller", "isNewArrival", "isLimited"]

        .forEach((field) => {
          
          if (data[field] !== undefined)
            data[field] = data[field] === true || data[field] === "true";
        });

      if (data.packaging?.isRecyclable !== undefined) {
        data.packaging.isRecyclable =
          data.packaging.isRecyclable === true || data.packaging.isRecyclable === "true";
      }

      // ── Parse variant nested fields ──────────────────────────────────────
      if (Array.isArray(data.variants)) {
        data.variants = data.variants.map((variant) => ({
          ...variant,
          price:      typeof variant.price      === "string" ? JSON.parse(variant.price)      : variant.price,
          stock:      typeof variant.stock      === "string" ? JSON.parse(variant.stock)      : variant.stock,
          weight:     typeof variant.weight     === "string" ? JSON.parse(variant.weight)     : variant.weight,
          attributes: typeof variant.attributes === "string" ? JSON.parse(variant.attributes) : variant.attributes,

        }));
      }

      // ── Parse existing image/video keep lists ────────────────────────────
      const existingImages = data.existingImages ? JSON.parse(data.existingImages) : [];
      const existingVideos = data.existingVideos ? JSON.parse(data.existingVideos) : [];
      delete data.existingImages;
      delete data.existingVideos;

      // ── Main product images ──────────────────────────────────────────────
      const keptImages = (product.images || []).filter((img) =>
        existingImages.includes(img.public_id)
      );
      const newImages = [];
      if (req.files?.images?.length) {
        for (const file of req.files.images) {
          const result = await uploadImageToCloudinary(file.buffer, {
            folder: `products/${data.slug || product.slug || "new-product"}/main`,
          });
          newImages.push({
            url:       result.url,
            public_id: result.public_id,
            altText:   data[`imageAlt_${file.originalname}`] || "",
            isPrimary: false,
          });
        }
      }
      data.images = [...keptImages, ...newImages];
      if (data.images.length > 0) data.images[0].isPrimary = true;

      // ── Videos ───────────────────────────────────────────────────────────
      const currentVideos = product.videos || [];

      // Delete removed videos from Cloudinary
      const removedVideos = currentVideos.filter((vid) => !existingVideos.includes(vid.public_id));
      for (const video of removedVideos) {
        if (video.public_id) {
          await cloudinary.uploader.destroy(video.public_id, { resource_type: "video" });
        }
      }

      const keptVideos = currentVideos.filter((vid) => existingVideos.includes(vid.public_id));
      const newVideos  = [];
      if (req.files?.videos?.length) {
        for (const file of req.files.videos) {
          if (!file.mimetype?.startsWith("video/")) {
            return res.status(400).json({ success: false, message: `Invalid video file: ${file.originalname}` });
          }
          const result = await uploadImageToCloudinary(file.buffer, {
            resource_type: "video",
            folder: `products/${data.slug || product.slug || "new-product"}/videos`,
          });
          newVideos.push({
            url:       result.url,
            public_id: result.public_id,
            title:     data[`videoTitle_${file.originalname}`] || "Product Video",
            isPrimary: false,
          });
        }
      }
      data.videos = [...keptVideos, ...newVideos];
      if (data.videos.length > 0) data.videos[0].isPrimary = true;

      // ── Category image ───────────────────────────────────────────────────
      if (req.files?.categoryImage?.length) {
        const file   = req.files.categoryImage[0];
        const result = await uploadImageToCloudinary(file.buffer, {
          folder: `products/categories/${(data.category || product.category || "uncategorized").toLowerCase().replace(/\s+/g, "-")}`,
        });
        data.categoryImage = {
          category: data.category || product.category || "",
          image: { url: result.url, public_id: result.public_id, altText: data.categoryImageAlt || "" },
        };
      } else {
        data.categoryImage = product.categoryImage;
      }

      // ── Tag image ────────────────────────────────────────────────────────
      if (req.files?.tagImage?.length && data.tag) {
        const file   = req.files.tagImage[0];
        const result = await uploadImageToCloudinary(file.buffer, {
          folder: `products/tags/${data.tag}`,
        });
        data.tagImage = {
          tag:   data.tag,
          image: { url: result.url, public_id: result.public_id, altText: data.tagImageAlt || "" },
        };
      } else {
        data.tagImage = product.tagImage;
      }

      // ── Variant images (one named field per variant index) ───────────────
      // This runs ONCE — reads kept existing + uploads new per variant
      if (Array.isArray(data.variants)) {
        for (let variantIndex = 0; variantIndex < data.variants.length; variantIndex++) {

          // Which existing variant images to keep (sent as JSON array of public_ids)
          const keepPids = data[`existingVariantImages_${variantIndex}`]
            ? JSON.parse(data[`existingVariantImages_${variantIndex}`])
            : [];

          // Find matching DB variant by position (same order as frontend sends)
          const dbVariant    = product.variants?.[variantIndex];
          const keptVarImgs  = (dbVariant?.images || []).filter((img) =>
            keepPids.includes(img.public_id)
          );

          // Upload new variant images
          const variantFiles = req.files?.[`variantImage_${variantIndex}`] || [];
          const newVarImgs   = [];
          for (const file of variantFiles) {
            const result = await uploadImageToCloudinary(file.buffer, {
              folder: `products/${data.slug || product.slug || "new-product"}/variants/${data.variants[variantIndex].sku || variantIndex}`,
            });
            newVarImgs.push({
              url:       result.url,
              public_id: result.public_id,
              altText:   data[`variantImageAlt_${variantIndex}_${file.originalname}`] || "",
              isPrimary: false,
            });
          }

          // Merge kept + new, first image = primary
          data.variants[variantIndex].images = [...keptVarImgs, ...newVarImgs].map(
            (img, idx) => ({ ...img, isPrimary: idx === 0 })
          );
        }
      }

      // ── Cleanup temp fields ──────────────────────────────────────────────
      delete data.categoryImageAlt;
      delete data.tagImageAlt;
      delete data.tagImageTag;
      Object.keys(data).forEach((key) => {
        if (
          key.startsWith("imageAlt_")              ||
          key.startsWith("variantImageAlt_")        ||
          key.startsWith("existingVariantImages_")  ||
          key.startsWith("videoTitle_")
        ) {
          delete data[key];
        }
      });

      // ── Fix empty packaging.type ─────────────────────────────────────────
      if (data.packaging && (!data.packaging.type || data.packaging.type === "")) {
        data.packaging.type = null;
      }

      // ── Save ─────────────────────────────────────────────────────────────
      const updatedProduct = await Product.findByIdAndUpdate(
        id,
        { $set: data },
        { new: true, runValidators: true }
      );

      return res.status(200).json({
        success: true,
        message: "Product updated successfully",
        product: updatedProduct,
      });

    } catch (error) {
      console.error("Error updating product:", error);

      if (error.name === "ValidationError") {
        const fieldMessages = Object.values(error.errors).map((err) => ({
          field:   err.path,
          message: err.message,
        }));
        return res.status(400).json({
          success: false,
          message: fieldMessages.map((e) => `${e.field}: ${e.message}`).join(", "),
          details: fieldMessages,
        });
      }

      if (error.code === 11000) {
        const field = Object.keys(error.keyValue)[0];
        return res.status(400).json({
          success: false,
          message: `This ${field} already exists and must be unique.`,
        });
      }

      return res.status(400).json({
        success: false,
        message: error.message || "Error updating product. Please check your data and try again.",
        details: [],
      });
    }
  }
);

router.get("/admin/products/categories", async (req, res) => {
  try {
    const categories = await Product.distinct("category");

    // Remove duplicates ignoring case + normalize format
    const uniqueCategoriesMap = new Map();

    categories.forEach((cat) => {
      if (typeof cat === "string") {
        const trimmed = cat.trim();

        if (trimmed) {
          // key for duplicate checking
          const lowerCaseKey = trimmed.toLowerCase();

          // convert to title case
          const formattedCategory = trimmed
            .toLowerCase()
            .replace(/\b\w/g, (char) => char.toUpperCase());

          // store only first occurrence
          if (!uniqueCategoriesMap.has(lowerCaseKey)) {
            uniqueCategoriesMap.set(lowerCaseKey, formattedCategory);
          }
        }
      }
    });

    // Sort alphabetically
    const cleanedCategories = Array.from(uniqueCategoriesMap.values()).sort(
      (a, b) => a.localeCompare(b)
    );

    return res.status(200).json({
      success: true,
      message: "Categories fetched successfully",
      data: cleanedCategories,
    });
  } catch (error) {
    console.error("Error fetching categories:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch categories",
      details: error.message,
    });
  }
});

router.get("/admin/products/stats", auth, adminAuth, async (req, res) => {
  try {
    const result = await Product.aggregate([
      // Only active & non-deleted products
      {
        $match: {
          isActive: true,
          deletedAt: null,
        },
      },

      // Normalize category to lowercase + trimmed
      {
        $addFields: {
          normalizedCategory: {
            $toLower: {
              $trim: {
                input: { $ifNull: ["$category", ""] },
              },
            },
          },
        },
      },

      // Unwind variants
      {
        $unwind: "$variants",
      },

      // Only active variants
      {
        $match: {
          "variants.isActive": true,
        },
      },

      // Calculate stock/value fields
      {
        $addFields: {
          stock: {
            $ifNull: ["$variants.stock.quantity", 0],
          },

          sellingPrice: {
            $ifNull: ["$variants.price.sellingPrice", 0],
          },

          value: {
            $multiply: [
              { $ifNull: ["$variants.stock.quantity", 0] },
              { $ifNull: ["$variants.price.sellingPrice", 0] },
            ],
          },

          isLowStock: {
            $lte: [
              { $ifNull: ["$variants.stock.quantity", 0] },
              10,
            ],
          },
        },
      },

      // Group stats
      {
        $group: {
          _id: null,

          totalStock: {
            $sum: "$stock",
          },

          totalValue: {
            $sum: "$value",
          },

          lowStockCount: {
            $sum: {
              $cond: ["$isLowStock", 1, 0],
            },
          },

          // Case-insensitive categories
          categories: {
            $addToSet: "$normalizedCategory",
          },
        },
      },
    ]);

    const stats =
      result.length > 0
        ? result[0]
        : {
            totalStock: 0,
            totalValue: 0,
            lowStockCount: 0,
            categories: [],
          };

    // Distinct active products count
    const distinctCount = await Product.countDocuments({
      isActive: true,
      deletedAt: null,
    });

    // Remove empty category values
    const uniqueCategories = stats.categories.filter(
      (cat) => cat && cat.trim() !== ""
    );

    return res.status(200).json({
      success: true,
      data: {
        totalProducts: distinctCount,
        totalStock: stats.totalStock,
        lowStockProducts: stats.lowStockCount,
        inventoryValue: stats.totalValue,

        // Correct case-insensitive category count
        categoriesCount: uniqueCategories.length,
      },
    });
  } catch (error) {
    console.error("Error fetching product stats:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch stats",
      details: error.message,
    });
  }
});


// routes/productRoutes.js
router.get("/products/list", async (req, res) => {
  try {
    const now = new Date();

    // Get active banners (unchanged)
    const activeBanners = await Banner.find({
      isActive: true,
      deletedAt: null,
      startDate: { $lte: now },
      endDate: { $gte: now },
    }).lean();

    const normalize = (value) =>
      String(value || "").trim().toLowerCase();

    // Main products query - only active products
    const products = await Product.find({
      deletedAt: null,
      isActive: true,
    })
      .select("name category tag slug images variants")
      .lean();

    // Flatten products + variants into single array
    let allProducts = [];

    products.forEach((product) => {
      const productId = product._id.toString(); // Product ID for all variants

      // Main product (if it has no variants or first variant)
      const firstActiveVariant = product.variants?.find(v => v.isActive) || product.variants?.[0];
      
      if (firstActiveVariant || product.variants?.length === 0) {
        const sellingPrice = firstActiveVariant?.price?.sellingPrice || 0;
        const mrp = firstActiveVariant?.price?.mrp || 0;
        const quantity = firstActiveVariant?.stock?.quantity || 0;

        const normalizedProductCategory = normalize(product.category);

        const matchedBanners = activeBanners
          .filter((banner) => {
            if (banner.maxUses && banner.usedCount >= banner.maxUses) {
              return false;
            }

            if (banner.appliesTo === "all") return true;

            if (banner.appliesTo === "products") {
              return (banner.productIds || [])
                .map(String)
                .includes(productId);
            }

            if (banner.appliesTo === "category") {
              return (banner.categoryIds || [])
                .map(normalize)
                .includes(normalizedProductCategory);
            }

            return false;
          })
          .map((banner) => {
            const effectiveDiscount =
              banner.discountType === "percentage"
                ? (sellingPrice * banner.discount) / 100
                : banner.discount;

            return {
              bannerId: banner._id,
              title: banner.title,
              description: banner.description || "",
              discount: banner.discount,
              discountType: banner.discountType,
              effectiveDiscount,
              endDate: banner.endDate,
              image: banner.image || null,
            };
          })
          .sort((a, b) => b.effectiveDiscount - a.effectiveDiscount);

        const bestOffer = matchedBanners[0] || null;

        // Add MAIN product
        allProducts.push({
          _id: product._id, // Product ID
          productId: productId, // NEW - Always product ID
          isVariant: false,
          variantIndex: null,
          sku: product.sku || `${product.name.split(' ')[0]}-DEFAULT`,
          name: product.name,
          category: product.category,
          tag: product.tag,
          slug: product.slug,
          image: product.images?.[0]?.url || "",
          mrp,
          sellingPrice,
          quantity,
          isFeatured: firstActiveVariant?.isFeatured || false,
          isBestseller: firstActiveVariant?.isBestseller || false,
          isNewest: firstActiveVariant?.isNewest || false,
          isLimited: firstActiveVariant?.isLimited || false,
          bestOffer,
          sortWeight: 0,
        });
      }

      // Add individual ACTIVE variants - SAME PRODUCT ID
      if (product.variants) {
        product.variants.forEach((variant, variantIndex) => {
          // Only active variants
          if (!variant.isActive) return;

          const sellingPrice = variant.price?.sellingPrice || 0;
          const mrp = variant.price?.mrp || 0;
          const quantity = variant.stock?.quantity || 0;

          const normalizedProductCategory = normalize(product.category);

          const matchedBanners = activeBanners
            .filter((banner) => {
              if (banner.maxUses && banner.usedCount >= banner.maxUses) {
                return false;
              }

              if (banner.appliesTo === "all") return true;

              if (banner.appliesTo === "products") {
                return (banner.productIds || [])
                  .map(String)
                  .includes(productId);
              }

              if (banner.appliesTo === "category") {
                return (banner.categoryIds || [])
                  .map(normalize)
                  .includes(normalizedProductCategory);
              }

              return false;
            })
            .map((banner) => {
              const effectiveDiscount =
                banner.discountType === "percentage"
                  ? (sellingPrice * banner.discount) / 100
                  : banner.discount;

              return {
                bannerId: banner._id,
                title: banner.title,
                description: banner.description || "",
                discount: banner.discount,
                discountType: banner.discountType,
                effectiveDiscount,
                endDate: banner.endDate,
                image: banner.image || null,
              };
            })
            .sort((a, b) => b.effectiveDiscount - a.effectiveDiscount);

          const bestOffer = matchedBanners[0] || null;

          // Variant image priority: variant.images[0] > product.images[0]
          const variantImage = variant.images?.[0]?.url;
          const image = variantImage || product.images?.[0]?.url || "";

          allProducts.push({
            _id: product._id, // NEW - SAME PRODUCT ID for variants too
            productId: productId, // NEW - Always product ID
            isVariant: true,
            variantIndex, // Differentiator
            sku: variant.sku || `${product.name.split(' ')[0]}-${variant.attributes?.shade || variant.attributes?.size || 'DEFAULT'}`,
            name: `${product.name} ${variant.attributes?.shade ? `(${variant.attributes.shade})` : ''} ${variant.attributes?.size ? `(${variant.attributes.size})` : ''}`.trim(),
            category: product.category,
            tag: product.tag,
            slug: `${product.slug}?variant=${variantIndex}`,
            image,
            mrp,
            sellingPrice,
            quantity,
            isFeatured: variant.isFeatured || false,
            isBestseller: variant.isBestseller || false,
            isNewest: variant.isNewest || false,
            isLimited: variant.isLimited || false,
            bestOffer,
            sortWeight: Math.random(),
          });
        });
      }
    });

    // Sort: Featured > Bestseller > Newest > Limited > Random
    allProducts.sort((a, b) => {
      // Featured products/variants first
      if (a.isFeatured !== b.isFeatured) {
        return b.isFeatured ? 1 : -1;
      }
      
      // Bestsellers next
      if (a.isBestseller !== b.isBestseller) {
        return b.isBestseller ? 1 : -1;
      }
      
      // Newest next
      if (a.isNewest !== b.isNewest) {
        return b.isNewest ? 1 : -1;
      }
      
      // Limited next
      if (a.isLimited !== b.isLimited) {
        return b.isLimited ? 1 : -1;
      }
      
      // Rest: RANDOM ORDER
      return b.sortWeight - a.sortWeight;
    });

    return res.status(200).json({
      success: true,
      message: "Products fetched successfully",
      data: allProducts,
    });
  } catch (error) {
    console.error("Error fetching product list:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch products",
    });
  }
});

router.get("/categories/list", async (req, res) => {
  try {
    const categories = await Product.aggregate([
      {
        // 1. Filter valid products
        $match: {
          deletedAt: null,
          isActive: true,
          category: { $ne: null, $exists: true, $ne: "" }
        }
      },
      {
        // 2. Add lowercase category for grouping
        $addFields: {
          categoryLower: { $toLower: "$category" }
        }
      },
      {
        // 3. Sort by newest first
        $sort: { createdAt: -1 }
      },
      {
        // 4. Group by LOWERCASE category name
        $group: {
          _id: "$categoryLower",
          originalName: { $first: "$category" },
          categoryImage: { $first: "$categoryImage" },
          fallbackImage: { $first: { $arrayElemAt: ["$images", 0] } },
          lastUpdated: { $first: "$createdAt" }
        }
      },
      {
        // 5. Clean up the output
        $project: {
          _id: 0,
          name: "$originalName",
          image: { $ifNull: ["$categoryImage.image.url", "$fallbackImage.url"] },
          altText: { $ifNull: ["$categoryImage.image.altText", ""] }
        }
      },
      {
        // 6. Sort alphabetically by category name
        $sort: { name: 1 }
      }
    ]);

    return res.status(200).json({
      success: true,
      message: "Categories fetched successfully",
      data: categories,
    });
  } catch (error) {
    console.error("Error fetching category list:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch categories",
    });
  }
});

router.get("/admin/products", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 12,
      search = "",
      category = "all",
      stock = "all",
      sortBy = "newest",
    } = req.query;

    const pageNum  = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, parseInt(limit));
    const skip     = (pageNum - 1) * limitNum;

    // ── Base query ────────────────────────────────────────────────────────────
    const baseQuery = { deletedAt: null };   // ← removed isActive:true so drafts show too

    if (search?.trim()) {
      const searchRegex = new RegExp(search.trim(), "i");
      baseQuery.$or = [
        { name:             searchRegex },
        { shortDescription: searchRegex },
        { tag:              searchRegex },
        { category:         searchRegex },
        { brand:            searchRegex },
      ];
    }

    if (category !== "all") {
  baseQuery.category = {
    $regex: new RegExp(`^${category.trim()}$`, "i"),
  };
}

    // ── Sort ──────────────────────────────────────────────────────────────────
    const sortOptions = {
      newest:      { createdAt: -1 },
      oldest:      { createdAt:  1 },
      "price-low": { "variants.price.sellingPrice":  1 },
      "price-high":{ "variants.price.sellingPrice": -1 },
      title:       { name: 1 },
    };
    const sort = sortOptions[sortBy] || sortOptions.newest;

    // ── Without stock filter — simple find, no .select() restriction ──────────
    if (stock === "all") {
      const [products, totalProducts] = await Promise.all([
        Product.find(baseQuery)
          .sort(sort)
          .skip(skip)
          .limit(limitNum)
          .lean(),                         // ← plain JS objects, all fields included
        Product.countDocuments(baseQuery),
      ]);

      return res.status(200).json({
        success: true,
        data: {
          products,
          pagination: {
            page:       pageNum,
            limit:      limitNum,
            total:      totalProducts,
            totalPages: Math.ceil(totalProducts / limitNum),
          },
        },
      });
    }

    // ── With stock filter — aggregation, but $$ROOT preserves all fields ──────
    const stockMatch =
      stock === "low"    ? { $match: { "variants.stock.quantity": { $lt: 5 } } }
    : stock === "medium" ? { $match: { "variants.stock.quantity": { $gte: 5, $lte: 20 } } }
    : stock === "high"   ? { $match: { "variants.stock.quantity": { $gt: 20 } } }
    : null;

    const pipeline = [
      { $match: baseQuery },

      // Unwind variants so we can filter by stock per variant
      { $unwind: "$variants" },

      // Apply stock filter on the unwound variant
      ...(stockMatch ? [stockMatch] : []),

      // Group back — use $$ROOT trick to keep the full document
      {
        $group: {
          _id:      "$_id",
          root:     { $first: "$$ROOT" },   // ← entire document preserved
          variants: { $push: "$variants" },  // ← only the matching variants
        },
      },

      // Merge variants back into root doc
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: ["$root", { variants: "$variants" }],
          },
        },
      },

      { $sort:  sort  },
      { $skip:  skip  },
      { $limit: limitNum },
    ];

    const [products, totalProducts] = await Promise.all([
      Product.aggregate(pipeline),
      Product.countDocuments(baseQuery),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        products,
        pagination: {
          page:       pageNum,
          limit:      limitNum,
          total:      totalProducts,
          totalPages: Math.ceil(totalProducts / limitNum),
        },
      },
    });

  } catch (error) {
    console.error("Error fetching products:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch products",
    });
  }
});

router.get("/admin/products/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product id",
      });
    }

    const product = await Product.findOne({
      _id: id,
      deletedAt: null,
    }).lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error("Error fetching product by id:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch product",
    });
  }
});


router.get("/products/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findOne({
      _id: id,
      deletedAt: null,
    }).lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // ─── CHECK CART FOR PRESENCE ─────────────────────────────────────────────
    // ─── CHECK CART FOR PRESENCE ─────────────────────────────────────────────
    let cartItemMap = new Set(); 
    
    if (req.user) {
      const cart = await Cart.findOne({ userId: req.user._id }).lean();
      if (cart && cart.items) {
        cart.items.forEach(item => {
          // Use String() to ensure we have a clean string comparison
          // Also ensure productId exists before calling toString
          if (item.productId) {
            cartItemMap.add(`${String(item.productId)}-${item.variantIndex}`);
          }
        });
      }
    }

    // Add isPresent flag to each variant of the main product
    const variantsWithPresence = (product.variants || []).map((variant, index) => {
      const key = `${String(product._id)}-${index}`;
      return {
        ...variant,
        isPresent: cartItemMap.has(key)
      };
    });

    const now = new Date();
    const normalize = (value) => String(value || "").trim().toLowerCase();
    const normalizedProductCategory = normalize(product.category);

    // ─── FETCH BANNERS ────────────────────────────────────────────────────────
    const activeBanners = await Banner.find({
      isActive: true,
      deletedAt: null,
      startDate: { $lte: now },
      endDate: { $gte: now },
    }).lean();

    const matchedBanners = activeBanners.filter((banner) => {
      if (banner.appliesTo === "all") return true;

      if (banner.appliesTo === "product" || banner.appliesTo === "products") {
        return (banner.productIds || [])
          .map(String)
          .includes(product._id.toString());
      }

      if (banner.appliesTo === "category") {
        return (banner.categoryIds || [])
          .map(normalize)
          .includes(normalizedProductCategory);
      }

      return false;
    });

    let exhaustedOfferIds = new Set();

    if (req.user) {
      const usages = await UserOfferUsage.find({
        userId: req.user._id,
        offerId: { $in: matchedBanners.map((b) => b._id) },
      }).lean();

      const usageCountMap = {};

      usages.forEach((u) => {
        const key = u.offerId.toString();
        usageCountMap[key] = (usageCountMap[key] || 0) + 1;
      });

      matchedBanners.forEach((b) => {
        if (
          b.perUserLimit &&
          (usageCountMap[b._id.toString()] || 0) >= b.perUserLimit
        ) {
          exhaustedOfferIds.add(b._id.toString());
        }
      });
    }

    const lowestPrice = product.variants?.length
      ? Math.min(...product.variants.map((v) => v.price?.sellingPrice || Infinity))
      : 0;

    const offers = matchedBanners
      .map((banner) => {
        const isExhausted = exhaustedOfferIds.has(banner._id.toString());
        const isGloballyExhausted =
          banner.maxUses && banner.usedCount >= banner.maxUses;

        const effectiveDiscount =
          banner.discountType === "percentage"
            ? (lowestPrice * banner.discount) / 100
            : banner.discount;

        return {
          bannerId: banner._id,
          title: banner.title,
          description: banner.description || "",
          discount: banner.discount,
          discountType: banner.discountType,
          effectiveDiscount,
          endDate: banner.endDate,
          image: banner.image || null,
          isAvailable: !isExhausted && !isGloballyExhausted,
          unavailableReason: isGloballyExhausted
            ? "Offer limit reached"
            : isExhausted
            ? "Already used"
            : null,
        };
      })
      .sort((a, b) => {
        if (a.isAvailable !== b.isAvailable) return b.isAvailable - a.isAvailable;
        return b.effectiveDiscount - a.effectiveDiscount;
      });

    // ─── FETCH RELATED PRODUCTS RAW DATA ─────────────────────────────────────
    const relatedProductsRaw = await Product.find({
      _id: { $ne: id },
      deletedAt: null,
      isActive: true,
      $or: [
        { category: { $regex: `^${product.category}$`, $options: "i" } },
        { tag: { $regex: `^${product.tag}$`, $options: "i" } }
      ]
    })
      .limit(8)
      .lean();

    // ─── FORMAT RELATED PRODUCTS ──────────────────────────────────────────────
    const relatedProducts = relatedProductsRaw.map((relProduct) => {
      const firstVariant = relProduct.variants?.[0] || null;
      const sellingPrice = firstVariant?.price?.sellingPrice || 0;
      const mrp = firstVariant?.price?.mrp || 0;
      const stockQuantity = firstVariant?.stock?.quantity || 0;

      const normalizedRelCategory = normalize(relProduct.category);

      const relMatchedBanners = activeBanners
        .filter((banner) => {
          if (banner.maxUses && banner.usedCount >= banner.maxUses) {
            return false;
          }
          if (banner.appliesTo === "all") return true;
          if (banner.appliesTo === "products") {
            return (banner.productIds || []).map(String).includes(relProduct._id.toString());
          }
          if (banner.appliesTo === "category") {
            return (banner.categoryIds || [])
              .map(normalize)
              .includes(normalizedRelCategory);
          }
          return false;
        })
        .map((banner) => {
          const effectiveDiscount =
            banner.discountType === "percentage"
              ? (sellingPrice * banner.discount) / 100
              : banner.discount;

          return {
            bannerId: banner._id,
            title: banner.title,
            description: banner.description || "",
            discount: banner.discount,
            discountType: banner.discountType,
            effectiveDiscount,
            endDate: banner.endDate,
            image: banner.image || null,
          };
        })
        .sort((a, b) => b.effectiveDiscount - a.effectiveDiscount);

      const bestOffer = relMatchedBanners[0] || null;

      return {
        _id: relProduct._id,
        name: relProduct.name,
        category: relProduct.category,
        tag: relProduct.tag,
        slug: relProduct.slug,
        image: relProduct.images?.[0]?.url || "",
        mrp,
        sellingPrice,
        stockQuantity,
        bestOffer,
        // Check presence for the first variant of related products
        isPresent: cartItemMap.has(`${relProduct._id.toString()}-0`)
      };
    });

    // ─── RETURN RESPONSE ─────────────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      data: {
        ...product,
        variants: variantsWithPresence, // Updated with isPresent per variant
        offers,
        bestOffer: offers.find((o) => o.isAvailable) || null,
        relatedProducts, 
      },
    });
  } catch (error) {
    console.error("Error fetching product details:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch product details",
    });
  }
});

router.get("/products/auth/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product id",
      });
    }

    // ── 1. Fetch Product ───────────────────────────────────────────────────
    const product = await Product.findOne({
      _id: id,
      deletedAt: null,
    }).lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // ── 2. Build cart lookup set: "productId-variantIndex" ─────────────────
    // Key format matches exactly how addItem stores and checks items
    const cartKeySet = new Set();

const cart = await Cart.findOne({ userId: req.user.id }).lean();
// console.log("cart items length:", cart?.items?.length);

if (cart?.items?.length) {
  cart.items.forEach((item, i) => {
    const key = `${String(item.productId)}-${Number(item.variantIndex)}`;
    cartKeySet.add(key);
    //console.log("added to set:", key); // ← does this log fire?
  });
}

//console.log("cartKeySet after loop:", [...cartKeySet]); // ← check here

    // ── 3. Add isPresent to each variant using its array index ─────────────
    const variantsWithPresence = (product.variants || []).map((variant, index) => ({
      ...variant,
      isPresent: cartKeySet.has(`${String(product._id)}-${index}`),
    }));

    // ── 4. Fetch active banners that apply to this product ─────────────────
    const now = new Date();
    const normalize = (val) => String(val || "").trim().toLowerCase();
    const normalizedCategory = normalize(product.category);

    const activeBanners = await Banner.find({
      isActive:  true,
      deletedAt: null,
      startDate: { $lte: now },
      endDate:   { $gte: now },
    }).lean();

    const matchedBanners = activeBanners.filter((banner) => {
      if (banner.appliesTo === "all") return true;

      if (banner.appliesTo === "product" || banner.appliesTo === "products") {
        return (banner.productIds || [])
          .map(String)
          .includes(String(product._id));
      }

      if (banner.appliesTo === "category") {
        return (banner.categoryIds || [])
          .map(normalize)
          .includes(normalizedCategory);
      }

      return false;
    });

    const lowestPrice = product.variants?.length
      ? Math.min(...product.variants.map((v) => v.price?.sellingPrice || Infinity))
      : 0;

    // ── 5. Format offers ───────────────────────────────────────────────────
    const offers = matchedBanners
      .map((banner) => {
        const isGloballyExhausted =
          banner.maxUses != null && banner.usedCount >= banner.maxUses;

        const effectiveDiscount =
          banner.discountType === "percentage"
            ? (lowestPrice * banner.discount) / 100
            : banner.discount;

        return {
          bannerId:         banner._id,
          title:            banner.title,
          description:      banner.description || "",
          discount:         banner.discount,
          discountType:     banner.discountType,
          effectiveDiscount,
          endDate:          banner.endDate,
          image:            banner.image || null,
          isAvailable:      !isGloballyExhausted,
          unavailableReason: isGloballyExhausted ? "Offer limit reached" : null,
        };
      })
      .sort((a, b) => {
        // Available first, then by highest effective discount
        if (a.isAvailable !== b.isAvailable) return b.isAvailable - a.isAvailable;
        return b.effectiveDiscount - a.effectiveDiscount;
      });

    // ── 6. Fetch related products ──────────────────────────────────────────
    const relatedProductsRaw = await Product.find({
      _id:       { $ne: id },
      deletedAt: null,
      isActive:  true,
      $or: [
        { category: { $regex: `^${product.category}$`, $options: "i" } },
        { tag:      { $regex: `^${product.tag}$`,      $options: "i" } },
      ],
    })
      .limit(8)
      .lean();

    const relatedProducts = relatedProductsRaw.map((relProduct) => {
      const firstVariant = relProduct.variants?.[0] || null;

      return {
        _id:          relProduct._id,
        name:         relProduct.name,
        category:     relProduct.category,
        slug:         relProduct.slug,
        image:        relProduct.images?.[0]?.url || "",
        mrp:          firstVariant?.price?.mrp          || 0,
        sellingPrice: firstVariant?.price?.sellingPrice || 0,
        stockQuantity: firstVariant?.stock?.quantity    || 0,
        // Related product first variant is always at index 0
        isPresent: cartKeySet.has(`${String(relProduct._id)}-0`),
      };
    });

    // ── 7. Return ──────────────────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      data: {
        ...product,
        variants:        variantsWithPresence,
        offers,
        bestOffer:       offers.find((o) => o.isAvailable) || null,
        relatedProducts,
      },
    });

  } catch (error) {
    console.error("Error fetching product details:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
});


router.delete("/admin/products/:id", auth, adminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }

    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Delete product images
    if (Array.isArray(product.images) && product.images.length > 0) {
      for (const image of product.images) {
        if (image.public_id) {
          await cloudinary.uploader.destroy(image.public_id);
        }
      }
    }

    // Delete variant images
    if (Array.isArray(product.variants) && product.variants.length > 0) {
      for (const variant of product.variants) {
        if (Array.isArray(variant.images) && variant.images.length > 0) {
          for (const image of variant.images) {
            if (image.public_id) {
              await cloudinary.uploader.destroy(image.public_id);
            }
          }
        }
      }
    }

    // Delete videos
    if (Array.isArray(product.videos) && product.videos.length > 0) {
      for (const video of product.videos) {
        if (video.public_id) {
          await cloudinary.uploader.destroy(video.public_id, {
            resource_type: "video",
          });
        }
      }
    }

    await Product.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: "Product deleted permanently",
    });
  } catch (error) {
    console.error("Error deleting product:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete product",
      error: error.message,
    });
  }
});

router.get("/profile/favorites/products", auth, async (req, res) => {
  try {
    const now = new Date();

    const user = await User.findById(req.user._id || req.user.id).select("favorites").lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const favoriteIds = (user.favorites || [])
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    if (favoriteIds.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No favorite products found",
        data: [],
      });
    }

    const products = await Product.find(
      {
        _id: { $in: favoriteIds },
        deletedAt: null,
        isActive: true,
      },
      {
        name: 1,
        category: 1,
        tag: 1,
        slug: 1,
        images: { $slice: 1 },
        variants: { $slice: 1 },
      }
    ).lean();

    const activeBanners = await Banner.find({
      isActive: true,
      deletedAt: null,
      startDate: { $lte: now },
      endDate: { $gte: now },
    }).lean();

    const normalize = (value) => String(value || "").trim().toLowerCase();

    const formattedProducts = products.map((product) => {
      const firstVariant = product.variants?.[0] || null;
      const sellingPrice = firstVariant?.price?.sellingPrice || 0;
      const mrp = firstVariant?.price?.mrp || 0;

      const normalizedProductCategory = normalize(product.category);

      const matchedBanners = activeBanners
        .filter((banner) => {
          if (banner.maxUses && banner.usedCount >= banner.maxUses) {
            return false;
          }

          if (banner.appliesTo === "all") return true;

          if (banner.appliesTo === "products") {
            return (banner.productIds || [])
              .map(String)
              .includes(product._id.toString());
          }

          if (banner.appliesTo === "category") {
            return (banner.categoryIds || [])
              .map(normalize)
              .includes(normalizedProductCategory);
          }

          return false;
        })
        .map((banner) => {
          const effectiveDiscount =
            banner.discountType === "percentage"
              ? (sellingPrice * banner.discount) / 100
              : banner.discount;

          return {
            bannerId: banner._id,
            title: banner.title,
            description: banner.description || "",
            discount: banner.discount,
            discountType: banner.discountType,
            effectiveDiscount,
            endDate: banner.endDate,
            image: banner.image || null,
          };
        })
        .sort((a, b) => b.effectiveDiscount - a.effectiveDiscount);

      const bestOffer = matchedBanners[0] || null;

      return {
        _id: product._id,
        name: product.name,
        category: product.category,
        tag: product.tag,
        slug: product.slug,
        image: product.images?.[0]?.url || "",
        mrp,
        sellingPrice,
        bestOffer,
        isFavorite: true,
      };
    });

    const orderedProducts = favoriteIds
      .map((favId) =>
        formattedProducts.find(
          (product) => product._id.toString() === favId.toString()
        )
      )
      .filter(Boolean);

    return res.status(200).json({
      success: true,
      message: "Favorite products fetched successfully",
      data: orderedProducts,
    });
  } catch (error) {
    console.error("Error fetching favorite products:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch favorite products",
    });
  }
});






module.exports = router;