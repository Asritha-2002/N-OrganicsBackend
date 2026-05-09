const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const userRoutes= require('./routes/userRoutes')
const emailRoutes=require('./routes/emailRoutes.js')
const adminRoutes=require('./routes/adminRoutes.js')
const bannerRoutes=require('./routes/bannerRoutes.js')
const announcementRoutes=require('./routes/announcementRoutes.js')
const productRoutes=require('./routes/productRoutes.js')
const tagRoutes=require('./routes/tagRoutes.js')
// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const PORT = process.env.PORT || 8000;


// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());


//api calls
app.use('/api/email',emailRoutes)
app.use('/api', userRoutes);
app.use('/api',adminRoutes);
app.use('/api',bannerRoutes);
app.use('/api',announcementRoutes)
app.use('/api', productRoutes)
app.use('/api',tagRoutes)




app.use((err, req, res, next) => {
       res.status(500).json({ 
        message: err.message,
        status: 'error'
    });
});
const connectDB = async (retries = 3) => {
   //console.log("ENV CHECK:", process.env.MONGODB_URI);
    const dbURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bookstore';

    try {
        await mongoose.connect(dbURI);
        console.log('MongoDB Connected Successfully');
    } catch (error) {
        if (retries > 0) {
            console.log(`MongoDB connection failed. Retrying... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            return connectDB(retries - 1);
        }
        console.error('MongoDB connection failed after all retries:', error);
        process.exit(1);
    }
};

// Start server
const startServer = async () => {
    await connectDB();
    
    const server = app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
        //console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
    
};

// Start the server
startServer().catch(console.error);
