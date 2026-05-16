const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User=require('../models/User')
const {validate}=require('../middleware/validate')
const {userSchemas} =require('../validation/schemas')
const {sendVerificationEmail, sendPasswordResetEmail, sendContactEmail}=require('../config/email')
const { auth } = require('../middleware/auth');
const mongoose = require("mongoose");
// const User = require('../models/User');
// const { validate } = require('../middleware/validate');
// const { userSchemas } = require('../validation/schemas');
const { uploadImageToCloudinary } = require('../config/cloudinary');
const multer = require('multer');

const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // Limit size to 2MB
});

router.patch(
  "/profile/image",
  auth,
  upload.single("profileImage"), // 'profileImage' is the field name from frontend
  async (req, res) => {
    try {
      // 1. Check if file exists
      if (!req.file) {
        return res.status(400).json({ message: "Please upload an image" });
      }

      // 2. Upload buffer to Cloudinary
      // Uses the same helper function you use for banners
      const uploadResult = await uploadImageToCloudinary(req.file.buffer);

      // 3. Update the User document in MongoDB with the new URL
      const user = await User.findByIdAndUpdate(
        req.user.id,
        { profileImage: uploadResult.secure_url || uploadResult.url },
        { new: true }
      ).select("-password");

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      return res.status(200).json({
        success: true,
        message: "Profile image updated successfully",
        profileImage: user.profileImage,
        user
      });

    } catch (error) {
      console.error("Profile Image Upload Error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to upload profile image",
      });
    }
  }
);
//register
router.post(
  '/user/register',
  validate(userSchemas.register),
  async (req, res) => {
    try {
      const { email } = req.body;

      // 1. CHECK USER EXISTS
      const existingUser = await User.findOne({ email });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: 'User already exists. Please login instead.'
        });
      }

      // 2. CREATE USER
      const verificationToken = crypto.randomBytes(32).toString('hex');

      const user = new User({
        ...req.body,
        verificationToken,
        isVerified: false
      });

      await user.save();

      // 3. TRY EMAIL (DO NOT BLOCK FLOW)
      let emailStatus = "sent";

      try {
        await sendVerificationEmail(user.email, verificationToken);
      } catch (emailError) {
        console.error("Email sending failed:", emailError.message);
        emailStatus = "failed";
      }

      // 4. GENERATE TOKEN
      const token = jwt.sign(
        { id: user._id, isAdmin: user.isAdmin },
        process.env.JWT_SECRET
      );

      // 5. RESPONSE (SUCCESS ALWAYS)
      return res.status(201).json({
        success: true,
        user,
        token,
        message:
          emailStatus === "sent"
            ? "Registration successful. Verification email sent."
            : "Registration successful, but email sending failed. Please try resending verification email."
      });

    } catch (error) {
      console.error(error);
      return res.status(500).json({
        success: false,
        message: 'Something went wrong',
        error: error.message
      });
    }
  }
);

