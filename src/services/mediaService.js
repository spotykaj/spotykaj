const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { run, get, all } = require('../db');
const fraudService = require('./fraudService');

const execFileAsync = promisify(execFile);
const publicDir = path.join(__dirname, '..', '..', 'public');
const mediaRoot = path.join(publicDir, 'media', 'listings');

const LIMITS = {
  maxImagesPerListing: 6,
  minImagesPerListing: 3,
  maxVideoBytes: 60 * 1024 * 1024,
  maxUserStorageBytes: 500 * 1024 * 1024,
  maxDailyUploads: 100
};
const FACE_BLUR_WARNING = 'Nie wykryto twarzy do rozmycia.';
const FACE_BLUR_FALLBACK_WARNING = 'Automatyczne wykrycie twarzy nie powiodło się, użyto rozmycia awaryjnego.';

function validationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  return error;
}

function mediaUrl(relativePath) {
  const base = process.env.MEDIA_BASE_URL || '';
  return `${base}${relativePath}`;
}

function nowPath() {
  const now = new Date();
  return [String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0')];
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function signature(filePath) {
  const buffer = fs.readFileSync(filePath);
  return {
    jpeg: buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
    png: buffer.length > 8 && buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    webp: buffer.length > 12 && buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP',
    mp4: buffer.length > 12 && buffer.slice(4, 8).toString('ascii') === 'ftyp',
    webm: buffer.length > 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3
  };
}

function validateImage(file) {
  const sig = signature(file.path);
  if (sig.jpeg || sig.png || sig.webp) return;
  throw validationError('Dodaj prawidłowy plik zdjęcia JPG, PNG albo WEBP.');
}

function validateVideo(file) {
  if (!file) return;
  if (file.size > LIMITS.maxVideoBytes) {
    throw validationError('Plik wideo może mieć maksymalnie 60 MB.');
  }
  const sig = signature(file.path);
  if (sig.mp4 || sig.webm) return;
  throw validationError('Dodaj prawidłowy plik wideo MP4 albo WEBM.');
}

async function assertQuota(userId, files) {
  const size = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
  const totals = await get('SELECT COALESCE(SUM(file_size), 0) AS total FROM media_assets WHERE user_id = ?', [userId]);
  if (Number(totals?.total || 0) + size > LIMITS.maxUserStorageBytes) {
    throw validationError('Przekroczono limit miejsca na multimedia dla konta.');
  }
  const daily = await get(`
    SELECT COUNT(*) AS count
    FROM media_assets
    WHERE user_id = ? AND datetime(created_at) > datetime('now', '-1 day')
  `, [userId]);
  if (Number(daily?.count || 0) + files.length > LIMITS.maxDailyUploads) {
    throw validationError('Przekroczono dzienny limit przesyłania multimediów.');
  }
}

async function convertImage(inputPath, outputPath, size, quality = 82, watermark = false) {
  const args = [
    inputPath,
    '-auto-orient',
    '-strip',
    '-resize',
    `${size}>`,
    '-sampling-factor',
    '4:2:0',
    '-quality',
    String(quality)
  ];
  if (watermark) addWatermarkArgs(args, outputPath);
  args.push(outputPath);
  await execFileAsync('convert', args, { timeout: 30000 });
}

async function imageDimensions(imagePath) {
  const { stdout } = await execFileAsync('identify', ['-format', '%w %h', imagePath], { timeout: 10000 });
  const [width, height] = stdout.trim().split(/\s+/).map((value) => Number.parseInt(value, 10));
  return { width, height };
}

function addWatermarkArgs(args) {
  args.push('-fill', 'rgba(255,255,255,0.15)', '-stroke', 'rgba(0,0,0,0.08)', '-strokewidth', '1', '-font', 'DejaVu-Sans', '-pointsize', '28');
  for (let y = -120; y <= 1600; y += 230) {
    for (let x = -180; x <= 1800; x += 360) {
      args.push('-draw', `translate ${x},${y} rotate -28 text 0,0 'spotykaj.com'`);
    }
  }
}

async function applyWatermark(imagePath) {
  const tempPath = `${imagePath}.watermark-${crypto.randomBytes(4).toString('hex')}.jpg`;
  const args = [imagePath];
  addWatermarkArgs(args);
  args.push(tempPath);
  await execFileAsync('convert', args, { timeout: 30000 });
  fs.renameSync(tempPath, imagePath);
}

function parseConnectedComponents(output, width, height) {
  return String(output || '')
    .split('\n')
    .map((line) => {
      const match = line.match(/\s(\d+)x(\d+)\+(\d+)\+(\d+)\s+[\d.]+,[\d.]+\s+\d+\s+srgb\(255,255,255\)/);
      if (!match) return null;
      const [, w, h, x, y] = match.map(Number);
      const area = w * h;
      const ratio = w / Math.max(h, 1);
      const centerY = y + h / 2;
      if (area < width * height * 0.01 || area > width * height * 0.45) return null;
      if (ratio < 0.45 || ratio > 1.45) return null;
      if (centerY > height * 0.78) return null;
      return { x, y, width: w, height: h, area };
    })
    .filter(Boolean)
    .sort((a, b) => b.area - a.area);
}

async function detectFaceRectangle(imagePath) {
  const { width, height } = await imageDimensions(imagePath);
  const sampleSize = 640;
  const scale = Math.min(1, sampleSize / Math.max(width, height));
  const sampleWidth = Math.max(1, Math.round(width * scale));
  const sampleHeight = Math.max(1, Math.round(height * scale));
  const fx = '(r>0.34&&g>0.18&&b>0.10&&r>g&&g>b&&(r-b)>0.08&&abs(r-g)>0.025)?1:0';
  const { stdout, stderr } = await execFileAsync('convert', [
    imagePath,
    '-resize',
    `${sampleWidth}x${sampleHeight}!`,
    '-alpha',
    'off',
    '-colorspace',
    'sRGB',
    '-fx',
    fx,
    '-morphology',
    'Close',
    'Disk:5',
    '-morphology',
    'Open',
    'Disk:3',
    '-define',
    'connected-components:verbose=true',
    '-connected-components',
    '8',
    'null:'
  ], { timeout: 30000, maxBuffer: 1024 * 1024 });

  const face = parseConnectedComponents(`${stdout}\n${stderr}`, sampleWidth, sampleHeight)[0];
  if (!face) return null;
  const padding = 0.18;
  const x = Math.max(0, Math.round((face.x - face.width * padding) / scale));
  const y = Math.max(0, Math.round((face.y - face.height * padding) / scale));
  const rectWidth = Math.min(width - x, Math.round(face.width * (1 + padding * 2) / scale));
  const rectHeight = Math.min(height - y, Math.round(face.height * (1 + padding * 2) / scale));
  return { x, y, width: rectWidth, height: rectHeight };
}

async function blurRectangle(imagePath, rect) {
  const tempPath = `${imagePath}.blur-${crypto.randomBytes(4).toString('hex')}.jpg`;
  await execFileAsync('convert', [
    imagePath,
    '(',
    imagePath,
    '-crop',
    `${rect.width}x${rect.height}+${rect.x}+${rect.y}`,
    '-blur',
    '0x16',
    ')',
    '-geometry',
    `+${rect.x}+${rect.y}`,
    '-composite',
    tempPath
  ], { timeout: 30000 });
  fs.renameSync(tempPath, imagePath);
}

async function applyFaceBlur(imagePath) {
  let rect = await detectFaceRectangle(imagePath);
  let fallback = false;
  if (!rect) {
    const { width, height } = await imageDimensions(imagePath);
    rect = {
      x: Math.round(width * 0.35),
      y: Math.round(height * 0.08),
      width: Math.round(width * 0.30),
      height: Math.round(height * 0.24)
    };
    fallback = true;
  }
  await blurRectangle(imagePath, rect);
  return { ...rect, fallback };
}

async function processImage(userId, file, options = {}) {
  validateImage(file);
  const hash = hashFile(file.path);
  const duplicate = await get('SELECT id FROM media_assets WHERE file_hash = ? ORDER BY id ASC LIMIT 1', [hash]);
  const [year, month] = nowPath();
  const dir = path.join(mediaRoot, year, month);
  ensureDir(dir);
  const stem = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const paths = {
    original: `/media/listings/${year}/${month}/${stem}-large.jpg`,
    large: `/media/listings/${year}/${month}/${stem}-large.jpg`,
    medium: `/media/listings/${year}/${month}/${stem}-medium.jpg`,
    thumbnail: `/media/listings/${year}/${month}/${stem}-thumb.jpg`
  };
  const largePath = path.join(publicDir, paths.large);
  const mediumPath = path.join(publicDir, paths.medium);
  await convertImage(file.path, largePath, '1400x1400', 84);
  await convertImage(file.path, mediumPath, '760x760', 80);
  await convertImage(file.path, path.join(publicDir, paths.thumbnail), '320x320', 72);
  let faceRect = null;
  let warning = null;
  if (options.faceBlur) {
    faceRect = await applyFaceBlur(largePath);
    await applyFaceBlur(mediumPath);
    if (faceRect?.fallback) warning = FACE_BLUR_FALLBACK_WARNING;
  }
  await applyWatermark(largePath);
  await applyWatermark(mediumPath);
  const storedSize = ['large', 'medium', 'thumbnail']
    .map((key) => fs.statSync(path.join(publicDir, paths[key])).size)
    .reduce((sum, item) => sum + item, 0);
  try { fs.unlinkSync(file.path); } catch (error) {}
  if (duplicate) {
    await fraudService.flagSuspicious({
      userId,
      eventType: 'duplicate_image_upload',
      score: 2,
      metadata: { duplicateOf: duplicate.id, hash }
    });
  }
  return {
    kind: 'image',
    originalPath: mediaUrl(paths.original),
    largePath: mediaUrl(paths.large),
    mediumPath: mediaUrl(paths.medium),
    thumbnailPath: mediaUrl(paths.thumbnail),
    imagePath: mediaUrl(paths.medium),
    hash,
    size: storedSize,
    mimeType: 'image/jpeg',
    duplicateOf: duplicate?.id || null
    ,
    faceRect,
    warning
  };
}

async function processVideo(userId, file) {
  if (!file) return null;
  validateVideo(file);
  const hash = hashFile(file.path);
  const [year, month] = nowPath();
  const dir = path.join(mediaRoot, year, month);
  ensureDir(dir);
  const ext = path.extname(file.originalname).toLowerCase() === '.webm' ? '.webm' : '.mp4';
  const relative = `/media/listings/${year}/${month}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  fs.renameSync(file.path, path.join(publicDir, relative));
  return {
    kind: 'video',
    originalPath: mediaUrl(relative),
    videoPath: mediaUrl(relative),
    hash,
    size: Number(file.size || 0),
    mimeType: file.mimetype,
    duplicateOf: null
  };
}

async function saveMediaAssets(userId, listingId, media) {
  for (const item of [...(media.images || []), ...(media.video || [])].filter(Boolean)) {
    await run(`
      INSERT INTO media_assets (
        user_id, listing_id, kind, original_path, thumbnail_path, medium_path, large_path,
        file_hash, file_size, mime_type, duplicate_of, processing_warning
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      userId,
      listingId,
      item.kind,
      item.originalPath || null,
      item.thumbnailPath || null,
      item.mediumPath || null,
      item.largePath || null,
      item.hash,
      item.size,
      item.mimeType,
      item.duplicateOf,
      item.warning || null
    ]);
  }
}

