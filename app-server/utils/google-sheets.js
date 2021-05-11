const fs = require('fs').promises;
const { GoogleSpreadsheet } = require('google-spreadsheet');

const logger = require('../logger');

const sheetCache = {};

async function createSpreadsheet(ssid, headers) {
  try {
    const doc = new GoogleSpreadsheet(ssid);

    const creds = JSON.parse(await fs.readFile("./client_secret.json", 'utf8'));
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo(); // loads document properties and worksheets

    const sheet = await doc.sheetsByTitle[process.env.SHEET_NAME] || await doc.addSheet({ title: process.env.SHEET_NAME, headerValues: headers });
    sheetCache[ssid] = { doc, sheet };
  } catch (err) {
    logger.error(`createSpreadsheet ${err}`);
  }
}

// add a row to the Spreadsheet with ssid value
async function addRow(ssid, dictionary) {
  try {
    const sheet = sheetCache[ssid]["sheet"];
    if (!sheet) {
      logger.error(`addRow Sheet not found in cache for ssid ${ssid}`);
      return;
    }
    return sheet.addRow(dictionary).catch(err => logger.error(`addRow addRow ${err}`));
  } catch (err) {
    logger.error(`addRow ${err}`);
  }
}

async function updateRow(ssid, selector, dictionary) {
  try {
    if (!selector) {
      logger.error(`updateRow Called without selector`);
      return;
    }
    const sheet = sheetCache[ssid]["sheet"];
    if (!sheet) {
      logger.error(`updateRow Sheet not found in cache for ssid ${ssid}`);
      return;
    }
    if (!Array.isArray(selector)) {
      selector = [selector];
    }
    const rows = await sheet.getRows();
    const row_to_update = rows.find(r => selector.every(s => r[s.key] === s.value));
    if (!row_to_update) {
      logger.warn(`updateRow Unable to find row for selector ${selector}`);
      return;
    }
    for (const [key, value] of Object.entries(dictionary)) {
      row_to_update[key] = value;
    }
    return row_to_update.save().catch(err => logger.err(`updateRow save() ${err}`));
  } catch (err) {
    logger.error(`updateRow ${err}`);
  }
}

module.exports = {
  addRow,
  createSpreadsheet,
  updateRow,
};