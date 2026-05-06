const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User=require('../models/User')
const {validate}=require('../middleware/validate')
const {userSchemas} =require('../validation/schemas')
const {sendVerificationEmail, sendPasswordResetEmail}=require('../config/email')
// const User = require('../models/User');
// const { validate } = require('../middleware/validate');
// const { userSchemas } = require('../validation/schemas');

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



module.exports = router;