// Email verification
router.get('/user/verify/:token', async (req, res) => {
 // console.log( req.params.token);
  
  try {
    const user = await User.findOne({ verificationToken: req.params.token});
   // console.log(user);
    
    if (!user) {
     // console.log("not");
      return res.status(400).json({ message: 'Invalid verification token' });
      
      
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    await user.save();

    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
   // console.log("hello");
    
  }
});


// Login
router.post(
  "/user/login",
  validate(userSchemas.login),
  async (req, res) => {
    try {
      const { email, password } = req.body;

      const user = await User.findOne({ email });
      if (!user) {
        return res.status(400).json({ message: "User not found" });
      }


      if (!user.isVerified) {
        return res.status(400).json({ message: "Please verify your email first" });
      }

      if (!user.isActive) {
        return res.status(400).json({
          message: "Your account is inactive, Please Contact Support"
        });
      }

      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

      const token = jwt.sign(
        {
          id: user._id,
          isAdmin: user.isAdmin,
          email: user.email
        },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      const safeUser = {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        gender: user.gender,
        isAdmin: user.isAdmin,
        isVerified: user.isVerified,
        isActive: user.isActive
      };

      return res.json({
        message: user.isAdmin
          ? "Admin login successful"
          : "User login successful",
        token,
        user: safeUser
      });

    } catch (error) {
      return res.status(500).json({
        message: error.message || "Something went wrong"
      });
    }
  }
);

//forgot-password
router.post('/user/forgot-password', async (req, res) => {
//console.log(req.body);
  
  try {
    const {email} = req.body;
    //console.log(email);
    
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 600000; // 10 minutes
    await user.save();

    await sendPasswordResetEmail(user.email, resetToken);
    res.json({ message: 'Password reset email sent' });
  } catch (error) {
    //console.error('Forgot password error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Update reset password
router.post('/user/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ message: 'Token and password are required' });
    }

    // 1. Find the user by token without initially checking the date
    const user = await User.findOne({ resetPasswordToken: token });

    if (!user) {
      // If the user doesn't exist, the token has either been used or is invalid
      return res.status(400).json({ 
        message: 'This password reset link has already been used or is invalid. Please request a new one.' 
      });
    }

    // 2. Check if the token has expired
    if (user.resetPasswordExpires && user.resetPasswordExpires < Date.now()) {
      return res.status(400).json({ 
        message: 'Your password reset session has expired. Please request a new one.' 
      });
    }

    // 3. Update the password and clear the token
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


//get user info
router.get('/profile', auth, async (req, res) => {
  try {
    
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});


//update user info
router.patch('/profile', auth, async (req, res) => {
  try {


    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        message: "User not found"
      });
    }

    if (req.body?.name) user.name = req.body.name;
    if (req.body?.email) user.email = req.body.email;
    if (req.body?.gender) user.gender = req.body.gender;
    if (req.body?.dateOfBirth) user.dateOfBirth = req.body.dateOfBirth;
    if (req.body?.phone) user.phone = req.body.phone;

    await user.save();

    const userWithoutPassword = user.toObject();
    delete userWithoutPassword.password;

    res.json(userWithoutPassword);

  } catch (error) {
    console.log(error);

    res.status(400).json({
      message: error.message
    });
  }
});


//favourites
router.patch("/profile/favorites/toggle", auth, async (req, res) => {
  try {
    const { productId } = req.body;

    if (!productId) {
      return res.status(400).json({
        message: "productId is required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        message: "Invalid productId",
      });
    }

    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const exists = user.favorites.some(
      (id) => id.toString() === productId.toString()
    );

    if (exists) {
      user.favorites = user.favorites.filter(
        (id) => id.toString() !== productId.toString()
      );
    } else {
      user.favorites.push(productId);
    }

    await user.save();

    const userWithoutPassword = user.toObject();
    delete userWithoutPassword.password;

    return res.status(200).json({
      message: exists
        ? "Product removed from favorites"
        : "Product added to favorites",
      isFavorite: !exists,
      data: userWithoutPassword,
    });
  } catch (error) {
    console.log(error);
    return res.status(400).json({
      message: error.message,
    });
  }
});

//favourites state
router.get("/profile/favorites/check/:productId", auth, async (req, res) => {
  try {
    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        message: "Invalid productId",
      });
    }

    const user = await User.findById(req.user.id).select("favorites");

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const isFavorite = user.favorites.some(
      (favId) => favId.toString() === productId
    );

    return res.status(200).json({
      success: true,
      isFavorite,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      message: error.message,
    });
  }
});


router.post("/addresses", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const mobilenum = typeof req.body.mobilenum === "string" ? req.body.mobilenum.trim() : "";
    const addl1 = typeof req.body.addl1 === "string" ? req.body.addl1.trim() : "";
    const country = typeof req.body.country === "string" ? req.body.country.trim() : "India";
    const landmark = typeof req.body.landmark === "string" ? req.body.landmark.trim() : "";
    const pincode = typeof req.body.pincode === "string" ? req.body.pincode.trim() : "";
    const city = typeof req.body.city === "string" ? req.body.city.trim() : "";
    const state = typeof req.body.state === "string" ? req.body.state.trim() : "";
    const type = typeof req.body.type === "string" ? req.body.type.trim() : "Home";
    const isDefault = req.body.isDefault === true;

    const requiredFields = { name, mobilenum, addl1, country, pincode, city, state };

    for (const [field, value] of Object.entries(requiredFields)) {
      if (!value) {
        return res.status(400).json({ message: `${field} is required` });
      }
    }

    user.addresses.forEach((addr) => {
      if (!addr.name || addr.name.toString().trim() === "") {
        addr.name = user.name || "User";
      }
    });

    let shouldBeDefault = isDefault || user.addresses.length === 0;

    if (shouldBeDefault) {
      user.addresses.forEach((addr) => {
        addr.isDefault = false;
      });
    }

    const newAddress = {
      name,
      mobilenum,
      addl1,
      country: country || "India",
      landmark,
      pincode,
      city,
      state,
      type: type || "Home",
      isDefault: shouldBeDefault,
    };

    user.addresses.push(newAddress);

    await user.save();

    return res.status(201).json({
      message: "Address saved successfully",
      data: user.addresses,
    });
  } catch (error) {
    console.error("Create address error:", error);
    return res.status(500).json({
      message: "Server Error",
      error: error.message,
    });
  }
});

