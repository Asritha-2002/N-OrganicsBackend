const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const { auth, adminAuth } = require('../middleware/auth');
const User = require('../models/User');

//get admin info
router.get(
  "/admin/admin-details",
  auth,
  adminAuth,
  async (req, res) => {
    try {
      // Find the admin user and exclude the password field for security
      const admin = await User.findOne({ isAdmin: true }).select("-password");

      if (!admin) {
        return res.status(404).json({ 
          success: false, 
          message: "Admin user not found" 
        });
      }

      res.status(200).json({
        success: true,
        data: admin
      });
    } catch (error) {
      console.error("Error fetching admin details:", error);
      res.status(500).json({ 
        success: false, 
        message: "Server error", 
        error: error.message 
      });
    }
  }
);

router.patch("/admin/update-admin", auth, adminAuth, async (req, res) => {
  try {
    const { name, email, phone, gender, dob } = req.body;

    // Construct update object with only provided fields
    const updateFields = {};
    if (name !== undefined) updateFields.name = name;
    if (email !== undefined) updateFields.email = email;
    if (phone !== undefined) updateFields.phone = phone;
    if (gender !== undefined) updateFields.gender = gender;
    if (dob !== undefined) updateFields.dob = dob;

    // Update the admin user (only one with isAdmin: true)
    const updatedAdmin = await User.findOneAndUpdate(
      { isAdmin: true },
      { $set: updateFields },
      {
        returnDocument: "after", // replaces deprecated `new: true`
        runValidators: true,     // run Mongoose schema validations
      }
    ).select("-password");

    if (!updatedAdmin) {
      return res.status(404).json({
        success: false,
        message: "Admin user not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Updated successfully",
      data: updatedAdmin,
    });
  } catch (error) {
    console.error("Error updating details:", error);

    // Handle duplicate email (MongoDB duplicate key error)
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Email is already in use by another account",
      });
    }

    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});


// Get all users
router.get("/admin/users", auth, adminAuth, async (req, res) => {
  try {
    const users = await User.find({
      isVerified: true,
      isAdmin: false,
    })
      .select("-password -verificationToken -resetPasswordToken -resetPasswordExpires")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: users.length,
      users,
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Something went wrong",
    });
  }
});


router.get("/admin/products/list", auth, adminAuth, async (req, res) => {
  try {
    const products = await Product.find(
      {
        deletedAt: null,
        isActive: true   // ✅ important
      },
      { _id: 1, name: 1 }
    ).lean();

    return res.status(200).json({
      success: true,
      data: products,
    });
  } catch (error) {
    console.error("Error fetching products list:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch products",
    });
  }
});

module.exports = router;