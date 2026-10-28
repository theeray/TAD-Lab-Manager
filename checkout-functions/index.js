'use strict';
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const { GoogleAuth } = require('google-auth-library');
const nodemailer = require('nodemailer');
const { randomInt } = require('node:crypto');
const { createService, CheckoutError } = require('./service');
const { createDelivery, HEADERS } = require('./delivery');

initializeApp();
const db = getFirestore();
const emulator = process.env.FUNCTIONS_EMULATOR === 'true';
const service = createService({ db, auth: getAuth(), FieldValue });
const GMAIL_SMTP_USER = defineSecret('GMAIL_SMTP_USER');
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD');
const base = { region: 'us-central1', memory: '256MiB', timeoutSeconds: 60, minInstances: 0, maxInstances: 1, concurrency: 1,
  serviceAccount: 'tad-lab-manager@appspot.gserviceaccount.com' };
const callOptions = { ...base, enforceAppCheck: !emulator };
function callable(method) {
  return onCall(callOptions, async request => {
    try { return await service[method](request); }
    catch (error) {
      if (error instanceof CheckoutError) throw new HttpsError(error.code, error.message);
      console.error('Checkout request failed', { method, code: error.code || 'internal' });
      throw new HttpsError('internal', 'The request could not be completed. Please try again.');
    }
  });
}
exports.checkoutSession = callable('session');
exports.checkoutSubmit = callable('submit');
exports.checkoutRecordReturn = callable('recordReturn');
exports.checkoutDashboard = callable('dashboard');
exports.checkoutRegisterAsset = callable('registerAsset');
exports.checkoutConfigure = callable('configure');

const google = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
async function writeSheet(spreadsheetId, row, values) {
  const client = await google.getClient();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  const title = 'TAD checkout log';
  const response = await client.request({ url, params: { fields: 'sheets(properties,developerMetadata)' } });
  const existing = response.data.sheets?.find(s => s.properties.title === title);
  if (existing) {
    if (!existing.developerMetadata?.some(m => m.metadataKey === 'tadCheckoutLog' && m.metadataValue === 'tad-lab-manager-pilot-v1')) {
      throw new Error('A tab with this name already exists and is not managed by TAD Lab Manager.');
    }
  } else {
    const sheetId = randomInt(1, 2000000000);
    await client.request({ url: `${url}:batchUpdate`, method: 'POST', data: { requests: [
      { addSheet: { properties: { sheetId, title, gridProperties: { frozenRowCount: 1, columnCount: HEADERS.length, rowCount: 10000 } } } },
      { createDeveloperMetadata: { developerMetadata: { metadataKey: 'tadCheckoutLog', metadataValue: 'tad-lab-manager-pilot-v1',
        location: { sheetId }, visibility: 'DOCUMENT' } } },
    ] } });
  }
  // A fixed sequence-derived row is safe to retry; RAW prevents formula execution.
  await client.request({ url: `${url}/values:batchUpdate`, method: 'POST', data: {
    valueInputOption: 'RAW', data: [
      { range: `'${title}'!A1:S1`, values: [HEADERS] },
      { range: `'${title}'!A${row}:S${row}`, values: [values] },
    ],
  } });
}
async function sendEmail(mail) {
  const sender = GMAIL_SMTP_USER.value().trim();
  if (!/^[^\s@]+@gmail\.com$/i.test(sender)) throw new Error('A Gmail SMTP sender must be configured.');
  const transport = nodemailer.createTransport({ service: 'gmail',
    auth: { user: sender, pass: GMAIL_APP_PASSWORD.value() }, connectionTimeout: 10000, socketTimeout: 20000 });
  const result = await transport.sendMail({ ...mail, from: `TAD Lab Manager <${sender}>`, replyTo: 'eric.carlson.2@bemidjistate.edu' });
  if (result.rejected?.length) throw new Error('One or more recipients were rejected.');
}
const delivery = createDelivery({ db, FieldValue, Timestamp, sendEmail, writeSheet, emulator });
const deliveryOptions = { ...base, secrets: [GMAIL_SMTP_USER, GMAIL_APP_PASSWORD] };
exports.checkoutDeliverEvent = onDocumentCreated({ ...deliveryOptions, document: 'checkoutOutbox/{eventId}', retry: false },
  event => delivery.deliver(event.params.eventId));
exports.checkoutRetryDelivery = onCall({ ...callOptions, secrets: [GMAIL_SMTP_USER, GMAIL_APP_PASSWORD], timeoutSeconds: 540 }, async request => {
  try {
    await service.manager(request);
    return await delivery.retryPending({ force: true });
  } catch (error) {
    if (error instanceof CheckoutError) throw new HttpsError(error.code, error.message);
    throw new HttpsError('internal', 'Delivery retry could not be completed.');
  }
});