router.get("/addresses", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("addresses");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const addresses = [...(user.addresses || [])].sort((a, b) => {
      if (a.isDefault === b.isDefault) return 0;
      return a.isDefault ? -1 : 1;
    });

    return res.status(200).json({
      success: true,
      message: "Addresses fetched successfully",
      count: addresses.length,
      data: addresses,
    });
  } catch (error) {
    console.error("Error fetching addresses:", error);

    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
});


router.get("/addresses/default", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("addresses");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const addresses = user.addresses || [];

    if (addresses.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No addresses found",
        data: null,
      });
    }

    const defaultAddress =
      addresses.find((address) => address.isDefault === true) || addresses[0];

    return res.status(200).json({
      success: true,
      message: defaultAddress.isDefault
        ? "Default address fetched successfully"
        : "No default address found, first address returned",
      data: defaultAddress,
    });
  } catch (error) {
    console.error("Error fetching default address:", error);

    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
});

router.put("/addresses/:addressId", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const address = user.addresses.id(req.params.addressId);

    if (!address) {
      return res.status(404).json({ message: "Address not found" });
    }

    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const mobilenum =
      typeof req.body.mobilenum === "string" ? req.body.mobilenum.trim() : "";
    const addl1 =
      typeof req.body.addl1 === "string" ? req.body.addl1.trim() : "";
    const country =
      typeof req.body.country === "string" ? req.body.country.trim() : "India";
    const landmark =
      typeof req.body.landmark === "string" ? req.body.landmark.trim() : "";
    const pincode =
      typeof req.body.pincode === "string" ? req.body.pincode.trim() : "";
    const city = typeof req.body.city === "string" ? req.body.city.trim() : "";
    const state =
      typeof req.body.state === "string" ? req.body.state.trim() : "";
    const type =
      typeof req.body.type === "string" ? req.body.type.trim() : "Home";
    const isDefault = req.body.isDefault === true;

    const requiredFields = {
      name,
      mobilenum,
      addl1,
      country,
      pincode,
      city,
      state,
    };

    for (const [field, value] of Object.entries(requiredFields)) {
      if (!value) {
        return res.status(400).json({ message: `${field} is required` });
      }
    }

    if (!/^\d{10}$/.test(mobilenum)) {
      return res
        .status(400)
        .json({ message: "Mobile number must be exactly 10 digits" });
    }

    if (!/^\d{6}$/.test(pincode)) {
      return res
        .status(400)
        .json({ message: "Pincode must be exactly 6 digits" });
    }

    user.addresses.forEach((addr) => {
      if (!addr.name || addr.name.toString().trim() === "") {
        addr.name = user.name || "User";
      }
    });

    if (isDefault) {
      user.addresses.forEach((addr) => {
        addr.isDefault = false;
      });
    }

    address.name = name;
    address.mobilenum = mobilenum;
    address.addl1 = addl1;
    address.country = country || "India";
    address.landmark = landmark;
    address.pincode = pincode;
    address.city = city;
    address.state = state;
    address.type = type || "Home";
    address.isDefault = isDefault;

    await user.save();

    return res.status(200).json({
      message: "Address updated successfully",
      data: user.addresses,
    });
  } catch (error) {
    console.error("Update address error:", error);
    return res.status(500).json({
      message: "Server Error",
      error: error.message,
    });
  }
});

// DELETE address
router.delete("/addresses/:addressId", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // 1. Find the address to check if it exists and if it's the default
    const address = user.addresses.id(req.params.addressId);

    if (!address) {
      return res.status(404).json({ message: "Address not found" });
    }

    const wasDefault = address.isDefault;

    // 2. Use .pull() to remove the subdocument from the array
    // This is safer and avoids the ".remove is not a function" error
    user.addresses.pull(req.params.addressId);

    // 3. Handle Default Address Logic
    // If we deleted the default, set the next available one as default
    if (wasDefault && user.addresses.length > 0) {
      user.addresses[0].isDefault = true;
    }

    // 4. Save the user document
    await user.save();

    return res.status(200).json({
      message: "Address deleted successfully",
      data: user.addresses,
    });
  } catch (error) {
    console.error("Delete address error:", error);
    return res.status(500).json({
      message: "Server Error",
      error: error.message,
    });
  }
});

router.post("/contact",auth, async (req, res) => {
  try {
    const { name, email, description } = req.body;

    if (!name || !email || !description) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and description are required",
      });
    }

    await sendContactEmail({ name, email, description });

    return res.status(200).json({
      success: true,
      message: "Your message has been sent successfully",
    });
  } catch (error) {
    console.error("Contact form error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to send message",
      error: error.message,
    });
  }
});

module.exports = router;