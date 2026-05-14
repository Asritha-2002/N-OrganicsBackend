// In your routes file (e.g. adminRoutes.js or voucherRoutes.js)
const express = require('express');
const Voucher = require('../models/Voucher');
const { auth, adminAuth } = require('../middleware/auth');
const router = express.Router();
const Product = require('../models/Product');

// @desc    Create new voucher

router.post(
  '/admin/vouchers',
  auth,
  adminAuth,
  async (req, res) => {
    try {
      const {
        code,
        title,
        description,
        discountType,
        discount,
        maxDiscountAmount,
        minOrderValue,
        eligibility,
        appliesTo,
        applicableCategories,
        applicableProductIds,  // NEW - Array of product IDs
        maxUses,
        perUserLimit,
        startDate,
        endDate,
        isActive,
      } = req.body;

      // 1. BASIC VALIDATION
      if (
        !code ||
        !title ||
        !discount ||
        !discountType ||
        !startDate ||
        !endDate
      ) {
        return res.status(400).json({
          success: false,
          message: 'Please provide all required fields',
        });
      }

      // 2. CHECK EXISTING VOUCHER
      const existingVoucher = await Voucher.findOne({
        code: code.toUpperCase().trim(),
        deletedAt: null,
      });

      if (existingVoucher) {
        return res.status(409).json({
          success: false,
          message: `Voucher code '${code}' already exists`,
        });
      }

      // 3. VALIDATE PERCENTAGE
      if (discountType === 'percentage' && Number(discount) > 100) {
        return res.status(400).json({
          success: false,
          message: 'Percentage discount cannot exceed 100',
        });
      }

      // 4. VALIDATE DATES
      const start = new Date(startDate);
      const end = new Date(endDate);

      if (end <= start) {
        return res.status(400).json({
          success: false,
          message: 'End date must be after start date',
        });
      }

      // 5. CATEGORY VALIDATION
      if (
        appliesTo === 'category' &&
        (!applicableCategories || applicableCategories.length === 0)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Please select at least one category',
        });
      }

      // NEW: 5B. PRODUCT VALIDATION
      if (
        appliesTo === 'product' &&
        (!applicableProductIds || applicableProductIds.length === 0)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Please select at least one product',
        });
      }

      // NEW: 5C. VALIDATE PRODUCT IDs EXIST
      if (appliesTo === 'product' && applicableProductIds?.length > 0) {
        const validProducts = await Product.countDocuments({
          _id: { $in: applicableProductIds },
          isActive: true,
          deletedAt: null,
        });

        if (validProducts !== applicableProductIds.length) {
          return res.status(400).json({
            success: false,
            message: 'One or more selected products are invalid or inactive',
          });
        }
      }

      // 6. PREPARE DATA
      const voucherData = {
        code: code.toUpperCase().trim(),
        title: title.trim(),
        description: description?.trim() || '',
        discountType,
        discount: Number(discount),
        minOrderValue: Number(minOrderValue) || 0,
        eligibility: eligibility || 'all',
        appliesTo: appliesTo || 'all',
        perUserLimit: Number(perUserLimit) || 1,
        startDate: start,
        endDate: end,
        isActive: isActive !== undefined ? isActive : true,
      };

      // 7. CONDITIONAL FIELDS
      if (maxDiscountAmount) {
        voucherData.maxDiscountAmount = Number(maxDiscountAmount);
      }

      if (maxUses && Number(maxUses) > 0) {
        voucherData.maxUses = Number(maxUses);
      }

      // Apply categories
      if (appliesTo === 'category') {
        voucherData.applicableCategories = applicableCategories;
      }

      // NEW: Apply product IDs
      if (appliesTo === 'product') {
        voucherData.applicableProductIds = applicableProductIds;
      }

      // 8. CREATE VOUCHER
      const voucher = await Voucher.create(voucherData);

      // 9. SUCCESS RESPONSE
      return res.status(201).json({
        success: true,
        message: 'Voucher created successfully',
        data: voucher,
      });

    } catch (error) {
      console.error('Voucher creation error:', error);

      return res.status(500).json({
        success: false,
        message: 'Something went wrong',
        error: error.message,
      });
    }
  }
);

