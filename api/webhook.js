const express = require('express');
const { GoogleGenAI } = require('@google/genai');
const { google } = require('googleapis');

const app = express();
app.use(express.json());

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Configure Google Sheets
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    // Vercel environment variables escape newlines, this fixes it:
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

// ROUTE 1: Meta Webhook Verification
app.get('/api/webhook', (req, res) => {
  const verify_token = "my_custom_secure_token_123"; // You will type this into Meta later
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === verify_token) {
      console.log("WEBHOOK VERIFIED");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// ROUTE 2: Handle Incoming WhatsApp Messages
app.post('/api/webhook', async (req, res) => {
  console.log("RAW PAYLOAD:", JSON.stringify(req.body, null, 2));
  // Always return 200 immediately so Meta doesn't retry the request
  res.sendStatus(200); 

  const body = req.body;
  if (body.object) {
    if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages && body.entry[0].changes[0].value.messages[0]) {
      
      const message = body.entry[0].changes[0].value.messages[0];
      
      // Only process text messages for this first test
      if (message.type === "text") {
        const rawText = message.text.body;
        console.log("Received:", rawText);

        try {
          // 1. Send to Gemini
          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Extract the expense details. Input: ${rawText}`,
            config: {
              systemInstruction: "You are an expense extraction assistant.",
              responseMimeType: "application/json",
              responseSchema: {
                type: "OBJECT",
                properties: {
                  Date: { type: "STRING" },
                  Category: { type: "STRING" },
                  Description: { type: "STRING" },
                  Location: { type: "STRING" },
                  Amount: { type: "NUMBER" },
                  Currency: { type: "STRING" }
                },
                required: ["Date", "Category", "Description", "Location", "Amount", "Currency"]
              }
            }
          });

          const data = JSON.parse(response.text);
          console.log("Gemini Output:", data);

          // 2. Push to Google Sheets
          const rowData = [[data.Date, data.Category, data.Description, data.Location, data.Amount, data.Currency]];
          await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Sheet1!A:F', // Adjust if your sheet name is different (e.g., 'المصروفات!A:F')
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: rowData },
          });
          
          console.log("Row added successfully.");

        } catch (error) {
          console.error("Error processing message:", error);
        }
      }
    }
  }
});

// Local testing port
const PORT = process.env.PORT || 3000;
module.exports = app;