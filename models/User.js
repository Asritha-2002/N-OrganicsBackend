const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { required } = require('joi');

const addressSchema = new mongoose.Schema({      
  mobilenum: { type: String, required: true },       
  addl1: { type: String, required: true },          
  addl2: { type: String, default: "" },             
  landmark: { type: String, default: "" },          
  pincode: { type: String, required: true },        
  city: { type: String, required: true },         
  state: { type: String, required: true },        
  type: { type: String, default: "Home" },          
  isDefault: { type: Boolean, default: false },   
});


const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: {type: String,required: true},
  gender: { 
    type: String, 
    enum: ['Male', 'Female', 'Other'], 
    default: null 
  },

  dateOfBirth: { 
    type: Date, 
    default: null 
  },
  isAdmin: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  addresses: [addressSchema],

  favorites: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Book'
  }],
  isVerified: { type: Boolean, default: false },
  verificationToken: String,
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  preferences: {
    newsletter: { type: Boolean, default: true },
    orderUpdates: { type: Boolean, default: true },
    marketing: { type: Boolean, default: true },
    language: { type: String, default: 'en' },
    currency: { type: String, default: 'INR' }
  }
}, { timestamps: true });

userSchema.pre('save', async function(next) {
    // Handle password hashing
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 10);
    }

    // Handle addresses without contact numbers
    if (this.addresses && this.addresses.length > 0) {
        let defaultPhone = this.preferences?.phone || '';
        this.addresses.forEach(addr => {
            if (!addr.contactNumber) {
                addr.contactNumber = defaultPhone;
            }
        });
    }
});

// Add method to set default address
userSchema.methods.setDefaultAddress = async function(addressId) {
    this.addresses.forEach(addr => addr.isDefault = false);
    const address = this.addresses.id(addressId);
    if (address) {
        address.isDefault = true;
        await this.save();
    }
};

module.exports = mongoose.model('User', userSchema);