// stats of vouchers
router.get(
  '/admin/vouchers/stats',
  auth,
  adminAuth,
  async (req, res) => {
    try {
      const now = new Date();

      const stats = await Voucher.aggregate([
        { $match: { deletedAt: null } },

        {
          $facet: {
            total: [{ $count: 'count' }],

            active: [
              {
                $match: {
                  isActive: true,
                  startDate: { $lte: now },
                  endDate: { $gte: now },
                },
              },
              { $count: 'count' },
            ],

            expired: [
              {
                $match: {
                  endDate: { $lt: now },
                },
              },
              { $count: 'count' },
            ],

            upcoming: [
              {
                $match: {
                  startDate: { $gt: now },
                  isActive: true,
                },
              },
              { $count: 'count' },
            ],

            inactive: [
              {
                $match: {
                  isActive: false,
                },
              },
              { $count: 'count' },
            ],

            totalUsage: [
              {
                $group: {
                  _id: null,
                  total: { $sum: '$usedCount' },
                },
              },
            ],

            totalDiscountGiven: [
              { $unwind: '$usageLog' },

              {
                $group: {
                  _id: null,
                  total: {
                    $sum: '$usageLog.discountAmount',
                  },
                },
              },
            ],

            mostUsed: [
              { $sort: { usedCount: -1 } },

              { $limit: 5 },

              {
                $project: {
                  code: 1,
                  title: 1,
                  usedCount: 1,
                  maxUses: 1,
                },
              },
            ],
          },
        },
      ]);

      return res.status(200).json({
        success: true,

        data: {
          total: stats[0].total[0]?.count || 0,

          active: stats[0].active[0]?.count || 0,

          expired: stats[0].expired[0]?.count || 0,

          upcoming: stats[0].upcoming[0]?.count || 0,

          inactive: stats[0].inactive[0]?.count || 0,

          totalUsage: stats[0].totalUsage[0]?.total || 0,

          totalDiscountGiven:
            stats[0].totalDiscountGiven[0]?.total || 0,

          mostUsed: stats[0].mostUsed || [],
        },
      });

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message: 'Something went wrong',
        error: error.message,
      });
    }
  }
);

//get all vouchers

