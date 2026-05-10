const { initDb } = require('../src/db');
const coinService = require('../src/services/coinService');

(async () => {
  await initDb();
  await coinService.ensureLedgerIntegrityFields();
  const result = await coinService.verifyLedger();

  if (result.ok) {
    console.log('OK: księga Spotycoin jest spójna.');
    console.log(`Transakcje: ${result.count}`);
    console.log(`Hash końcowy: ${result.headHash}`);
    console.log('Salda users.coins są zgodne z księgą.');
    return;
  }

  console.error('ERROR: wykryto niespójność księgi Spotycoin.');
  console.error(`Transakcje: ${result.count}`);
  console.error(`Hash końcowy: ${result.headHash}`);
  result.errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
})().catch((error) => {
  console.error('ERROR: nie udało się zweryfikować księgi Spotycoin.');
  console.error(error);
  process.exit(1);
});
