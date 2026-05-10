const purchaseService = require('../services/purchaseService');

function showShop(_req, res) {
  res.render('spotycoins/index', {
    title: 'Kup Spotycoiny',
    packages: purchaseService.getPackages()
  });
}

async function activateVoucher(req, res, next) {
  try {
    const result = await purchaseService.activateVoucher({
      userId: res.locals.user.id,
      amount: req.body.amount,
      code: req.body.code,
      voucherEmail: req.body.voucherEmail,
      ltcTxid: req.body.ltcTxid,
      userNote: req.body.userNote
    });
    return res.json({
      ok: true,
      message: 'Zgłoszenie zostało wysłane do weryfikacji. Spotycoiny zostaną dodane po potwierdzeniu płatności.',
      requestId: result.id,
      status: result.status
    });
  } catch (error) {
    if (error.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ ok: false, message: error.message });
    }
    return next(error);
  }
}

module.exports = {
  activateVoucher,
  showShop
};
