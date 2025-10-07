if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const { Client, middleware } = require('@line/bot-sdk');
const { GoogleGenAI } = require('@google/genai'); // 引入 Gemini SDK

// ***【配置參數】***
// 建議將機敏資訊透過環境變數或 GCP Secret Manager 傳入，確保安全。
// 在此我們從環境變數中讀取。
const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET, // 您的 LINE Channel Secret
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN // 您的 LINE Channel Access Token
};
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// 建立 LINE Bot SDK 的 Client 實例 (用於發送回覆)
const client = new Client(config);

// ----------------------------------------------------
// 初始化 Gemini 客戶端
// 由於 Cloud Functions 已經啟用了 Compute Engine Service Account
// Gemini SDK 會自動使用這個服務帳號進行身份驗證，無需提供 API Key
// ----------------------------------------------------
const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY
});

/**
 * 處理所有 LINE 事件的函數
 * @param {Array<Object>} events 
 */
async function handleEvent(events) {
  // 核心邏輯，呼叫 Gemini API
  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const userMessage = event.message.text;
      
      console.log(`Received user message: ${userMessage}`);

      try {
        // 2. 呼叫 Gemini API
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash", // 選擇高性能、低延遲的模型
          contents: userMessage,
        });

        // 3. 取得 Gemini 的回覆文字
        const geminiResponseText = response.text;
        
        // 4. 使用 LINE Client 回覆訊息
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: geminiResponseText
        });

      } catch (error) {
        console.error('Error calling Gemini API or replying to LINE:', error);
        
        // 錯誤處理：回覆用戶系統錯誤訊息
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: '抱歉！系統在呼叫 Gemini 服務時發生錯誤，請稍後再試。'
        });
      }
    }
  }
}

/**
 * Cloud Function 的主要 WebHook 進入點
 * 它會先通過 LINE SDK 的 middleware 進行簽章驗證
 * * @param {object} req Express request 物件
 * @param {object} res Express response 物件
 */
exports.lineWebhookHandler = (req, res) => {
  // 1. 設置 LINE SDK 的中介層 (middleware)
  // 此中介層會自動檢查 req.headers['x-line-signature'] 是否匹配
  const lineMiddleware = middleware(config);

  // 2. 處理請求
  lineMiddleware(req, res, (err) => {
    // 如果中介層發生錯誤 (例如簽章不匹配)，err 會被設定
    if (err) {
      const errMessage = 'LINE Signature Verification Failed:' + err.message + '\n';
      console.error(errMessage);
      return res.status(400).send(errMessage);
    }

    // === 安全驗證成功後，執行主要邏輯 ===
    console.log('Signature Verified Successfully.');
    
    // 取得所有事件 (可能一次請求有多個事件)
    const events = req.body.events;

    // 將事件處理邏輯移到非同步函數，並立即回應 LINE 平台 200 OK
    // 這是 WebHook 的最佳實踐：快速確認收到，之後再慢慢處理
    handleEvent(events).catch((e) => {
      console.error('Error during handleEvent:', e);
      // 雖然處理失敗，但我們仍對 LINE 平台回覆 200 OK，避免重試
    });

    // 立即回覆 LINE 平台 200 OK (這是 WebHook 處理的黃金法則)
    res.status(200).send('OK');
  });
};