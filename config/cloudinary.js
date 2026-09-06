require('dotenv').config();
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'autodex',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp']
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB — without this, uploads are unbounded
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Cheap pre-check before the bytes are streamed to Cloudinary
    if (file.mimetype && file.mimetype.startsWith('image/')) return cb(null, true);
    cb(null, false);
  }
});

module.exports = { cloudinary, upload };
