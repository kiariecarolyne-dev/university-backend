const express = require("express");
const cors = require("cors");
require("dotenv").config();

const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ✅ NEW MPESA PACKAGES
const axios = require("axios");
const moment = require("moment");

// 🧠 FIREBASE ADMIN (USING RENDER ENV VARIABLES)
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,

  // Fixes line breaks in Render environment variable
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
};

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();


// ================================
// MPESA HELPERS
// ================================

// Get Daraja access token
const getMpesaAccessToken = async () => {
  const auth = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString("base64");

  const response = await axios.get(
    "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
    {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    }
  );

  return response.data.access_token;
};

// Generate password for STK push
const generateMpesaPassword = () => {
  const timestamp = moment().format("YYYYMMDDHHmmss");

  const password = Buffer.from(
    `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
  ).toString("base64");

  return {
    password,
    timestamp,
  };
};

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("University Universal Payment Server Running");
});


// ================================
// MPESA STK PUSH
// ================================
app.post("/mpesa-payment", async (req, res) => {
  try {
    const { phone, amount } = req.body;

    const accessToken = await getMpesaAccessToken();

    const { password, timestamp } = generateMpesaPassword();

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
        TransactionDesc: "Premium Subscription Payment",
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    res.json({
      success: true,
      data: response.data,
    });

  } catch (error) {
    console.log(
      "MPESA ERROR:",
      error.response?.data || error.message
    );

    res.status(500).json({
      error: "M-Pesa payment failed",
    });
  }
});


// 🧱 STEP 19A.4 — PAYMENT INTENT
app.post("/create-payment-intent", async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount) {
      return res.status(400).json({
        error: "Amount is required",
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: "kes",
      payment_method_types: ["card"],
    });

    res.send({
      clientSecret: paymentIntent.client_secret,
    });

  } catch (error) {
    console.log("Stripe error:", error.message);
    res.status(500).json({
      error: error.message,
    });
  }
});


// 🧱 CHECKOUT SESSION (STRIPE)
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { userId, plan, currency } = req.body;

    console.log("REQUEST DATA:", {
      userId,
      plan,
      currency
    });

    let price = 0;

    // 🇰🇪 Kenya pricing
    if (currency === "kes") {
      if (plan === "2days") price = 10000;
      if (plan === "weekly") price = 25000;
      if (plan === "monthly") price = 100000;
    }

    // 🇺🇸 USD pricing
    if (currency === "usd") {
      if (plan === "2days") price = 100;
      if (plan === "weekly") price = 250;
      if (plan === "monthly") price = 1000;
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
              name: `University Universal ${plan} subscription`,
            },
            unit_amount: price,
          },
          quantity: 1,
        },
      ],

      success_url: `${process.env.BASE_URL}/success?userId=${userId}&plan=${plan}`,
      cancel_url: `${process.env.BASE_URL}/cancel`,
    });

    res.json({
      url: session.url,
    });

  } catch (error) {
    console.log("Checkout error:", error.message);
    res.status(500).json({
      error: error.message,
    });
  }
});


// 🧱 SUCCESS ENDPOINT
app.get("/success", async (req, res) => {
  try {
    const { userId, plan } = req.query;

    if (!userId || !plan) {
      return res.status(400).send("Missing userId or plan");
    }

    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists()) {
      return res.status(404).send("User not found");
    }

    let premiumUntil = new Date();

    if (plan === "2days") {
      premiumUntil.setDate(premiumUntil.getDate() + 2);
    }

    if (plan === "weekly") {
      premiumUntil.setDate(premiumUntil.getDate() + 7);
    }

    if (plan === "monthly") {
      premiumUntil.setDate(premiumUntil.getDate() + 30);
    }

    await userRef.update({
      isPremium: true,
      premiumUntil: premiumUntil.toISOString(),
    });

    res.send("Payment successful. Premium activated.");

  } catch (error) {
    console.error(error);
    res.status(500).send("Something went wrong");
  }
});


// CANCEL ROUTE
app.get("/cancel", (req, res) => {
  res.send("Payment cancelled. You were not charged.");
});


// DEBUG ROUTE
app.get("/test-price", (req, res) => {
  res.send("2 DAYS = KSh 100 | WEEKLY = KSh 250 | MONTHLY = KSh 1000");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});