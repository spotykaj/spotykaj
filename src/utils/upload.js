const path = require('path');
const fs = require('fs');
const multer = require('multer');

const tempUploadDir = path.join(__dirname, '..', '..', 'tmp', 'uploads');
fs.mkdirSync(tempUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: tempUploadDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safe = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safe);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 80 * 1024 * 1024, files: 7 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['images', 'image'].includes(file.fieldname) && ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) && ['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) cb(null, true);
    else if (file.fieldname === 'video' && ['video/mp4', 'video/webm', 'video/quicktime'].includes(file.mimetype) && ['.mp4', '.webm', '.mov'].includes(ext)) cb(null, true);
    else cb(new Error('Dozwolone są zdjęcia oraz jeden plik wideo.'));
  }
});

const verificationDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'verifications');
fs.mkdirSync(verificationDir, { recursive: true });

const verificationStorage = multer.diskStorage({
  destination: verificationDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safe = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safe);
  }
});

const allowedVerificationTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

const verificationUpload = multer({
  storage: verificationStorage,
  limits: { fileSize: 8 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedVerificationTypes.has(file.mimetype) && ['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      cb(null, true);
      return;
    }
    cb(new Error('Do weryfikacji dodaj pliki JPG, PNG albo WEBP.'));
  }
});

module.exports = {
  upload,
  verificationUpload
};
