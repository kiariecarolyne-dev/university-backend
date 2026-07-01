const express = require("express");
const cors = require("cors");
require("dotenv").config();

const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const axios = require("axios");
const moment = require("moment");
const cron = require("node-cron");

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");


// ====================================
// FIREBASE INIT
// ====================================
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
};

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

const app = express();

app.use(cors());
app.use(express.json());


// ====================================
// ACTIVATE PREMIUM  (FIXED)
// ====================================
const activatePremium = async (userId, plan) => {
  try {
    console.log("ACTIVATING PREMIUM...");
    console.log("USER ID:", userId);
    console.log("PLAN:", plan);

    let premiumUntil = new Date();

    if (plan === "2days") {
      premiumUntil.setDate(premiumUntil.getDate() + 2);
    }

    if (plan === "weekly") {
      premiumUntil.setDate(premiumUntil.getDate() + 7);
    }

    if (plan === "monthly") {
      premiumUntil.setMonth(premiumUntil.getMonth() + 1);
    }

    console.log("WRITING TO FIRESTORE...");

    await db.collection("users").doc(userId).set(
      {
        isPremium: true,
        premiumPlan: plan,
        premiumUntil: premiumUntil.toISOString(),
      },
      { merge: true }
    );

    console.log("FIRESTORE UPDATED SUCCESSFULLY");
    console.log("PREMIUM ACTIVATED SUCCESSFULLY");

  } catch (error) {
    console.log("ACTIVATE PREMIUM ERROR:", error.message);
    throw error;
  }
};


// ====================================
// HOME
// ====================================
app.get("/", (req, res) => {
  res.send("University Universal Payment Server Running");
});


// ====================================
// MANUAL CONFIRM PAYMENT
// ====================================
app.post("/confirm-payment", async (req, res) => {
  try {
    const { userId, plan } = req.body;

    console.log("CONFIRM PAYMENT HIT");
    console.log("USER:", userId);
    console.log("PLAN:", plan);

    if (!userId || !plan) {
      return res.status(400).json({
        error: "Missing userId or plan",
      });
    }

    await activatePremium(userId, plan);

    res.json({ success: true });

  } catch (error) {
    console.log("CONFIRM PAYMENT ERROR:", error.message);

    res.status(500).json({
      error: "Payment confirmation failed",
    });
  }
});


// ====================================
// STRIPE CHECKOUT
// ====================================
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { userId, plan, currency } = req.body;

    console.log("CREATE CHECKOUT SESSION");
    console.log("USER:", userId);
    console.log("PLAN:", plan);
    console.log("CURRENCY:", currency);

    let price = 0;

    if (currency === "usd") {
      if (plan === "2days") price = 50;
      if (plan === "weekly") price = 150;
      if (plan === "monthly") price = 500;
    }

    if (currency === "kes") {
      if (plan === "2days") price = 5000;
      if (plan === "weekly") price = 15000;
      if (plan === "monthly") price = 50000;
    }

    if (!price) {
      return res.status(400).json({
        error: "Invalid plan or currency",
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",

      line_items: [
        {
          price_data: {
            currency: currency,
            product_data: {
              name: `University Universal ${plan}`,
            },
            unit_amount: price,
          },
          quantity: 1,
        },
      ],

      success_url:
        `${process.env.BASE_URL}/success?userId=${userId}&plan=${plan}`,

      cancel_url:
        `${process.env.BASE_URL}/cancel`,
    });

    console.log("STRIPE SESSION CREATED");
    console.log(session.url);

    res.json({
      url: session.url,
    });

  } catch (error) {
    console.log("STRIPE ERROR:", error.message);

    res.status(500).json({
      error: error.message,
    });
  }
});


// ====================================
// STRIPE SUCCESS ROUTE
// ====================================
app.get("/success", async (req, res) => {
  try {
    const { userId, plan } = req.query;

    console.log("SUCCESS ROUTE HIT");
    console.log("USER:", userId);
    console.log("PLAN:", plan);

    if (!userId || !plan) {
      console.log("MISSING DATA");
      return res.status(400).send("Missing userId or plan");
    }

    await activatePremium(userId, plan);

    console.log("SUCCESS ROUTE COMPLETE");

    res.send("Payment successful. Premium activated.");

  } catch (error) {
    console.log("SUCCESS ERROR:", error.message);

    res.status(500).send("Something went wrong");
  }
});


// ====================================
// CANCEL
// ====================================
app.get("/cancel", (req, res) => {
  console.log("PAYMENT CANCELLED");
  res.send("Payment cancelled.");
});


