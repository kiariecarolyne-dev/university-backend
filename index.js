const express = require("express");
const cors = require("cors");
require("dotenv").config();

const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("University Universal Payment Server Running");
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


// 🧱 STEP 19A.5 — CHECKOUT SESSION (KES + USD SUPPORT)
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
      if (plan === "2days") price = 10000;      // KSh 100
      if (plan === "weekly") price = 25000;     // KSh 250
      if (plan === "monthly") price = 100000;   // KSh 1000
    }

    // 🇺🇸 USD pricing
    if (currency === "usd") {
      if (plan === "2days") price = 100;        // $1.00
      if (plan === "weekly") price = 250;       // $2.50
      if (plan === "monthly") price = 1000;     // $10.00
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

      // ✅ Sends userId + plan
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


// 🧱 STEP 20B — SUCCESS ENDPOINT WITH EXPIRY LOGIC
app.get("/success", async (req, res) => {
  try {
    const { userId, plan } = req.query;

    if (!userId || !plan) {
      return res.status(400).send("Missing userId or plan");
    }

    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).send("User not found");
    }

    // Calculate expiry date
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


// 🧱 CANCEL ROUTE
app.get("/cancel", (req, res) => {
  res.send("Payment cancelled. You were not charged.");
});


// 🧪 DEBUG ROUTE
app.get("/test-price", (req, res) => {
  res.send("2 DAYS = KSh 100 | WEEKLY = KSh 250 | MONTHLY = KSh 1000");
});


const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});