const path = require('path');
const fs = require('fs');
const multer = require('multer');
const fraudService = require('../services/fraudService');

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

const executableExtensions = new Set([
  '.sh', '.bash', '.zsh', '.bat', '.cmd', '.com', '.exe', '.msi', '.ps1',
  '.php', '.phtml', '.phar', '.pl', '.py', '.rb', '.cgi', '.js', '.mjs',
  '.jar', '.jsp', '.asp', '.aspx', '.html', '.htm', '.svg'
]);

function logBlockedUpload(req, file, reason) {
  fraudService.flagSuspicious({
    userId: req.session?.userId || null,
    ip: req.ip,
    eventType: 'blocked_upload',
    score: 3,
    metadata: {
      field: file.fieldname,
      filename: file.originalname,
      mimetype: file.mimetype,
      reason
    }
  }).catch(() => {});
}

const upload = multer({
  storage,
  limits: { fileSize: 80 * 1024 * 1024, files: 7 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (executableExtensions.has(ext)) {
      logBlockedUpload(req, file, 'executable_extension');
      cb(new Error('Ten typ pliku jest niedozwolony.'));
      return;
    }
    if (['images', 'image'].includes(file.fieldname) && ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) && ['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) cb(null, true);
    else if (file.fieldname === 'video' && file.mimetype === 'video/mp4' && ext === '.mp4') cb(null, true);
    else {
      logBlockedUpload(req, file, 'invalid_type');
      cb(new Error('Dozwolone formaty plików: JPG, JPEG, PNG, WEBP oraz MP4.'));
    }
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
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (executableExtensions.has(ext)) {
      logBlockedUpload(req, file, 'verification_executable_extension');
      cb(new Error('Ten typ pliku jest niedozwolony.'));
      return;
    }
    if (allowedVerificationTypes.has(file.mimetype) && ['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      cb(null, true);
      return;
    }
    logBlockedUpload(req, file, 'verification_invalid_type');
    cb(new Error('Do weryfikacji dodaj pliki JPG, PNG albo WEBP.'));
  }
});

module.exports = {
  upload,
  verificationUpload
};