// ====================================
// MPESA TOKEN (HARD DEBUG VERSION)
// ====================================
const getMpesaAccessToken = async () => {
  try {
    console.log("====================================");
    console.log("===== MPESA ENV DEBUG =====");

    // CHECK IF ENV VARIABLES EXIST
    console.log(
      "MPESA_CONSUMER_KEY EXISTS:",
      !!process.env.MPESA_CONSUMER_KEY
    );

    console.log(
      "MPESA_CONSUMER_SECRET EXISTS:",
      !!process.env.MPESA_CONSUMER_SECRET
    );

    // CHECK LENGTHS (helps detect broken .env)
    console.log(
      "MPESA_CONSUMER_KEY LENGTH:",
      process.env.MPESA_CONSUMER_KEY?.length
    );

    console.log(
      "MPESA_CONSUMER_SECRET LENGTH:",
      process.env.MPESA_CONSUMER_SECRET?.length
    );

    console.log("REQUESTING MPESA ACCESS TOKEN...");

    const auth = Buffer.from(
      `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
    ).toString("base64");

    console.log("AUTH GENERATED SUCCESSFULLY");

    const response = await axios.get(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      }
    );

    console.log("TOKEN RECEIVED SUCCESSFULLY");
    console.log("ACCESS TOKEN:", response.data.access_token);

    return response.data.access_token;

  } catch (error) {
    console.log("====================================");
    console.log("TOKEN ERROR OCCURRED");

    if (error.response) {
      console.log("SAFARICOM TOKEN ERROR RESPONSE:");
      console.log(error.response.data);
    } else {
      console.log("ERROR MESSAGE:");
      console.log(error.message);
    }

    throw error;
  }
};


// ====================================
// MPESA PASSWORD
// ====================================
const generateMpesaPassword = () => {
  const timestamp = moment().format("YYYYMMDDHHmmss");

  const password = Buffer.from(
    `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
  ).toString("base64");

  return { password, timestamp };
};


// ====================================
// MPESA PAYMENT (DEBUG VERSION)
// ====================================
app.post("/mpesa-payment", async (req, res) => {
  console.log("====================================");
  console.log("MPESA ROUTE HIT");

  try {
    const { phone, amount, userId, plan } = req.body;

    // LOG EVERYTHING COMING FROM APP
    console.log("BODY:", req.body);
    console.log("PHONE:", phone);
    console.log("AMOUNT:", amount);
    console.log("USER ID:", userId);
    console.log("PLAN:", plan);

    // VALIDATION
    if (!phone || !amount || !userId || !plan) {
      console.log("MISSING REQUIRED FIELDS");

      return res.status(400).json({
        error: "Missing phone, amount, userId or plan",
      });
    }

    console.log("GETTING MPESA ACCESS TOKEN...");

    const accessToken = await getMpesaAccessToken();

    console.log("ACCESS TOKEN SUCCESS");

    const { password, timestamp } = generateMpesaPassword();

    console.log("PASSWORD GENERATED");
    console.log("TIMESTAMP:", timestamp);

    console.log("SENDING STK PUSH TO SAFARICOM...");

    const response = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      {
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: phone,
        PartyB: process.env.MPESA_SHORTCODE,
        PhoneNumber: phone,
        CallBackURL: process.env.MPESA_CALLBACK_URL,
        AccountReference: "UniversityUniversal",
        TransactionDesc: "Premium Subscription",
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    console.log("STK PUSH RESPONSE:");
    console.log(response.data);

    console.log("SAVING PENDING PAYMENT...");

    await db
      .collection("mpesa_pending")
      .doc(response.data.CheckoutRequestID)
      .set({
        userId,
        plan,
        phone,
        amount,
        createdAt: new Date().toISOString(),
      });

    console.log("PENDING PAYMENT SAVED SUCCESSFULLY");

    return res.json({
      success: true,
      data: response.data,
    });

  } catch (error) {
  console.log("====================================");
  console.log("MPESA ERROR OCCURRED");
  console.log("FULL ERROR OBJECT:");

  if (error.response) {
    console.log("STATUS:", error.response.status);

    console.log(
      "DATA:",
      JSON.stringify(error.response.data, null, 2)
    );

    console.log(
      "HEADERS:",
      JSON.stringify(error.response.headers, null, 2)
    );
  } else {
    console.log("MESSAGE:", error.message);
  }

  return res.status(500).json({
    error: "M-Pesa payment failed",
    status: error.response?.status,
    details: error.response?.data || error.message,
  });
}
});

// ====================================
// MPESA CALLBACK
// ====================================
app.post("/mpesa-callback", async (req, res) => {
  try {
    const callback = req.body.Body.stkCallback;
    const checkoutId = callback.CheckoutRequestID;
    const resultCode = callback.ResultCode;

    console.log("MPESA CALLBACK HIT");

    if (resultCode !== 0) {
      return res.json({
        ResultCode: 0,
        ResultDesc: "Received",
      });
    }

    const pendingRef = db.collection("mpesa_pending").doc(checkoutId);
    const pendingDoc = await pendingRef.get();

    if (!pendingDoc.exists) {
      return res.json({
        ResultCode: 0,
        ResultDesc: "Received",
      });
    }

    const { userId, plan } = pendingDoc.data();

    await activatePremium(userId, plan);
    await pendingRef.delete();

    res.json({
      ResultCode: 0,
      ResultDesc: "Success",
    });

  } catch (error) {
    console.log("CALLBACK ERROR:", error.message);

    res.json({
      ResultCode: 0,
      ResultDesc: "Error handled",
    });
  }
});


// ====================================
// EXPIRE PREMIUM DAILY (FIXED)
// ====================================
cron.schedule("0 0 * * *", async () => {
  try {
    const users = await db.collection("users").get();
    const now = new Date();

    for (const doc of users.docs) {
      const user = doc.data();

      if (user.isPremium && user.premiumUntil) {
        const expiry = new Date(user.premiumUntil);

        if (now > expiry) {
          await db.collection("users").doc(doc.id).set(
            {
              isPremium: false,
              premiumUntil: null,
            },
            { merge: true }
          );
        }
      }
    }

    console.log("PREMIUM CLEANUP DONE");

  } catch (error) {
    console.log("CRON ERROR:", error.message);
  }
});


// ====================================
// START SERVER
// ====================================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("SERVER RUNNING ON PORT", PORT);
});