router.get(
  "/vouchers",
  auth,
  adminAuth,
  async (req, res) => {
    try {
      const {
        status,
        search,
        eligibility,
        appliesTo,
        page = 1,
        limit = 10,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = req.query;

      // ── Build Query ───────────────────────────────────────
      let query = { deletedAt: null };

      // ── Current Date ──────────────────────────────────────
      const now = new Date();

      // ── Filter by Status ──────────────────────────────────
      if (status === "active") {
        query.isActive = true;
        query.startDate = { $lte: now };
        query.endDate = { $gte: now };
      } 
      else if (status === "inactive") {
        query.isActive = false;
      } 
      else if (status === "expired") {
        query.endDate = { $lt: now };
      } 
      else if (status === "upcoming") {
        query.isActive = true;
        query.startDate = { $gt: now };
      } 
      else if (status === "exhausted") {
        query.$expr = {
          $gte: ["$usedCount", "$maxUses"],
        };
      }

      // ── Search ────────────────────────────────────────────
      if (search) {
        query.$or = [
          {
            code: {
              $regex: search,
              $options: "i",
            },
          },
          {
            title: {
              $regex: search,
              $options: "i",
            },
          },
        ];
      }

      // ── Eligibility Filter ────────────────────────────────
      if (
        eligibility &&
        ["all", "new_users", "existing_users"].includes(eligibility)
      ) {
        query.eligibility = eligibility;
      }

      // ── Applies To Filter ─────────────────────────────────
      if (
        appliesTo &&
        ["all", "category", "product"].includes(appliesTo)
      ) {
        query.appliesTo = appliesTo;
      }

      // ── Pagination ────────────────────────────────────────
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const sortOptions = {};
      sortOptions[sortBy] = sortOrder === "asc" ? 1 : -1;

      // ── Fetch Vouchers WITH PRODUCT POPULATION ────────────
      const vouchers = await Voucher.find(query)
        .select("-usageLog")
        .populate({
          path: "applicableProductIds",
          select: "name images slug category", // Select product fields
          match: { deletedAt: null, isActive: true }, // Only active products
        })
        .sort(sortOptions)
        .limit(parseInt(limit))
        .skip(skip)
        .lean();

      // ── Count Total ───────────────────────────────────────
      const total = await Voucher.countDocuments(query);

      // ── Add Computed Fields + Product Names ───────────────
      const vouchersWithStatus = vouchers.map((v) => {
        let computedStatus = "inactive";

        if (!v.isActive) {
          computedStatus = "inactive";
        } 
        else if (v.startDate > now) {
          computedStatus = "upcoming";
        } 
        else if (v.endDate < now) {
          computedStatus = "expired";
        } 
        else {
          computedStatus = "active";
        }

        // Optional exhausted check
        if (v.maxUses !== null && v.usedCount >= v.maxUses) {
          computedStatus = "exhausted";
        }

        // NEW: Format product names
        const applicableProducts = v.applicableProductIds?.map(product => ({
          _id: product._id,
          name: product.name,
          slug: product.slug,
          category: product.category,
          image: product.images?.[0]?.url || null,
        })) || [];

        return {
          ...v,
          status: computedStatus,
          usagePercentage: v.maxUses
            ? Math.round((v.usedCount / v.maxUses) * 100)
            : null,
          
          // NEW: Return product details instead of just IDs
          applicableProducts,  // Array of product objects
          applicableProductIds: v.applicableProductIds?.map(p => p._id) || [], // Keep IDs for editing
        };
      });

      // ── Success Response ──────────────────────────────────
      return res.status(200).json({
        success: true,
        data: vouchersWithStatus,

        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      });

    } catch (error) {
      console.error("Voucher Fetch Error:", error);

      return res.status(500).json({
        success: false,
        message: "Something went wrong",
        error: error.message,
      });
    }
  }
);

//update voucher
router.put("/admin/vouchers/:id", auth, adminAuth, async (req, res) => {
  try {

    // ── Find Voucher ─────────────────────────────────────────────
    const voucher = await Voucher.findOne({
      _id: req.params.id,
      deletedAt: null,
    });

    if (!voucher) {
      return res.status(404).json({
        success: false,
        message: "Voucher not found",
      });
    }

    // ── Restrictions After Voucher Usage ────────────────────────
    if (voucher.usedCount > 0) {

      // Prevent changing voucher code
      if (
        req.body.code !== undefined &&
        req.body.code.toUpperCase() !== voucher.code
      ) {
        return res.status(400).json({
          success: false,
          message: "Cannot change voucher code after it has been used",
        });
      }

      // Prevent changing discount type
      if (
        req.body.discountType !== undefined &&
        req.body.discountType !== voucher.discountType
      ) {
        return res.status(400).json({
          success: false,
          message: "Cannot change discount type after voucher has been used",
        });
      }

      // Prevent changing discount amount
      if (
        req.body.discount !== undefined &&
        Number(req.body.discount) !== voucher.discount
      ) {
        return res.status(400).json({
          success: false,
          message: "Cannot change discount amount after voucher has been used",
        });
      }
    }

    // ── Validate Dates ──────────────────────────────────────────
    const startDate = req.body.startDate
      ? new Date(req.body.startDate)
      : voucher.startDate;

    const endDate = req.body.endDate
      ? new Date(req.body.endDate)
      : voucher.endDate;

    if (endDate <= startDate) {
      return res.status(400).json({
        success: false,
        message: "End date must be after start date",
      });
    }

    // ── Validate Category Requirement ───────────────────────────
    const appliesTo = req.body.appliesTo || voucher.appliesTo;

    const applicableCategories =
      req.body.applicableCategories || voucher.applicableCategories;

    if (
      appliesTo === "category" &&
      (!applicableCategories || applicableCategories.length === 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Please select at least one category when applying to categories",
      });
    }

    // NEW: ── Validate Product Requirement ───────────────────────
    const applicableProductIds =
      req.body.applicableProductIds || voucher.applicableProductIds;

    if (
      appliesTo === "product" &&
      (!applicableProductIds || applicableProductIds.length === 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Please select at least one product when applying to products",
      });
    }

    // NEW: ── Validate Product IDs Exist ─────────────────────────
    if (appliesTo === "product" && applicableProductIds?.length > 0) {
      const validProducts = await Product.countDocuments({
        _id: { $in: applicableProductIds },
        isActive: true,
        deletedAt: null,
      });

      if (validProducts !== applicableProductIds.length) {
        return res.status(400).json({
          success: false,
          message: "One or more selected products are invalid or inactive",
        });
      }
    }

    // ── Update Everything Sent From Frontend ────────────────────
    const updates = { ...req.body };

    // Always store code uppercase
    if (updates.code) {
      updates.code = updates.code.toUpperCase();
    }

    // Convert numeric fields safely
    if (updates.discount !== undefined) {
      updates.discount = Number(updates.discount);
    }

    if (updates.maxDiscountAmount !== undefined) {
      updates.maxDiscountAmount =
        updates.maxDiscountAmount === null || updates.maxDiscountAmount === ""
          ? null
          : Number(updates.maxDiscountAmount);
    }

    if (updates.minOrderValue !== undefined) {
      updates.minOrderValue = Number(updates.minOrderValue);
    }

    if (updates.maxUses !== undefined) {
      updates.maxUses =
        updates.maxUses === null || updates.maxUses === ""
          ? null
          : Number(updates.maxUses);
    }

    if (updates.perUserLimit !== undefined) {
      updates.perUserLimit = Number(updates.perUserLimit);
    }

    // Clear categories/products based on appliesTo
    if (updates.appliesTo === "all") {
      updates.applicableCategories = [];
      updates.applicableProductIds = [];  // NEW
    }

    // NEW: Clear product IDs if appliesTo is category
    if (updates.appliesTo === "category") {
      updates.applicableProductIds = [];
    }

    // NEW: Clear categories if appliesTo is product
    if (updates.appliesTo === "product") {
      updates.applicableCategories = [];
    }

    // ── Update Voucher ──────────────────────────────────────────
    const updatedVoucher = await Voucher.findByIdAndUpdate(
      req.params.id,
      updates,
      {
        new: true,
        runValidators: true,
      }
    ).select("-usageLog");

    // ── Success Response ────────────────────────────────────────
    res.status(200).json({
      success: true,
      message: "Voucher updated successfully",
      data: updatedVoucher,
    });

  } catch (error) {
    console.error("Voucher Update Error:", error);

    res.status(500).json({
      success: false,
      message: error.message || "Server Error",
    });
  }
});


//delete voucher
router.delete(

  "/admin/vouchers/:id",
  auth, adminAuth,
  async (req, res) => {
    const voucher = await Voucher.findOne({
      _id: req.params.id,
      deletedAt: null,
    });

    if (!voucher) {
      res.status(404);
      throw new Error("Voucher not found");
    }

    // Soft delete
    voucher.deletedAt = new Date();
    voucher.isActive = false;

    await voucher.save();

    res.status(200).json({
      success: true,
      message: "Voucher deleted successfully",
    });
  }
);



module.exports = router;