async function replaceListingImage({ imageId, userId, file }) {
  if (!file) {
    throw validationError('Wybierz poprawione zdjęcie do wgrania.');
  }
  const current = await get('SELECT * FROM listing_images WHERE id = ? AND deleted_at IS NULL', [imageId]);
  if (!current) {
    throw validationError('Nie znaleziono zdjęcia ogłoszenia.');
  }
  const processed = await processImage(userId, file);
  await run(`
    UPDATE listing_images
    SET image_path = ?, thumbnail_path = ?, medium_path = ?, large_path = ?,
        original_path = ?, file_hash = ?, file_size = ?, processing_warning = NULL
    WHERE id = ?
  `, [
    processed.imagePath || processed.mediumPath,
    processed.thumbnailPath || null,
    processed.mediumPath || processed.imagePath || null,
    processed.largePath || processed.imagePath || null,
    processed.originalPath || processed.largePath || processed.imagePath || null,
    processed.hash || null,
    processed.size || 0,
    imageId
  ]);
  await saveMediaAssets(userId, current.listing_id, { images: [processed], video: [] });
  return { listingId: current.listing_id, image: processed };
}

async function processListingUploads(userId, files = {}, options = {}) {
  const images = files.images || [];
  const video = (files.video || [])[0] || null;
  if (images.length < LIMITS.minImagesPerListing || images.length > LIMITS.maxImagesPerListing) {
    throw validationError('Dodaj od 3 do 6 zdjęć.');
  }
  await assertQuota(userId, [...images, video].filter(Boolean));
  const processedImages = [];
  for (const image of images) {
    processedImages.push(await processImage(userId, image, options));
  }
  const processedVideo = await processVideo(userId, video);
  return { images: processedImages, video: processedVideo ? [processedVideo] : [] };
}

async function getUserMediaUsage(userId) {
  const row = await get('SELECT COALESCE(SUM(file_size), 0) AS bytes, COUNT(*) AS files FROM media_assets WHERE user_id = ?', [userId]);
  return { bytes: Number(row?.bytes || 0), files: Number(row?.files || 0) };
}

async function getDuplicateByHash(hash) {
  return get('SELECT * FROM media_assets WHERE file_hash = ? ORDER BY id ASC LIMIT 1', [hash]);
}

async function updateImageModeration({ imageId, hidden, nsfwSeverity }) {
  await run('UPDATE listing_images SET hidden = ?, nsfw_severity = ? WHERE id = ?', [
    hidden ? 1 : 0,
    nsfwSeverity || 'standard',
    imageId
  ]);
}

module.exports = {
  FACE_BLUR_WARNING,
  FACE_BLUR_FALLBACK_WARNING,
  LIMITS,
  applyFaceBlur,
  applyWatermark,
  detectFaceRectangle,
  getDuplicateByHash,
  getUserMediaUsage,
  hashFile,
  mediaUrl,
  processListingUploads,
  replaceListingImage,
  saveMediaAssets,
  updateImageModeration,
  validateImage,
  validateVideo
};
