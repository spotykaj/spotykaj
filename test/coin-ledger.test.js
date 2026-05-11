const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const bcrypt = require('bcryptjs');
const ejs = require('ejs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotykaj-ledger-'));
process.env.SQLITE_DB_PATH = path.join(tmpDir, 'market.db');

const db = require('../src/db');
const coinService = require('../src/services/coinService');
const favoriteService = require('../src/services/favoriteService');
const listingService = require('../src/services/listingService');
const messageService = require('../src/services/messageService');
const promotionService = require('../src/services/promotionService');
const purchaseService = require('../src/services/purchaseService');
const userService = require('../src/services/userService');
const verificationService = require('../src/services/verificationService');
const reportService = require('../src/services/reportService');
const auditService = require('../src/services/auditService');
const mediaService = require('../src/services/mediaService');
const tipService = require('../src/services/tipService');
const adminController = require('../src/controllers/adminController');
const moderatorController = require('../src/controllers/moderatorController');
const { requireAdmin, requireModerator } = require('../src/middleware/auth');
const { rateLimit, resetRateLimits } = require('../src/middleware/rateLimit');
const { protectVerificationUploads, sameOriginGuard } = require('../src/middleware/security');
const { TURNSTILE_ERROR, verifyTurnstile } = require('../src/middleware/turnstile');
const legalRoutes = require('../src/routes/legalRoutes');

async function createUser(name, coins = 0, role = 'user') {
  const passwordHash = await bcrypt.hash('haslo123', 10);
  const result = await db.run(
    'INSERT INTO users (name, email, password_hash, role, coins) VALUES (?, ?, ?, ?, ?)',
    [name, `${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`, passwordHash, role, coins]
  );
  return {
    id: result.lastID,
    email: (await db.get('SELECT email FROM users WHERE id = ?', [result.lastID])).email,
    password: 'haslo123',
    role
  };
}

async function callLegalRoute(pathname) {
  const layer = legalRoutes.stack.find((item) => item.route?.path === pathname);
  assert.ok(layer, `Brak route ${pathname}`);
  const handler = layer.route.stack[0].handle;
  const res = {
    statusCode: 200,
    rendered: null,
    render(view, payload) {
      this.rendered = { view, payload };
      return this;
    }
  };
  await handler({}, res);
  return res;
}

