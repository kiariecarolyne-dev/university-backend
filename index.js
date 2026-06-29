const express = require("express");
const cors = require("cors");
require("dotenv").config();

const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// MPESA PACKAGES
const axios = require("axios");
const moment = require("moment");
const cron = require("node-cron");

// FIREBASE ADMIN
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,

  // Fix Render line breaks
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
};

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();


// =====================================
// MPESA HELPERS
// =====================================

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

// Generate MPESA password
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


// =====================================
// MPESA STK PUSH
// =====================================
app.post("/mpesa-payment", async (req, res) => {
  try {
    const { phone, amount, userId, plan } = req.body;

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

    // SAVE PENDING PAYMENT
    await db.collection("mpesa_pending")
      .doc(response.data.CheckoutRequestID)
      .set({
        userId,
        plan,
        phone,
        amount,
        createdAt: new Date().toISOString(),
      });

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


// =====================================
// MPESA CALLBACK
// =====================================
app.post("/mpesa-callback", async (req, res) => {
  try {
    console.log(
      "MPESA CALLBACK:",
      JSON.stringify(req.body, null, 2)
    );

    const callback = req.body.Body.stkCallback;
    const checkoutId = callback.CheckoutRequestID;
    const resultCode = callback.ResultCode;

    // Payment failed/cancelled
    if (resultCode !== 0) {
      return res.json({
        ResultCode: 0,
        ResultDesc: "Received",
      });
    }

    // Find pending payment
    const pendingRef = db
      .collection("mpesa_pending")
      .doc(checkoutId);

    const pendingDoc = await pendingRef.get();

    if (!pendingDoc.exists) {
      return res.json({
        ResultCode: 0,
        ResultDesc: "Received",
      });
    }

    const pendingData = pendingDoc.data();
    const { userId, plan } = pendingData;

    let premiumUntil = new Date();

    if (plan === "2days") {
      premiumUntil.setDate(
        premiumUntil.getDate() + 2
      );
    }

    if (plan === "weekly") {
      premiumUntil.setDate(
        premiumUntil.getDate() + 7
      );
    }

    if (plan === "monthly") {
      premiumUntil.setDate(
        premiumUntil.getDate() + 30
      );
    }

    // Activate premium
    await db.collection("users")
      .doc(userId)
      .update({
        isPremium: true,
        premiumUntil: premiumUntil.toISOString(),
      });

    // Delete pending payment
    await pendingRef.delete();

    res.json({
      ResultCode: 0,
      ResultDesc: "Success",
    });

  } catch (error) {
    console.log(
      "CALLBACK ERROR:",
      error.message
    );

    res.json({
      ResultCode: 0,
      ResultDesc: "Error handled",
    });
  }
});


// =====================================
// STRIPE PAYMENT INTENT
// =====================================
app.post("/create-payment-intent", async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount) {
      return res.status(400).json({
        error: "Amount is required",
      });
    }

    const paymentIntent =
      await stripe.paymentIntents.create({
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


// =====================================
// STRIPE CHECKOUT SESSION
// =====================================
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { userId, plan, currency } = req.body;

    let price = 0;

   // Kenya pricing
if (currency === "kes") {
  // Stripe uses cents/smallest unit
  if (plan === "2days") price = 5000;      // KSh 50
  if (plan === "weekly") price = 15000;    // KSh 150
  if (plan === "monthly") price = 50000;   // KSh 500
}

// USD pricing
if (currency === "usd") {
  if (plan === "2days") price = 50;        // $0.50
  if (plan === "weekly") price = 150;      // $1.50
  if (plan === "monthly") price = 500;     // $5.00
}

    if (!price) {
      return res.status(400).json({
        error: "Invalid plan or currency",
      });
    }

    const session =
      await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",

        line_items: [
          {
            price_data: {
              currency: currency,
              product_data: {
                name:
                  `University Universal ${plan} subscription`,
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

    res.json({
      url: session.url,
    });

  } catch (error) {
    console.log(
      "Checkout error:",
      error.message
    );

    res.status(500).json({
      error: error.message,
    });
  }
});


// =====================================
// STRIPE SUCCESS ENDPOINT
// =====================================
app.get("/success", async (req, res) => {
  try {
    const { userId, plan } = req.query;

    if (!userId || !plan) {
      return res.status(400).send(
        "Missing userId or plan"
      );
    }

    const userRef =
      db.collection("users").doc(userId);

    const userDoc =
      await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).send(
        "User not found"
      );
    }

    let premiumUntil = new Date();

    if (plan === "2days") {
      premiumUntil.setDate(
        premiumUntil.getDate() + 2
      );
    }

    if (plan === "weekly") {
      premiumUntil.setDate(
        premiumUntil.getDate() + 7
      );
    }

    if (plan === "monthly") {
      premiumUntil.setDate(
        premiumUntil.getDate() + 30
      );
    }

    await userRef.update({
      isPremium: true,
      premiumUntil:
        premiumUntil.toISOString(),
    });

    res.send(
      "Payment successful. Premium activated."
    );

  } catch (error) {
    console.error(error);

    res.status(500).send(
      "Something went wrong"
    );
  }
});


// =====================================
// CANCEL ROUTE
// =====================================
app.get("/cancel", (req, res) => {
  res.send(
    "Payment cancelled. You were not charged."
  );
});


// =====================================
// DEBUG ROUTE
// =====================================
app.get("/test-price", (req, res) => {
  res.send(
    "2 DAYS = KSh 50 | WEEKLY = KSh 150 | MONTHLY = KSh 500"
  );
});


// =====================================
// AUTO REMOVE EXPIRED PREMIUM DAILY
// Runs every day at midnight
// =====================================
cron.schedule("0 0 * * *", async () => {
  try {
    console.log("Checking expired premium users...");

    const usersSnapshot =
      await db.collection("users").get();

    const now = new Date();

    for (const doc of usersSnapshot.docs) {
      const user = doc.data();

      if (
        user.isPremium === true &&
        user.premiumUntil
      ) {
        const expiryDate =
          new Date(user.premiumUntil);

        if (now > expiryDate) {
          await db
            .collection("users")
            .doc(doc.id)
            .update({
              isPremium: false,
              premiumUntil: null,
            });

          console.log(
            "Premium expired for:",
            doc.id
          );
        }
      }
    }

    console.log(
      "Premium cleanup finished."
    );

  } catch (error) {
    console.log(
      "Cron error:",
      error.message
    );
  }
});


const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(
    "Server running on port",
    PORT
  );
});