async function createListing(userId, title = 'Profil testowy') {
  const result = await db.run(`
    INSERT INTO listings (user_id, title, description, price, city, region, category, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [userId, title, 'Opis: Test\nTelefon: 500 600 700', 450, 'Warszawa', 'Mazowieckie', 'Panie', 'active']);
  return result.lastID;
}

function writeTinyImage(filename) {
  const filePath = path.join(tmpDir, filename);
  fs.writeFileSync(filePath, Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAHCf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ADoDFU3/2Q==',
    'base64'
  ));
  return filePath;
}

test('Spotycoin ledger records grants, spends, hash chain and cache balances', async () => {
  await db.initDb();
  await messageService.ensureMessageTable();

  const admin = await createUser('Admin', 0, 'admin');
  const adminId = admin.id;
  const promotedUserId = (await createUser('Promowana')).id;
  const senderId = (await createUser('Nadawca')).id;
  const ownerId = (await createUser('Odbiorca')).id;
  const unrelatedId = (await createUser('Obcy')).id;
  const poorUserId = (await createUser('Bez monet')).id;
  const buyerId = (await createUser('Kupujacy')).id;
  assert.deepEqual(purchaseService.getPackages(), [
    { priceEur: 25, amount: 145, label: 'Crypto Code' },
    { priceEur: 50, amount: 290, label: 'Crypto Code' },
    { priceEur: 100, amount: 575, label: 'Crypto Code' },
    { priceEur: 150, amount: 1290, label: 'Crypto Code' },
    { priceEur: 300, amount: 1725, label: 'Crypto Code' },
    { priceEur: 700, amount: 4865, label: 'Crypto Code' }
  ]);

  const grantResult = await coinService.grantCoins({
    userId: promotedUserId,
    adminId,
    amount: 100,
    note: 'Test grant'
  });
  assert.equal(grantResult, 100);

  let promotedTransactions = await coinService.getUserTransactions(promotedUserId, 10);
  const grantTx = promotedTransactions.find((transaction) => transaction.transaction_type === 'admin_grant');
  assert.ok(grantTx);
  assert.equal(Number(grantTx.amount), 100);
  assert.equal(Number(grantTx.balance_before), 0);
  assert.equal(Number(grantTx.balance_after), 100);

  const promotedListingId = await createListing(promotedUserId, 'Profil promowany');
  const firstPromotion = await promotionService.promoteListing({ listingId: promotedListingId, userId: promotedUserId, days: 7 });
  await coinService.grantCoins({ userId: promotedUserId, adminId, amount: 35, note: 'Test promotion extension balance' });
  const extendedPromotion = await promotionService.promoteListing({ listingId: promotedListingId, userId: promotedUserId, days: 7 });
  const firstEnd = new Date(firstPromotion.promotedUntil.replace(' ', 'T') + 'Z');
  const extendedEnd = new Date(extendedPromotion.promotedUntil.replace(' ', 'T') + 'Z');
  assert.equal(Math.round((extendedEnd.getTime() - firstEnd.getTime()) / (1000 * 60 * 60 * 24)), 7);

  promotedTransactions = await coinService.getUserTransactions(promotedUserId, 10);
  const promotionTx = promotedTransactions.find((transaction) => transaction.transaction_type === 'listing_promotion');
  assert.ok(promotionTx);
  assert.equal(Number(promotionTx.amount), -35);
  assert.ok(Number(promotionTx.balance_before) >= 35);

  await coinService.grantCoins({ userId: senderId, adminId, amount: 10, note: 'Test message balance' });
  const messageListingId = await createListing(ownerId, 'Profil do wiadomości');
  await assert.rejects(
    () => messageService.sendListingMessage({
      listingId: messageListingId,
      senderId: poorUserId,
      body: 'Nie mam monet.'
    }),
    /Masz za mało Spotycoinów/
  );
  await assert.rejects(
    () => messageService.sendListingMessage({
      listingId: messageListingId,
      senderId: ownerId,
      body: 'Własne ogłoszenie.'
    }),
    /Nie możesz wysłać wiadomości do własnego ogłoszenia/
  );
  const sentMessage = await messageService.sendListingMessage({
    listingId: messageListingId,
    senderId,
    body: 'Dzień dobry, proszę o kontakt.'
  });

  const senderTransactions = await coinService.getUserTransactions(senderId, 10);
  const messageTx = senderTransactions.find((transaction) => transaction.transaction_type === 'message_fee');
  assert.ok(messageTx);
  assert.equal(Number(messageTx.amount), -5);
  assert.equal(Number(messageTx.balance_before), 10);
  assert.equal(Number(messageTx.balance_after), 5);
  assert.equal(await coinService.getBalance(senderId), 5);

  const storedMessage = await db.get('SELECT * FROM messages WHERE id = ?', [sentMessage.messageId]);
  assert.equal(Number(storedMessage.cost_spotycoins), 5);
  assert.equal(Number(storedMessage.is_read), 0);

  const senderView = await messageService.getMessageForUser(sentMessage.messageId, { id: senderId, role: 'user' });
  assert.equal(senderView.body, 'Dzień dobry, proszę o kontakt.');
  let readState = await db.get('SELECT is_read FROM messages WHERE id = ?', [sentMessage.messageId]);
  assert.equal(Number(readState.is_read), 0);

  const receiverView = await messageService.getMessageForUser(sentMessage.messageId, { id: ownerId, role: 'user' });
  assert.equal(receiverView.sender_id, senderId);
  readState = await db.get('SELECT is_read FROM messages WHERE id = ?', [sentMessage.messageId]);
  assert.equal(Number(readState.is_read), 1);

  await assert.rejects(
    () => messageService.getMessageForUser(sentMessage.messageId, { id: unrelatedId, role: 'user' }),
    /Nie masz dostępu do tej wiadomości/
  );

  const inbox = await messageService.getInbox(ownerId);
  const outbox = await messageService.getOutbox(senderId);
  assert.equal(inbox[0].id, sentMessage.messageId);
  assert.equal(outbox[0].id, sentMessage.messageId);

  await coinService.grantCoins({ userId: ownerId, adminId, amount: 10, note: 'Test reply balance' });
  const reply = await messageService.replyToMessage({
    messageId: sentMessage.messageId,
    senderId: ownerId,
    body: 'Odpowiedź testowa.'
  });
  assert.ok(reply.messageId);
  const conversation = await messageService.getConversationForMessage(sentMessage.messageId, { id: senderId, role: 'user' });
  assert.equal(conversation.messages.length, 2);
  assert.equal(conversation.messages[1].body, 'Odpowiedź testowa.');

  assert.equal(await favoriteService.isFavorite(senderId, messageListingId), false);
  const savedFavorite = await favoriteService.toggleFavorite({ userId: senderId, listingId: messageListingId });
  assert.equal(savedFavorite.saved, true);
  assert.equal(await favoriteService.isFavorite(senderId, messageListingId), true);
  const favoriteListings = await favoriteService.getFavorites(senderId);
  assert.ok(favoriteListings.some((listing) => Number(listing.id) === Number(messageListingId)));
  const removedFavorite = await favoriteService.toggleFavorite({ userId: senderId, listingId: messageListingId });
  assert.equal(removedFavorite.saved, false);

  await coinService.grantCoins({ userId: senderId, adminId, amount: 30, note: 'Test tip balance' });
  await assert.rejects(
    () => tipService.sendTip({ listingId: messageListingId, senderId: ownerId, amount: 5 }),
    /Nie możesz wysłać napiwku do własnego ogłoszenia/
  );
  await assert.rejects(
    () => tipService.sendTip({ listingId: messageListingId, senderId: poorUserId, amount: 5 }),
    /Masz za mało Spotycoinów/
  );
  const tip = await tipService.sendTip({
    listingId: messageListingId,
    senderId,
    amount: 10,
    note: 'Dziękuję'
  });
  assert.ok(tip.tipId);
  const tipHistorySender = await tipService.getTipHistory(senderId);
  const tipHistoryReceiver = await tipService.getTipHistory(ownerId);
  assert.ok(tipHistorySender.some((item) => Number(item.id) === Number(tip.tipId) && Number(item.amount) === 10));
  assert.ok(tipHistoryReceiver.some((item) => Number(item.id) === Number(tip.tipId) && item.note === 'Dziękuję'));
  const tipTransactions = await coinService.getUserTransactions(senderId, 20);
  const senderTipTx = tipTransactions.find((transaction) => transaction.transaction_type === 'tip' && transaction.reference_id === String(tip.tipId));
  assert.ok(senderTipTx);
  assert.equal(Number(senderTipTx.amount), -10);
  const receiverTipTx = (await coinService.getUserTransactions(ownerId, 20))
    .find((transaction) => transaction.transaction_type === 'tip' && transaction.reference_id === String(tip.tipId));
  assert.ok(receiverTipTx);
  assert.equal(Number(receiverTipTx.amount), 10);

  await assert.rejects(
    () => purchaseService.activateVoucher({ userId: buyerId, amount: 999, code: 'VOUCHER-BAD', voucherEmail: 'buyer@example.test' }),
    /Wybierz prawidłowy pakiet/
  );
  await assert.rejects(
    () => purchaseService.activateVoucher({ userId: buyerId, amount: 575, code: '', voucherEmail: 'buyer@example.test' }),
    /Wpisz kod lub numer vouchera/
  );
  await assert.rejects(
    () => purchaseService.activateVoucher({ userId: buyerId, amount: 575, code: 'VOUCHER-NO-PROOF' }),
    /Podaj e-mail użyty/
  );

  const request = await purchaseService.activateVoucher({
    userId: buyerId,
    amount: 575,
    code: 'TEST-ABC',
    voucherEmail: 'buyer@example.test',
    ltcTxid: 'ltc-txid-abc-123',
    userNote: 'Przelew wysłany'
  });
  assert.equal(request.status, 'pending');
  assert.equal(request.packageAmount, 575);
  assert.equal(await coinService.getBalance(buyerId), 0);
  let purchaseRequests = await purchaseService.getUserPurchaseRequests(buyerId);
  assert.equal(purchaseRequests.length, 1);
  assert.equal(purchaseRequests[0].status, 'pending');
  assert.equal(Number(purchaseRequests[0].package_eur), 100);
  assert.equal(Number(purchaseRequests[0].package_spotycoins), 575);
  assert.equal(purchaseRequests[0].crypto_code, 'TEST-ABC');
  assert.equal(purchaseRequests[0].voucher_email, 'buyer@example.test');
  assert.equal(purchaseRequests[0].ltc_txid, 'ltc-txid-abc-123');
  assert.equal(purchaseRequests[0].user_note, 'Przelew wysłany');

  await assert.rejects(
    () => purchaseService.activateVoucher({ userId: buyerId, amount: 575, code: 'TEST-ABC', voucherEmail: 'buyer2@example.test' }),
    /Ten kod został już wysłany/
  );
  await assert.rejects(
    () => purchaseService.activateVoucher({ userId: buyerId, amount: 575, code: 'TEST-OTHER', ltcTxid: 'ltc-txid-abc-123' }),
    /Ten TXID Litecoin został już wysłany/
  );
  await assert.rejects(
    () => purchaseService.approveRequest({ requestId: request.id, adminId: senderId }),
    /Brak dostępu/
  );

  const approval = await purchaseService.approveRequest({ requestId: request.id, adminId, adminNote: 'Kod poprawny' });
  assert.equal(approval.status, 'approved');
  assert.equal(await coinService.getBalance(buyerId), 575);
  purchaseRequests = await purchaseService.getUserPurchaseRequests(buyerId);
  assert.equal(purchaseRequests[0].status, 'approved');
  assert.equal(Number(purchaseRequests[0].admin_id), adminId);
  assert.equal(purchaseRequests[0].admin_note, 'Kod poprawny');
  const purchaseTransactions = await coinService.getUserTransactions(buyerId, 10);
  const purchaseTx = purchaseTransactions.find((transaction) => transaction.transaction_type === 'purchase');
  assert.ok(purchaseTx);
  assert.equal(Number(purchaseTx.amount), 575);
  assert.equal(Number(purchaseTx.balance_before), 0);
  assert.equal(Number(purchaseTx.balance_after), 575);
  assert.equal(purchaseTx.reference_type, 'spotycoin_purchase_request');
  assert.equal(purchaseTx.reference_id, String(request.id));

  await assert.rejects(
    () => purchaseService.approveRequest({ requestId: request.id, adminId }),
    /Ten wniosek został już rozpatrzony/
  );

  const rejectedRequest = await purchaseService.activateVoucher({
    userId: buyerId,
    amount: 145,
    code: 'CRYPTO-REJECT',
    ltcTxid: 'ltc-txid-reject-456'
  });
  await purchaseService.rejectRequest({ requestId: rejectedRequest.id, adminId, adminNote: 'Kod odrzucony' });
  assert.equal(await coinService.getBalance(buyerId), 575);
  purchaseRequests = await purchaseService.getUserPurchaseRequests(buyerId);
  const rejected = purchaseRequests.find((item) => Number(item.id) === Number(rejectedRequest.id));
  assert.equal(rejected.status, 'rejected');

  const roleTarget = await createUser('Rola Moderator');
  const roleReq = {
    params: { id: String(roleTarget.id) },
    body: { role: 'moderator' },
    session: {},
  };
  const roleRes = {
    locals: { user: { id: adminId, role: 'admin' } },
    redirectTo: null,
    redirect(pathName) { this.redirectTo = pathName; }
  };
  await adminController.updateUserRole(roleReq, roleRes, (error) => { throw error; });
  assert.equal(roleRes.redirectTo, '/admin');
  const promotedRole = await db.get('SELECT role FROM users WHERE id = ?', [roleTarget.id]);
  assert.equal(promotedRole.role, 'moderator');

  let moderatorAllowed = false;
  requireModerator(
    { session: {} },
    { locals: { user: { id: roleTarget.id, role: 'moderator' } } },
    () => { moderatorAllowed = true; }
  );
  assert.equal(moderatorAllowed, true);

  const renderRes = {
    locals: { user: { id: roleTarget.id, role: 'moderator' } },
    rendered: null,
    render(view, payload) { this.rendered = { view, payload }; }
  };
  await moderatorController.showModerator({ session: {} }, renderRes, (error) => { throw error; });
  assert.equal(renderRes.rendered.view, 'moderator/index');
  assert.equal(renderRes.rendered.payload.title, 'Panel moderatora');

  const normalUser = await createUser('Zwykly User');
  const deniedRes = {
    locals: { user: { id: normalUser.id, role: 'user' } },
    redirectTo: null,
    redirect(pathName) { this.redirectTo = pathName; }
  };
  requireModerator({ session: {} }, deniedRes, () => {
    throw new Error('Zwykły użytkownik nie powinien wejść do panelu moderatora.');
  });
  assert.equal(deniedRes.redirectTo, '/panel');

  const deniedAdminRes = {
    locals: { user: { id: normalUser.id, role: 'user' } },
    redirectTo: null,
    redirect(pathName) { this.redirectTo = pathName; }
  };
  requireAdmin({ session: {} }, deniedAdminRes, () => {
    throw new Error('Zwykły użytkownik nie powinien wejść do panelu admina.');
  });
  assert.equal(deniedAdminRes.redirectTo, '/');

  const moderatorAdminRes = {
    locals: { user: { id: roleTarget.id, role: 'moderator' } },
    redirectTo: null,
    redirect(pathName) { this.redirectTo = pathName; }
  };
  requireAdmin({ session: {} }, moderatorAdminRes, () => {
    throw new Error('Moderator nie powinien wejść do pełnego panelu admina.');
  });
  assert.equal(moderatorAdminRes.redirectTo, '/');

  const moderatedListingId = await createListing(ownerId, 'Profil do pauzy');
  const pauseRes = {
    locals: { user: { id: roleTarget.id, role: 'moderator' } },
    redirectTo: null,
    redirect(pathName) { this.redirectTo = pathName; }
  };
  await moderatorController.updateListingStatus({
    params: { id: String(moderatedListingId) },
    body: { status: 'hidden' },
    session: {}
  }, pauseRes, (error) => { throw error; });
  assert.equal(pauseRes.redirectTo, '/moderator');
  let moderatedListing = await db.get('SELECT status FROM listings WHERE id = ?', [moderatedListingId]);
  assert.equal(moderatedListing.status, 'hidden');

  await assert.rejects(
    () => listingService.deleteListing(moderatedListingId, { id: roleTarget.id, role: 'moderator' }),
    /Nie możesz usunąć tego ogłoszenia/
  );
  moderatedListing = await db.get('SELECT id, status FROM listings WHERE id = ?', [moderatedListingId]);
  assert.equal(Number(moderatedListing.id), Number(moderatedListingId));
  await listingService.updateListingStatus(moderatedListingId, 'approved', { id: roleTarget.id, role: 'moderator' });
  let listingAudit = await auditService.getRecentAuditLog(5);
  assert.ok(listingAudit.some((item) => item.action_type === 'approve_listing' && String(item.target_id) === String(moderatedListingId)));

  const reportId = await reportService.createReport({
    listingId: moderatedListingId,
    reporterId: normalUser.id,
    reason: 'Spam',
    note: 'Podejrzane ogłoszenie'
  });
  const reports = await reportService.getReportsForModeration();
  assert.ok(reports.some((report) => Number(report.id) === Number(reportId)));
  await reportService.reviewReport({
    reportId,
    reviewerId: roleTarget.id,
    status: 'resolved',
    reviewerNote: 'Sprawdzone'
  });
  listingAudit = await auditService.getRecentAuditLog(10);
  assert.ok(listingAudit.some((item) => item.action_type === 'report_resolved' && String(item.target_id) === String(reportId)));

  await listingService.deleteListing(moderatedListingId, { id: ownerId, role: 'user' });
  moderatedListing = await db.get('SELECT id, deleted_at FROM listings WHERE id = ?', [moderatedListingId]);
  assert.ok(moderatedListing.deleted_at);

  const routeBuyer = await createUser('Kupujacy Moderator');
  const moderatorRequest = await purchaseService.activateVoucher({
    userId: routeBuyer.id,
    amount: 145,
    code: 'MOD-APPROVE-1',
    voucherEmail: 'mod-buyer@example.test'
  });
  const approveRes = {
    locals: { user: { id: roleTarget.id, role: 'moderator' } },
    redirectTo: null,
    redirect(pathName) { this.redirectTo = pathName; }
  };
  await moderatorController.approvePurchaseRequest({
    params: { id: String(moderatorRequest.id) },
    body: { admin_note: 'Moderator zaakceptował' },
    session: {}
  }, approveRes, (error) => { throw error; });
  assert.equal(approveRes.redirectTo, '/moderator');
  assert.equal(await coinService.getBalance(routeBuyer.id), 145);
  const moderatorPurchaseTx = (await coinService.getUserTransactions(routeBuyer.id, 10))
    .find((transaction) => transaction.transaction_type === 'purchase');
  assert.ok(moderatorPurchaseTx);
  assert.equal(Number(moderatorPurchaseTx.amount), 145);
  assert.equal(Number(moderatorPurchaseTx.admin_id), Number(roleTarget.id));
  assert.equal(moderatorPurchaseTx.reference_id, String(moderatorRequest.id));

  await assert.rejects(
    () => userService.updateUserRole(normalUser.id, 'admin', { id: roleTarget.id, role: 'moderator' }),
    /Tylko administrator/
  );
  await assert.rejects(
    () => userService.updateUserRole(normalUser.id, 'moderator', { id: roleTarget.id, role: 'moderator' }),
    /Tylko administrator/
  );
  await assert.rejects(
    () => coinService.grantCoins({ userId: normalUser.id, adminId: roleTarget.id, amount: 10, note: 'Niedozwolone' }),
    /Tylko administrator/
  );

  const verificationUser = await createUser('Weryfikacja User');
  await assert.rejects(
    () => verificationService.submitRequest({
      userId: verificationUser.id,
      documentFile: { filename: 'document.jpg' },
      note: 'Brak selfie'
    }),
    /Dodaj zdjęcie dokumentu oraz selfie/
  );
  const verificationRequestId = await verificationService.submitRequest({
    userId: verificationUser.id,
    documentFile: { filename: 'document.jpg' },
    selfieFile: { filename: 'selfie.webp' },
    note: 'Proszę o sprawdzenie'
  });
  assert.ok(verificationRequestId);
  let latestVerification = await verificationService.getLatestUserRequest(verificationUser.id);
  assert.equal(latestVerification.status, 'pending');
  assert.equal(latestVerification.document_image_path, '/uploads/verifications/document.jpg');
  assert.equal(latestVerification.selfie_image_path, '/uploads/verifications/selfie.webp');

  await assert.rejects(
    () => verificationService.approveRequest({
      requestId: verificationRequestId,
      reviewerId: normalUser.id,
      reviewerNote: 'Nie wolno'
    }),
    /Brak dostępu/
  );
  await verificationService.approveRequest({
    requestId: verificationRequestId,
    reviewerId: roleTarget.id,
    reviewerNote: 'Dokument poprawny'
  });
  latestVerification = await verificationService.getLatestUserRequest(verificationUser.id);
  assert.equal(latestVerification.status, 'approved');
  const verifiedAccount = await db.get('SELECT profile_verified FROM users WHERE id = ?', [verificationUser.id]);
  assert.equal(Number(verifiedAccount.profile_verified), 1);

  let ownerFileAllowed = false;
  await protectVerificationUploads(
    { path: '/uploads/verifications/document.jpg' },
    { locals: { user: { id: verificationUser.id, role: 'user' } } },
    () => { ownerFileAllowed = true; }
  );
  assert.equal(ownerFileAllowed, true);

  const blockedFileRes = {
    locals: { user: null },
    statusCode: null,
    status(code) { this.statusCode = code; return this; },
    render() {}
  };
  await protectVerificationUploads(
    { path: '/uploads/verifications/document.jpg' },
    blockedFileRes,
    () => {
      throw new Error('Niezalogowany użytkownik nie powinien pobrać pliku weryfikacji.');
    }
  );
  assert.equal(blockedFileRes.statusCode, 404);

  const rejectedVerificationUser = await createUser('Weryfikacja Odrzucona');
  const rejectedVerificationId = await verificationService.submitRequest({
    userId: rejectedVerificationUser.id,
    documentFile: { filename: 'bad-document.jpg' },
    selfieFile: { filename: 'bad-selfie.jpg' },
    note: 'Drugie sprawdzenie'
  });
  await verificationService.rejectRequest({
    requestId: rejectedVerificationId,
    reviewerId: roleTarget.id,
    reviewerNote: 'Nieczytelne zdjęcie'
  });
  const rejectedVerification = await verificationService.getLatestUserRequest(rejectedVerificationUser.id);
  assert.equal(rejectedVerification.status, 'rejected');
  assert.equal(rejectedVerification.reviewer_note, 'Nieczytelne zdjęcie');
  const rejectedAccount = await db.get('SELECT profile_verified FROM users WHERE id = ?', [rejectedVerificationUser.id]);
  assert.equal(Number(rejectedAccount.profile_verified), 0);

  const selfReviewRequestId = await verificationService.submitRequest({
    userId: roleTarget.id,
    documentFile: { filename: 'moderator-document.jpg' },
    selfieFile: { filename: 'moderator-selfie.jpg' },
    note: 'Własny wniosek moderatora'
  });
  await assert.rejects(
    () => verificationService.approveRequest({
      requestId: selfReviewRequestId,
      reviewerId: roleTarget.id,
      reviewerNote: 'Własna akceptacja'
    }),
    /Nie możesz rozpatrzyć własnego wniosku/
  );

  const invalidUploadPath = path.join(tmpDir, 'invalid-upload.jpg');
  fs.writeFileSync(invalidUploadPath, '#!/bin/sh\necho bad');
  const invalidUploadUser = await createUser('Nieprawidlowy Upload');
  await assert.rejects(
    () => verificationService.submitRequest({
      userId: invalidUploadUser.id,
      documentFile: { filename: 'invalid-upload.jpg', path: invalidUploadPath },
      selfieFile: { filename: 'selfie.jpg' },
      note: 'Zły plik'
    }),
    /prawidłowy plik/
  );
  assert.equal(fs.existsSync(invalidUploadPath), false);

  const mediaUser = await createUser('Media User');
  const imageFiles = [1, 2, 3].map((index) => {
    const filePath = writeTinyImage(`media-${index}.jpg`);
    return {
      path: filePath,
      originalname: `media-${index}.jpg`,
      filename: `media-${index}.jpg`,
      mimetype: 'image/jpeg',
      size: fs.statSync(filePath).size
    };
  });
  const processedMedia = await mediaService.processListingUploads(mediaUser.id, { images: imageFiles, video: [] });
  assert.equal(processedMedia.images.length, 3);
  assert.ok(processedMedia.images[0].thumbnailPath.startsWith('/media/listings/'));
  assert.ok(processedMedia.images[0].mediumPath.endsWith('.jpg'));
  assert.equal(fs.existsSync(imageFiles[0].path), false);
  await mediaService.saveMediaAssets(mediaUser.id, 9999, processedMedia);
  const duplicateFilePath = writeTinyImage('media-duplicate.jpg');
  const duplicateHash = mediaService.hashFile(duplicateFilePath);
  const duplicate = await mediaService.getDuplicateByHash(duplicateHash);
  assert.ok(duplicate);
  await assert.rejects(
    () => mediaService.processListingUploads(mediaUser.id, {
      images: [{
        path: writeTinyImage('only-one.jpg'),
        originalname: 'only-one.jpg',
        filename: 'only-one.jpg',
        mimetype: 'image/jpeg',
        size: 100
      }],
      video: []
    }),
    /Dodaj od 3 do 6 zdjęć/
  );
  const quotaUser = await createUser('Quota User');
  for (let index = 0; index < mediaService.LIMITS.maxDailyUploads; index += 1) {
    await db.run('INSERT INTO media_assets (user_id, kind, file_size) VALUES (?, ?, ?)', [quotaUser.id, 'image', 1]);
  }
  await assert.rejects(
    () => mediaService.processListingUploads(quotaUser.id, {
      images: [1, 2, 3].map((index) => ({
        path: writeTinyImage(`quota-${index}.jpg`),
        originalname: `quota-${index}.jpg`,
        filename: `quota-${index}.jpg`,
        mimetype: 'image/jpeg',
        size: 100
      })),
      video: []
    }),
    /dzienny limit/
  );
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'profileCard.ejs'), 'utf8'), /loading="lazy"/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'views', 'listings', 'show.ejs'), 'utf8'), /data-gallery-thumb/);

  let sameOriginAllowed = false;
  sameOriginGuard({
    method: 'POST',
    get(header) {
      return { origin: 'https://spotykaj.test', host: 'spotykaj.test' }[header.toLowerCase()];
    },
    session: {}
  }, {}, () => { sameOriginAllowed = true; });
  assert.equal(sameOriginAllowed, true);

  const crossOriginRes = {
    statusCode: null,
    rendered: null,
    status(code) { this.statusCode = code; return this; },
    render(view, payload) { this.rendered = { view, payload }; }
  };
  sameOriginGuard({
    method: 'POST',
    get(header) {
      return { origin: 'https://evil.example', host: 'spotykaj.test' }[header.toLowerCase()];
    },
    session: {}
  }, crossOriginRes, () => {
    throw new Error('Obcy origin nie powinien przejść.');
  });
  assert.equal(crossOriginRes.statusCode, 403);
  assert.equal(crossOriginRes.rendered.payload.title, 'Brak dostępu');

  resetRateLimits();
  const limiter = rateLimit({ scope: 'test_limit', max: 2, windowMs: 60 * 1000, message: 'Limit testowy.' });
  const limitReq = {
    method: 'POST',
    ip: '127.0.0.44',
    path: '/api/test',
    session: {},
    accepts() { return false; }
  };
  function limitRes() {
    return {
      statusCode: null,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    };
  }
  let passedLimit = 0;
  await limiter(limitReq, limitRes(), () => { passedLimit += 1; });
  await limiter(limitReq, limitRes(), () => { passedLimit += 1; });
  const limitedRes = limitRes();
  await limiter(limitReq, limitedRes, () => { passedLimit += 1; });
  assert.equal(passedLimit, 2);
  assert.equal(limitedRes.statusCode, 429);

  const beforeInsufficient = await db.all('SELECT id FROM coin_transactions');
  await assert.rejects(
    () => coinService.spendCoins({ userId: senderId, amount: 99, transactionType: 'test_spend' }),
    /Masz za mało Spotycoinów/
  );
  const afterInsufficient = await db.all('SELECT id FROM coin_transactions');
  assert.equal(afterInsufficient.length, beforeInsufficient.length);

  const rows = await db.all('SELECT * FROM coin_transactions ORDER BY ledger_index ASC, id ASC');
  assert.ok(rows.length >= 4);
  let previousHash = '0'.repeat(64);
  rows.forEach((row) => {
    assert.equal(row.previous_hash, previousHash);
    assert.equal(row.hash, coinService.hashTransaction(row));
    previousHash = row.hash;
  });

  const verify = await coinService.verifyLedger();
  assert.equal(verify.ok, true);
  verify.userBalances.forEach((balance) => {
    assert.equal(balance.cachedBalance, balance.derivedBalance);
    assert.equal(balance.ok, true);
  });

  const first = rows[0];
  await db.run('UPDATE coin_transactions SET note = ? WHERE id = ?', ['tampered note', first.id]);
  const tampered = await coinService.verifyLedger();
  assert.equal(tampered.ok, false);
  assert.ok(tampered.errors.some((error) => error.includes('hash transakcji')));

  await db.run('UPDATE coin_transactions SET note = ?, hash = ? WHERE id = ?', [first.note, first.hash, first.id]);
  const second = rows[1];
  await db.run('UPDATE coin_transactions SET previous_hash = ? WHERE id = ?', ['bad-hash', second.id]);
  const brokenPrevious = await coinService.verifyLedger();
  assert.equal(brokenPrevious.ok, false);
  assert.ok(brokenPrevious.errors.some((error) => error.includes('poprzedni hash')));

  const oldTurnstileEnabled = process.env.TURNSTILE_ENABLED;
  const oldTurnstileSite = process.env.TURNSTILE_SITE_KEY;
  const oldTurnstileSecret = process.env.TURNSTILE_SECRET_KEY;
  process.env.TURNSTILE_ENABLED = 'false';
  let turnstilePassed = false;
  await verifyTurnstile({ body: {}, accepts() { return false; } }, {}, () => { turnstilePassed = true; });
  assert.equal(turnstilePassed, true);

  process.env.TURNSTILE_ENABLED = 'true';
  process.env.TURNSTILE_SITE_KEY = 'test-site';
  process.env.TURNSTILE_SECRET_KEY = 'test-secret';
  const turnstileRes = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
  await verifyTurnstile({
    body: {},
    ip: '127.0.0.1',
    accepts(type) { return type === 'json'; }
  }, turnstileRes, () => {
    throw new Error('Brak tokenu Turnstile nie powinien przejść.');
  });
  assert.equal(turnstileRes.statusCode, 400);
  assert.equal(turnstileRes.body.message, TURNSTILE_ERROR);
  if (typeof oldTurnstileEnabled === 'undefined') delete process.env.TURNSTILE_ENABLED;
  else process.env.TURNSTILE_ENABLED = oldTurnstileEnabled;
  if (typeof oldTurnstileSite === 'undefined') delete process.env.TURNSTILE_SITE_KEY;
  else process.env.TURNSTILE_SITE_KEY = oldTurnstileSite;
  if (typeof oldTurnstileSecret === 'undefined') delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = oldTurnstileSecret;

  const legalRoutes = ['/regulamin', '/polityka-prywatnosci', '/zasady-zdjec'];
  for (const route of legalRoutes) {
    const response = await callLegalRoute(route);
    assert.equal(response.statusCode, 200);
    assert.equal(response.rendered.view, 'legal/page');
    assert.match(response.rendered.payload.title, /Regulamin|Polityka prywatności|Zasady zdjęć/);
  }

  const footer = await ejs.renderFile(path.join(__dirname, '..', 'views', 'partials', 'footer.ejs'), {
    isLegalPage: false,
    turnstile: { enabled: false }
  });
  assert.match(footer, /href="\/regulamin"/);
  assert.match(footer, /href="\/polityka-prywatnosci"/);
  assert.match(footer, /href="\/zasady-zdjec"/);
  assert.match(footer, /data-age-gate/);
  assert.match(footer, /spotykaj_age_verified/);
  assert.match(footer, /Serwis tylko dla osób pełnoletnich/);

  const legalFooter = await ejs.renderFile(path.join(__dirname, '..', 'views', 'partials', 'footer.ejs'), {
    isLegalPage: true,
    turnstile: { enabled: false }
  });
  assert.doesNotMatch(legalFooter, /data-age-gate/);
});
